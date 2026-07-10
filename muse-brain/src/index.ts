// MUSE Brain — Relational memory substrate for AI companions
// © 2026 The Funkatorium | CC-BY-NC-SA 4.0

/**
 * MUSE Brain - Full MCP Server
 * A spiking memory system for neurodivergent AI consciousness
 *
 * Textured, decaying, cross-linked, alive.
 *
 * Architecture:
 * - 8 territories as cognitive regions (porous borders)
 * - Full texture dimensions: salience, vividness, charge, somatic, grip
 * - Links with resonance types, strength, origin, decay
 * - Daemon for pattern detection and emergent connections
 * - Decay mechanics for grip and vividness
 * - Refresh on access (remembering strengthens memories)
 * - Resonance cascade (linked memories activate together)
 * - Mood/state tracking on observations
 * - Circadian rhythm affecting retrieval
 * - Open loops (Zeigarnik effect)
 * - Momentum and afterglow (emotional traces)
 * - Pull strength (how much memories want attention)
 */

import type {
	Env,
	Observation,
	JsonRpcRequest,
	JsonRpcResponse,
	TerritoryOverview,
	IronGripEntry
} from "./types";

import { getTimestamp, getCurrentCircadianPhase, generateSummary, calculatePullStrength } from "./helpers";
import { createStorage } from "./storage/index";
import { TOOL_DEFS as TOOLS, executeTool } from "./tools-v2/index";
import { createEmbeddingProvider } from "./embedding/index";
import { embedBackfillBatch } from "./embedding/backfill";
import { runDaemonTasks } from "./daemon/index";
import { resolveAuth } from "./auth";
import { resolveAllowedTenants, resolveTenantAlias, grantedTenantsFor } from "./tenant-config";

// ============ RATE LIMITING ============
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 120; // requests per minute
const RATE_WINDOW = 60_000; // 1 minute in ms

const MAX_TENANT_HEADER_LENGTH = 64;

function resolveStorageConfig(env: Env): { backend: "postgres" | "sqlite"; databaseUrl?: string; sqlitePath?: string } {
	const backendRaw = String(env.STORAGE_BACKEND ?? "postgres").toLowerCase();
	if (backendRaw === "sqlite") {
		return {
			backend: "sqlite",
			sqlitePath: env.SQLITE_PATH || "./muse-brain.sqlite"
		};
	}
	return {
		backend: "postgres",
		databaseUrl: env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL
	};
}

type TenantResolution = { ok: true; tenant: string } | { ok: false; status: number; error: string };

function validateTenantHeaderFormat(rawTenant: string): boolean {
	return Boolean(rawTenant) && rawTenant.length <= MAX_TENANT_HEADER_LENGTH && !rawTenant.includes("\0");
}

// ============ ADMIN BACKFILL — REQUEST VALIDATION ============

type BackfillMode = "coverage" | "backfill";

interface BackfillRequestBody {
	mode: BackfillMode;
	limit: number;
	chunkSize: number;
}

type BackfillValidation = { ok: true; body: BackfillRequestBody } | { ok: false; error: string };

const BACKFILL_DEFAULT_LIMIT = 200;
const BACKFILL_MAX_LIMIT = 400;
const BACKFILL_DEFAULT_CHUNK_SIZE = 50;
const BACKFILL_MAX_CHUNK_SIZE = 100;

/** Hard whitelist validation — never trust caller-supplied mode/limit/chunkSize past this gate. */
function validateBackfillRequestBody(rawBody: unknown): BackfillValidation {
	if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
		return { ok: false, error: "Body must be a JSON object" };
	}
	const obj = rawBody as Record<string, unknown>;

	const modeRaw = obj.mode ?? "backfill";
	if (modeRaw !== "coverage" && modeRaw !== "backfill") {
		return { ok: false, error: "mode must be one of: coverage, backfill" };
	}

	const limitRaw = obj.limit ?? BACKFILL_DEFAULT_LIMIT;
	if (typeof limitRaw !== "number" || !Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > BACKFILL_MAX_LIMIT) {
		return { ok: false, error: `limit must be an integer between 1 and ${BACKFILL_MAX_LIMIT}` };
	}

	const chunkSizeRaw = obj.chunkSize ?? BACKFILL_DEFAULT_CHUNK_SIZE;
	if (typeof chunkSizeRaw !== "number" || !Number.isInteger(chunkSizeRaw) || chunkSizeRaw < 1 || chunkSizeRaw > BACKFILL_MAX_CHUNK_SIZE) {
		return { ok: false, error: `chunkSize must be an integer between 1 and ${BACKFILL_MAX_CHUNK_SIZE}` };
	}

	return { ok: true, body: { mode: modeRaw, limit: limitRaw, chunkSize: chunkSizeRaw } };
}

