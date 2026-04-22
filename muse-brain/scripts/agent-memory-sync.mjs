#!/usr/bin/env node

/**
 * Agent Memory -> MUSE Brain sync bridge.
 *
 * Why: Claude Code subagents persist learnings in local markdown files
 * (~/.claude/agents/memory/*) but cannot call MCP tools directly.
 *
 * This script bridges that gap by reading local agent memory files and writing
 * observations into MUSE Brain via the authenticated MCP endpoint.
 *
 * Usage:
 *   MUSE_BRAIN_API_KEY=... node scripts/agent-memory-sync.mjs --endpoint https://brain.example.com --tenant rainer
 *   node scripts/agent-memory-sync.mjs --dry-run --agent michael
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const DEFAULT_SOURCE = path.join(os.homedir(), ".claude", "agents", "memory");
const DEFAULT_STATE_NAME = ".brain-sync-state.json";
const MAX_OBSERVE_CONTENT = 50_000;
const CHUNK_SIZE = 40_000;

function parseArgs(argv) {
	const options = {
		source: DEFAULT_SOURCE,
		endpoint: process.env.MUSE_BRAIN_BASE_URL || "http://127.0.0.1:8787",
		tenant: process.env.MUSE_BRAIN_TENANT || "rainer",
		apiKey: process.env.MUSE_BRAIN_API_KEY || process.env.ROOK_BRAIN_API_KEY || process.env.BRAIN_API_KEY || "",
		agents: [],
		dryRun: false,
		limit: undefined,
		statePath: undefined
	};

	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token === "--source" && argv[i + 1]) options.source = argv[++i];
		else if (token === "--endpoint" && argv[i + 1]) options.endpoint = argv[++i];
		else if (token === "--tenant" && argv[i + 1]) options.tenant = argv[++i];
		else if (token === "--api-key" && argv[i + 1]) options.apiKey = argv[++i];
		else if (token === "--agent" && argv[i + 1]) options.agents.push(argv[++i].toLowerCase());
		else if (token === "--state" && argv[i + 1]) options.statePath = argv[++i];
		else if (token === "--limit" && argv[i + 1]) {
			const parsed = Number(argv[++i]);
			if (Number.isFinite(parsed) && parsed > 0) options.limit = Math.floor(parsed);
		} else if (token === "--dry-run") options.dryRun = true;
		else if (token === "--help" || token === "-h") {
			console.log(`Usage: node scripts/agent-memory-sync.mjs [options]

Options:
  --source <path>      Source root (default: ${DEFAULT_SOURCE})
  --endpoint <url>     Brain base URL or /mcp URL
  --tenant <name>      Tenant header value (default: rainer)
  --api-key <key>      Brain API key (or use env MUSE_BRAIN_API_KEY)
  --agent <name>       Agent filter (repeatable)
  --state <path>       State file path (default: <source>/${DEFAULT_STATE_NAME})
  --limit <n>          Max new entries to send this run
  --dry-run            Parse + plan only, no writes
  -h, --help           Show this help
`);
			process.exit(0);
		}
	}

	return options;
}

function normalizeMcpUrl(endpoint) {
	const trimmed = endpoint.trim().replace(/\/+$/, "");
	if (trimmed.endsWith("/mcp")) return trimmed;
	return `${trimmed}/mcp`;
}

function hashKey(input) {
	return crypto.createHash("sha1").update(input).digest("hex");
}

function splitByChunks(text, chunkSize = CHUNK_SIZE) {
	if (text.length <= chunkSize) return [text];
	const chunks = [];
	let cursor = 0;
	while (cursor < text.length) {
		let end = Math.min(cursor + chunkSize, text.length);
		if (end < text.length) {
			const newline = text.lastIndexOf("\n", end);
			if (newline > cursor + 2000) end = newline;
		}
		chunks.push(text.slice(cursor, end).trim());
		cursor = end;
	}
	return chunks.filter(Boolean);
}

function parseBulletLearnings(content) {
	const lines = content.split(/\r?\n/);
	const entries = [];
	const bulletRe = /^\s*-\s*\[(\d{4}-\d{2}-\d{2})\]\s+(.+?)\s*$/;

	for (const line of lines) {
		const match = bulletRe.exec(line);
		if (!match) continue;
		const [, date, statement] = match;
		entries.push({ date, statement: statement.trim() });
	}
	return entries;
}

async function collectAgentFiles(sourceRoot, agentFilters) {
	const out = [];
	const rootEntries = await fs.readdir(sourceRoot, { withFileTypes: true });

	for (const entry of rootEntries) {
		if (!entry.isDirectory()) continue;
		const agent = entry.name.toLowerCase();
		if (agentFilters.length > 0 && !agentFilters.includes(agent)) continue;

		const agentDir = path.join(sourceRoot, entry.name);
		const stack = [agentDir];
		while (stack.length > 0) {
			const dir = stack.pop();
			if (!dir) continue;
			const nested = await fs.readdir(dir, { withFileTypes: true });
			for (const child of nested) {
				const childPath = path.join(dir, child.name);
				if (child.isDirectory()) {
					stack.push(childPath);
					continue;
				}
				if (!child.isFile()) continue;
				if (!child.name.toLowerCase().endsWith(".md")) continue;
				out.push({
					agent: entry.name,
					fullPath: childPath,
					relativePath: path.relative(sourceRoot, childPath)
				});
			}
		}
	}

	out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
	return out;
}

function buildEntriesFromFile(agent, relativePath, raw) {
	const normalizedAgent = agent.trim();
	const bulletLearnings = parseBulletLearnings(raw);

	if (bulletLearnings.length > 0) {
		return bulletLearnings.map(({ date, statement }) => {
			const content = `[${normalizedAgent}] ${statement}`;
			const keyBasis = `${normalizedAgent}|${relativePath}|${date}|${statement}`;
			return {
				keyBasis,
				agent: normalizedAgent,
				content: content.slice(0, MAX_OBSERVE_CONTENT),
				context: `Agent memory backfill from ${relativePath} (date ${date})`,
				charge: ["learning", "agent_memory", normalizedAgent.toLowerCase()]
			};
		});
	}

	const trimmed = raw.trim();
	if (!trimmed) return [];

	const chunks = splitByChunks(trimmed);
	return chunks.map((chunk, index) => {
		const header = `[${normalizedAgent}] Memory file backfill (${relativePath})`;
		const content = `${header}\n\n${chunk}`.slice(0, MAX_OBSERVE_CONTENT);
		const keyBasis = `${normalizedAgent}|${relativePath}|chunk:${index + 1}|${chunk}`;
		return {
			keyBasis,
			agent: normalizedAgent,
			content,
			context: `Agent memory file backfill from ${relativePath}${chunks.length > 1 ? ` (chunk ${index + 1}/${chunks.length})` : ""}`,
			charge: ["learning", "agent_memory", normalizedAgent.toLowerCase()]
		};
	});
}

async function loadState(statePath) {
	try {
		const raw = await fs.readFile(statePath, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return { version: 1, synced: {} };
		return {
			version: 1,
			synced: parsed.synced && typeof parsed.synced === "object" ? parsed.synced : {}
		};
	} catch {
		return { version: 1, synced: {} };
	}
}

async function saveState(statePath, state) {
	await fs.mkdir(path.dirname(statePath), { recursive: true });
	await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function callMindObserve(mcpUrl, apiKey, tenant, entry, id) {
	const payload = {
		jsonrpc: "2.0",
		id,
		method: "tools/call",
		params: {
			name: "mind_observe",
			arguments: {
				mode: "observe",
				territory: "craft",
				salience: "background",
				grip: "present",
				charge: entry.charge,
				content: entry.content,
				context: entry.context,
				entity_name: entry.agent
			}
		}
	};

	const response = await fetch(mcpUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${apiKey}`,
			"X-Brain-Tenant": tenant
		},
		body: JSON.stringify(payload)
	});

	const raw = await response.text();
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`Non-JSON response (${response.status}): ${raw.slice(0, 280)}`);
	}

	if (!response.ok) {
		const message = parsed?.error || parsed?.message || raw;
		throw new Error(`HTTP ${response.status}: ${typeof message === "string" ? message : JSON.stringify(message)}`);
	}

	if (parsed?.error) {
		const message = parsed.error?.message || JSON.stringify(parsed.error);
		throw new Error(`MCP error: ${message}`);
	}

	const contentText = parsed?.result?.content?.[0]?.text;
	if (!contentText || typeof contentText !== "string") {
		throw new Error(`Unexpected MCP payload shape: ${JSON.stringify(parsed).slice(0, 300)}`);
	}

	let toolResult;
	try {
		toolResult = JSON.parse(contentText);
	} catch {
		throw new Error(`Tool result not JSON: ${contentText.slice(0, 280)}`);
	}

	if (toolResult?.error) {
		throw new Error(`mind_observe error: ${toolResult.error}`);
	}

	return toolResult;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const mcpUrl = normalizeMcpUrl(options.endpoint);
	const sourceRoot = path.resolve(options.source);
	const statePath = path.resolve(options.statePath || path.join(sourceRoot, DEFAULT_STATE_NAME));

	const files = await collectAgentFiles(sourceRoot, options.agents);
	if (files.length === 0) {
		console.log("No agent memory markdown files found.");
		return;
	}

	const state = await loadState(statePath);
	const queued = [];

	for (const file of files) {
		const raw = await fs.readFile(file.fullPath, "utf8");
		const entries = buildEntriesFromFile(file.agent, file.relativePath, raw);
		for (const entry of entries) {
			const key = hashKey(entry.keyBasis);
			if (state.synced[key]) continue;
			queued.push({ key, ...entry });
			if (options.limit && queued.length >= options.limit) break;
		}
		if (options.limit && queued.length >= options.limit) break;
	}

	console.log(`Found ${files.length} files, ${queued.length} new learning entries to sync.`);
	if (queued.length === 0) return;

	if (options.dryRun) {
		for (const preview of queued.slice(0, 15)) {
			console.log(`- [${preview.agent}] ${preview.context}`);
		}
		if (queued.length > 15) console.log(`... and ${queued.length - 15} more`);
		return;
	}

	if (!options.apiKey) {
		throw new Error("Missing API key. Set MUSE_BRAIN_API_KEY (or use --api-key).");
	}

	let sent = 0;
	let failed = 0;
	for (let i = 0; i < queued.length; i++) {
		const entry = queued[i];
		try {
			const result = await callMindObserve(mcpUrl, options.apiKey, options.tenant, entry, `sync-${i + 1}`);
			state.synced[entry.key] = {
				synced_at: new Date().toISOString(),
				observation_id: result?.id || null,
				agent: entry.agent,
				context: entry.context
			};
			sent += 1;
			if (sent % 20 === 0) await saveState(statePath, state);
			console.log(`✓ ${entry.agent} :: ${entry.context}`);
		} catch (err) {
			failed += 1;
			console.error(`✗ ${entry.agent} :: ${entry.context}`);
			console.error(`  ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	await saveState(statePath, state);
	console.log(`Done. sent=${sent}, failed=${failed}, state=${statePath}`);
	if (failed > 0) process.exitCode = 1;
}

main().catch(err => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