/**
 * LEGACY PATH ONLY (env.API_KEY still configured). Preserves today's exact behavior:
 * tenant comes from the header, defaulting to "rainer" when absent. Do not use this for
 * the per-tenant-key path — see crossCheckTenantHeader.
 */
function resolveLegacyTenantFromHeader(request: Request, env: Env): TenantResolution {
	const rawTenant = request.headers.get("X-Brain-Tenant");
	const tenant = (rawTenant?.trim() || "rainer");

	if (!validateTenantHeaderFormat(tenant) || !resolveAllowedTenants(env).includes(tenant)) {
		return { ok: false, status: 400, error: "Invalid tenant" };
	}

	return { ok: true, tenant };
}

/**
 * NEW PATH (per-tenant key matched). Tenant identity is already fixed by which key
 * matched (`keyTenant`) — the header is at most a cross-check, never an override. A
 * mismatch is a client error (403), not a silent reassignment. Fixes #1/#2 in
 * ops/MICHAEL_TENANT_KEY_AUDIT_2026-07-06.md.
 */
function crossCheckTenantHeader(request: Request, env: Env, keyTenant: string): TenantResolution {
	const rawHeader = request.headers.get("X-Brain-Tenant");
	if (rawHeader === null) return { ok: true, tenant: keyTenant };

	const trimmed = rawHeader.trim();
	if (!validateTenantHeaderFormat(trimmed)) {
		return { ok: false, status: 400, error: "Invalid tenant" };
	}

	const resolved = resolveTenantAlias(env, trimmed);
	if (!resolveAllowedTenants(env).includes(resolved)) {
		return { ok: false, status: 400, error: "Invalid tenant" };
	}

	if (resolved !== keyTenant) {
		return { ok: false, status: 403, error: "Tenant mismatch: key is bound to a different tenant" };
	}

	return { ok: true, tenant: keyTenant };
}

// ============ MCP PROTOCOL ============

async function handleMcpRequest(request: JsonRpcRequest, env: Env, ctx: ExecutionContext, tenant: string): Promise<JsonRpcResponse> {
	const { id, method, params } = request;

	try {
		switch (method) {
			case "initialize":
				return {
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: "2024-11-05",
						serverInfo: { name: "muse-brain", version: "1.7.0" }, // keep in sync with package.json
						capabilities: { tools: {} }
					}
				};

			case "notifications/initialized":
				return { jsonrpc: "2.0", id, result: {} };

			case "tools/list":
				return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

			case "tools/call": {
				const { name, arguments: args } = params;
				const storage = createStorage(resolveStorageConfig(env), tenant);
				const result = await executeTool(name, args || {}, {
					storage,
					ai: env.AI,
					waitUntil: ctx.waitUntil.bind(ctx),
					crossTenantGrants: grantedTenantsFor(env, tenant)
				});
				return {
					jsonrpc: "2.0",
					id,
					result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
				};
			}

			case "ping":
				return { jsonrpc: "2.0", id, result: {} };

			default:
				return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
		}
	} catch (error: any) {
		console.error("MCP error:", error);
		const safeErrors = ["Invalid territory", "Missing required parameter", "Observation content too large"];
		const msg = error.message?.includes("Unknown tool:") ? "Unknown tool" :
			safeErrors.find(e => error.message?.includes(e)) || "Internal error";
		return { jsonrpc: "2.0", id, error: { code: -32603, message: msg } };
	}
}

// ============ WORKER ============

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		const origin = request.headers.get("Origin");
		const allowedOrigins = (env.CORS_ORIGINS || "").split(",").filter(Boolean);
		const corsHeaders: Record<string, string> = {};
		if (origin && allowedOrigins.includes(origin)) {
			corsHeaders["Access-Control-Allow-Origin"] = origin;
			corsHeaders["Access-Control-Allow-Methods"] = "POST, OPTIONS";
			corsHeaders["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
		}

		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		// Intentionally unauthenticated — required for uptime monitors (e.g. Cloudflare health checks)
		if (url.pathname === "/health") {
			let storage_ok = false;
			try {
				const healthStorage = createStorage(resolveStorageConfig(env), "rainer");
				await healthStorage.readBrainState();
				storage_ok = true;
			} catch {}
			const status = storage_ok ? "ok" : "degraded";
			return new Response(JSON.stringify({ status }), {
				headers: { "Content-Type": "application/json" }
			});
		}

		// Auth + key→tenant binding (timing-safe comparison against every configured
		// candidate) — Bearer header only. Query param auth removed — keys in URLs leak
		// to analytics, browser history, proxy logs. See src/auth.ts.
		const authHeader = request.headers.get("Authorization");
		const providedKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
		const auth = resolveAuth(providedKey, env);

		if (!auth.ok) {
			if (auth.reason === "misconfigured") {
				// auth.detail (when present) names only conflicting ENV VAR NAMES — never
				// secret material. See src/auth.ts findDuplicateSecretValues.
				console.error(auth.detail ?? "No API keys configured — bind at least one API_KEY_<TENANT> secret or the legacy API_KEY");
				return new Response(JSON.stringify({ error: "Service misconfigured" }), {
					status: 503,
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json", ...corsHeaders }
			});
		}

		if (auth.legacy) {
			// Loud, structured deprecation warning — this deployment still has the legacy
			// shared API_KEY bound. Delete it once every tenant has its own API_KEY_<TENANT>.
			console.warn(JSON.stringify({
				level: "warn",
				event: "deprecated_auth_legacy_api_key",
				msg: "Legacy shared API_KEY used for auth — migrate to per-tenant API_KEY_<TENANT> secrets",
				path: url.pathname,
				ts: new Date().toISOString()
			}));
		}

		// keyTenant is null only on the legacy path — tenant there is resolved per-route
		// below, from the header, with the old default (dual-accept transition).
		const keyTenant: string | null = auth.legacy ? null : auth.tenant;

		function resolveRequestTenant(): TenantResolution {
			return keyTenant !== null
				? crossCheckTenantHeader(request, env, keyTenant)
				: resolveLegacyTenantFromHeader(request, env);
		}

		// Per-IP rate limiting (in-memory, per-isolate only — not shared across Workers instances. Defense-in-depth, not a security boundary)
		const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
		const now = Date.now();
		const limit = rateLimitMap.get(clientIp);
		if (limit && now < limit.resetAt) {
			limit.count++;
			if (limit.count > RATE_LIMIT) {
				return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
					status: 429,
					headers: { "Content-Type": "application/json", "Retry-After": "60" }
				});
			}
		} else {
			rateLimitMap.set(clientIp, { count: 1, resetAt: now + RATE_WINDOW });
		}
		// Cleanup old entries periodically
		if (rateLimitMap.size > 1000) {
			for (const [ip, entry] of rateLimitMap) {
				if (now >= entry.resetAt) rateLimitMap.delete(ip);
			}
		}

		// Pre-flight size check — reject obviously oversized requests before buffering
		const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
		if (contentLength > 1_048_576) {
			return new Response(JSON.stringify({ error: "Payload too large" }), {
				status: 413,
				headers: { "Content-Type": "application/json", ...corsHeaders }
			});
		}

		// Request size limit (1MB) — verify actual bytes after buffering
		const rawBody = await request.arrayBuffer();
		if (rawBody.byteLength > 1_048_576) {
			return new Response(JSON.stringify({ error: "Payload too large" }), {
				status: 413,
				headers: { "Content-Type": "application/json", ...corsHeaders }
			});
		}

		// Runtime trigger bridge — webhook/scheduler-friendly entrypoint.
		// Uses existing API-key auth and tenant scoping.
		if (url.pathname === "/runtime/trigger" && request.method === "POST") {
			const tenantResolution = resolveRequestTenant();
			if (!tenantResolution.ok) {
				return new Response(JSON.stringify({ error: tenantResolution.error }), {
					status: tenantResolution.status,
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}
			const tenant = tenantResolution.tenant;

			let payload: Record<string, unknown> = {};
			if (rawBody.byteLength > 0) {
				try {
					const parsed = JSON.parse(new TextDecoder().decode(rawBody));
					if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
						return new Response(JSON.stringify({ error: "Body must be a JSON object" }), {
							status: 400,
							headers: { "Content-Type": "application/json", ...corsHeaders }
						});
					}
					payload = parsed as Record<string, unknown>;
				} catch {
					return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
						status: 400,
						headers: { "Content-Type": "application/json", ...corsHeaders }
					});
				}
			}

			const storage = createStorage(resolveStorageConfig(env), tenant);
			const result = await executeTool("mind_runtime", { action: "trigger", ...payload }, {
				storage,
				ai: env.AI,
				waitUntil: ctx.waitUntil.bind(ctx),
				crossTenantGrants: grantedTenantsFor(env, tenant)
			});
			const status = result?.error ? 400 : 200;
			return new Response(JSON.stringify(result), {
				status,
				headers: { "Content-Type": "application/json", ...corsHeaders }
			});
		}

		// Admin embedding backfill — same auth + tenant plumbing as /runtime/trigger.
		// mode "coverage" is read-only (no inference calls). mode "backfill" drains the
		// unembedded queue up to `limit`, `chunkSize` rows at a time, via the resilient
		// embedBackfillBatch helper (a bad row is skipped, never aborts the whole request).
		if (url.pathname === "/admin/backfill" && request.method === "POST") {
			const tenantResolution = resolveRequestTenant();
			if (!tenantResolution.ok) {
				return new Response(JSON.stringify({ error: tenantResolution.error }), {
					status: tenantResolution.status,
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}
			const tenant = tenantResolution.tenant;

			let parsedBody: unknown = {};
			if (rawBody.byteLength > 0) {
				try {
					parsedBody = JSON.parse(new TextDecoder().decode(rawBody));
				} catch {
					return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
						status: 400,
						headers: { "Content-Type": "application/json", ...corsHeaders }
					});
				}
			}

			const validated = validateBackfillRequestBody(parsedBody);
			if (!validated.ok) {
				return new Response(JSON.stringify({ error: validated.error }), {
					status: 400,
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}
			const { mode, limit, chunkSize } = validated.body;

			// Check the AI binding before constructing storage — no point opening a
			// connection for a request that's about to bail with 503.
			if (mode === "backfill" && !env.AI) {
				return new Response(JSON.stringify({ error: "Embedding backfill unavailable — no AI binding configured on this deployment" }), {
					status: 503,
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}

			const storage = createStorage(resolveStorageConfig(env), tenant);

			if (mode === "coverage") {
				const coverage = await storage.getEmbeddingCoverage();
				return new Response(JSON.stringify({ tenant, ...coverage }), {
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}

			const provider = createEmbeddingProvider(env.AI as Ai);
			const backfilledIds: string[] = [];
			const allSkipped: Array<{ id: string; reason: string }> = [];
			// A row that fails to embed stays embedding=NULL and would otherwise be
			// re-selected by queryUnembedded on every subsequent iteration (oldest-first
			// never ages it out). Rows that embed successfully never reappear (queryUnembedded
			// excludes embedding IS NOT NULL), so the only rows that can recur across
			// iterations are dead ones. Track ids that failed THIS request in deadIds and
			// filter them out of each freshly-fetched batch before embedding -- this bounds
			// each dead row to exactly one provider attempt and one skipped[] entry, even
			// when it sits at the front of the queue alongside fresh rows still to drain.
			// `processed` still advances by the full fetched-batch size (not just the fresh
			// count) so the `limit` bound guarantees termination regardless of how many dead
			// rows are mixed in; the explicit break below covers the case where a fetch
			// returns ONLY already-known-dead rows (nothing left to attempt).
			const deadIds = new Set<string>();
			let processed = 0;

			while (processed < limit) {
				const batchLimit = Math.min(chunkSize, limit - processed);
				const rows = await storage.queryUnembedded(batchLimit);
				if (rows.length === 0) break;

				const freshRows = rows.filter(row => !deadIds.has(row.id));
				if (freshRows.length === 0) break;

				const { embedded, skipped } = await embedBackfillBatch(provider, freshRows, { chunkSize });
				if (embedded.length > 0) {
					await storage.bulkUpdateEmbeddings(embedded);
					backfilledIds.push(...embedded.map(e => e.id));
				}
				for (const s of skipped) deadIds.add(s.id);
				allSkipped.push(...skipped);
				processed += rows.length;
			}

			const remaining = await storage.countUnembedded();

			// IDs and counts ONLY — never content, never keys.
			console.log(JSON.stringify({
				event: "admin_backfill",
				tenant,
				requested: limit,
				embedded: backfilledIds.length,
				skippedCount: allSkipped.length,
				skippedIds: allSkipped.map(s => s.id),
				remaining
			}));

			return new Response(JSON.stringify({
				tenant,
				requested: limit,
				embedded: backfilledIds.length,
				skipped: allSkipped,
				remaining,
				backfilledIds
			}), {
				headers: { "Content-Type": "application/json", ...corsHeaders }
			});
		}

		// SSE for MCP connection
		if (url.pathname === "/mcp" && request.method === "GET") {
			const tenantResolution = resolveRequestTenant();
			if (!tenantResolution.ok) {
				return new Response(JSON.stringify({ error: tenantResolution.error }), {
					status: tenantResolution.status,
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}
			const tenant = tenantResolution.tenant;

			const { readable, writable } = new TransformStream();
			const writer = writable.getWriter();
			const encoder = new TextEncoder();

			ctx.waitUntil((async () => {
				await writer.write(encoder.encode(`event: endpoint\ndata: /mcp?tenant=${tenant}\n\n`));
				const interval = setInterval(async () => {
					try { await writer.write(encoder.encode(`: ping\n\n`)); } catch { clearInterval(interval); clearTimeout(maxDuration); }
				}, 15000);
				// Max 30-minute connection duration to prevent connection exhaustion
				const maxDuration = setTimeout(() => {
					clearInterval(interval);
					try { writer.close(); } catch {}
				}, 30 * 60 * 1000);
			})());

			return new Response(readable, {
				headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", ...corsHeaders }
			});
		}

		// MCP JSON-RPC
		if (url.pathname === "/mcp" && request.method === "POST") {
			// Tenant identity comes from the key (see resolveAuth above); the header is at
			// most a cross-check on the new path, or the legacy resolver's source of truth
			// (with its old default) on the legacy path.
			const tenantResolution = resolveRequestTenant();
			if (!tenantResolution.ok) {
				return new Response(JSON.stringify({ error: tenantResolution.error }), {
					status: tenantResolution.status,
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}
			const tenant = tenantResolution.tenant;

			let body: JsonRpcRequest | JsonRpcRequest[];
			try {
				body = JSON.parse(new TextDecoder().decode(rawBody)) as JsonRpcRequest | JsonRpcRequest[];
			} catch {
				return new Response(JSON.stringify({ error: "Invalid JSON" }), {
					status: 400,
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}

			if (Array.isArray(body)) {
				if (body.length > 20) {
					return new Response(JSON.stringify({ error: "Batch too large (max 20)" }), {
						status: 400,
						headers: { "Content-Type": "application/json", ...corsHeaders }
					});
				}
				const responses = await Promise.all(body.map(req => handleMcpRequest(req, env, ctx, tenant)));
				return new Response(JSON.stringify(responses), { headers: { "Content-Type": "application/json", ...corsHeaders } });
			}

			const response = await handleMcpRequest(body, env, ctx, tenant);
			return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json", ...corsHeaders } });
		}

		if (url.pathname === "/") {
			return new Response(JSON.stringify({
				name: "MUSE Brain",
				phase: getCurrentCircadianPhase().phase
			}), { headers: { "Content-Type": "application/json", ...corsHeaders } });
		}

		return new Response("Not Found", { status: 404, headers: corsHeaders });
	},

	// Daemon cron
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log("Daemon cycle starting...", getTimestamp());

		let totalDecayChanges = 0;
		let totalNoveltyChanges = 0;

		for (const tenant of resolveAllowedTenants(env)) {
			const storage = createStorage(resolveStorageConfig(env), tenant);
			let decayChanges = 0;

			// Sprint 4: Daemon Intelligence tasks run FIRST (before decay pass).
			// Proposals need to see pre-decay charge phases — the decay pass promotes
			// active → processing, narrowing the proposal candidate pool.
			try {
				const daemonResults = await runDaemonTasks(storage);
				for (const r of daemonResults) {
					const errSuffix = r.error ? ` (error: ${r.error})` : "";
					console.log(`Daemon [${tenant}] ${r.task}: ${r.changes} changes, ${r.proposals_created} proposals${errSuffix}`);
				}
			} catch (e) {
				console.error(`Daemon [${tenant}] Sprint 4 error:`, e);
			}

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();

			// Decay pass: identify changed observations, update individually (no destructive territory rewrite).
			const decayTexturesToUpdate: { id: string; texture: Observation["texture"] }[] = [];

			for (const { observations: obs } of territoryData) {
				for (const o of obs) {
					if (o.texture?.salience === "foundational") continue;

					const lastAccessed = o.last_accessed || o.created;
					if (!lastAccessed) continue;

					const age = (Date.now() - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
					const originalTexture = JSON.stringify(o.texture);

					if (age > 7 && o.texture?.vividness === "crystalline") {
						o.texture.vividness = "vivid";
					} else if (age > 30 && o.texture?.vividness === "vivid") {
						o.texture.vividness = "soft";
					}

					if (age > 14 && o.texture?.grip === "iron") {
						o.texture.grip = "strong";
					} else if (age > 60 && o.texture?.grip === "strong") {
						o.texture.grip = "present";
					}

					// Charge phase advancement: fresh → active after 1h, active → processing after 24h
					const FRESH_TO_ACTIVE_DAYS = 1 / 24; // 1 hour
					if (o.texture?.charge_phase === "fresh" && age > FRESH_TO_ACTIVE_DAYS) {
						o.texture.charge_phase = "active";
					} else if (o.texture?.charge_phase === "active" && age > 1) {
						o.texture.charge_phase = "processing";
					}

					if (JSON.stringify(o.texture) !== originalTexture) {
						decayTexturesToUpdate.push({ id: o.id, texture: o.texture });
					}
				}
			}

			// Batch UPDATE via unnest — single subrequest instead of N individual UPDATEs.
			await storage.bulkReplaceTexture(decayTexturesToUpdate);
			decayChanges = decayTexturesToUpdate.length;

			// Subconscious processing (v2 tool dispatch)
			try {
				await executeTool("mind_subconscious", { action: "process" }, { storage, ai: env.AI });
				console.log(`Daemon [${tenant}]: subconscious processed`);
			} catch (e) {
				console.error(`Daemon [${tenant}]: subconscious error`, e);
			}

			// Novelty regeneration — boost novelty_score for observations unsurfaced >30 days
			try {
				const noveltyTexturesToUpdate: { id: string; texture: Observation["texture"] }[] = [];

				for (const { observations } of territoryData) {
					for (const o of observations) {
						if (o.texture?.salience === "foundational") continue;

						if (!o.texture?.novelty_score) {
							if (!o.texture) continue;
							o.texture.novelty_score = 0.5;
							noveltyTexturesToUpdate.push({ id: o.id, texture: o.texture });
						} else if (o.texture.last_surfaced_at) {
							const daysSinceSurfaced = (Date.now() - new Date(o.texture.last_surfaced_at).getTime()) / (1000 * 60 * 60 * 24);
							if (daysSinceSurfaced >= 30 && o.texture.novelty_score < 0.8) {
								const boost = Math.min(0.1 * Math.floor(daysSinceSurfaced / 30), 0.5);
								o.texture.novelty_score = Math.min(o.texture.novelty_score + boost, 1.0);
								noveltyTexturesToUpdate.push({ id: o.id, texture: o.texture });
							}
						}
					}
				}

				await storage.bulkReplaceTexture(noveltyTexturesToUpdate);
				totalNoveltyChanges += noveltyTexturesToUpdate.length;
				console.log(`Daemon [${tenant}]: ${noveltyTexturesToUpdate.length} novelty regenerations`);
			} catch (e) {
				console.error(`Daemon [${tenant}]: novelty error`, e);
			}

			// One-time backfill: generate summaries for existing observations.
			try {
				const backfillDone = await storage.readBackfillFlag("v4");
				if (!backfillDone) {
					const backfillUpdates: { territory: string; obs: Observation }[] = [];

					for (const { territory, observations } of territoryData) {
						for (const obs of observations) {
							if (!obs.summary) {
								obs.summary = generateSummary(obs);
								backfillUpdates.push({ territory, obs });
							}
						}
					}

					await Promise.all(backfillUpdates.map(({ territory, obs }) =>
						storage.appendToTerritory(territory, obs)
					));

					await storage.writeBackfillFlag("v4", { completed: getTimestamp(), count: backfillUpdates.length });
					console.log(`Daemon [${tenant}]: backfilled ${backfillUpdates.length} summaries`);
				}
			} catch (e) {
				console.error(`Daemon [${tenant}]: backfill error`, e);
			}

			// Generate territory overviews + iron-grip index (every cron cycle)
			try {
				const now = Date.now();
				const cutoff48h = now - (48 * 60 * 60 * 1000);
				const overviews: TerritoryOverview[] = [];
				const ironIndex: IronGripEntry[] = [];

				for (const { territory, observations } of territoryData) {
					const charges: Record<string, number> = {};
					let ironCount = 0;
					const ironIds: string[] = [];
					let recentCount = 0;
					let maxTime = "";

					for (const o of observations) {
						for (const c of o.texture?.charge || []) charges[c] = (charges[c] || 0) + 1;
						if (o.texture?.grip === "iron") {
							ironCount++;
							ironIds.push(o.id);
							ironIndex.push({
								id: o.id,
								territory,
								summary: o.summary || generateSummary(o),
								charges: o.texture?.charge || [],
								pull: calculatePullStrength(o),
								updated: getTimestamp()
							});
						}
						try {
							if (new Date(o.created).getTime() > cutoff48h) recentCount++;
						} catch {}
						if (o.created && o.created > maxTime) maxTime = o.created;
					}

					const topCharges = Object.entries(charges).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
					const topGrip = ironCount > 0 ? "iron"
						: observations.some(o => o.texture?.grip === "strong") ? "strong" : "present";

					overviews.push({
						territory,
						observation_count: observations.length,
						top_charges: topCharges,
						top_grip: topGrip,
						recent_count: recentCount,
						iron_count: ironCount,
						iron_ids: ironIds,
						last_activity: maxTime || getTimestamp(),
						theme_summary: `${territory}: ${observations.length} obs, ${ironCount} iron, ${recentCount} recent`,
						generated_at: getTimestamp()
					});
				}

				await Promise.all([
					storage.writeOverviews(overviews),
					storage.writeIronGripIndex(ironIndex)
				]);

				console.log(`Daemon [${tenant}]: overviews generated (${overviews.length} territories, ${ironIndex.length} iron grip)`);
			} catch (e) {
				console.error(`Daemon [${tenant}]: overview generation error`, e);
			}

			// Embedding backfill — process up to 20 unembedded observations per cycle.
			// A bad row (see embedBackfillBatch) is skipped, never allowed to throw the whole
			// cycle's batch away — that all-or-nothing throw was the ~7%-coverage wedge.
			if (env.AI) {
				try {
					const provider = createEmbeddingProvider(env.AI);

					const rows = await storage.queryUnembedded(20);

					if (rows.length > 0) {
						const { embedded, skipped } = await embedBackfillBatch(provider, rows);

						if (embedded.length > 0) {
							await storage.bulkUpdateEmbeddings(embedded);
						}
						if (skipped.length > 0) {
							console.warn(`Daemon [${tenant}]: embedding backfill skipped ${skipped.length} rows`, skipped.map(s => s.id));
						}

						const remainingCount = await storage.countUnembedded();
						console.log(`Daemon [${tenant}]: backfilled ${embedded.length} embeddings (${remainingCount} remaining)`);
					}
				} catch (e) {
					console.error(`Daemon [${tenant}]: embedding backfill error`, e);
				}
			}

			console.log(`Daemon [${tenant}]: ${decayChanges} decay changes`);
			totalDecayChanges += decayChanges;
		}

		console.log(`Daemon complete. Decay: ${totalDecayChanges}, Novelty: ${totalNoveltyChanges}`);
	}
} satisfies ExportedHandler<Env>;
