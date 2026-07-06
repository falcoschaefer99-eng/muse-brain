// ============ AUTH — KEY→TENANT BINDING ============
// The presented bearer key IS the tenant identity. Tenant is never read from a
// caller-supplied header; the header is at most a cross-check against the key-derived
// tenant (see index.ts). This closes the FAIL verdict in
// ops/MICHAEL_TENANT_KEY_AUDIT_2026-07-06.md — fix #1 and #5.
//
// Dual-accept transition: while env.API_KEY (legacy, single shared key) is still
// configured, a bearer matching it authenticates via the LEGACY candidate and the
// caller falls back to header-derived tenant resolution (today's exact behavior,
// including the default-to-"rainer" fallback) — but every such request is logged as a
// deprecation warning. Once the legacy secret is deleted from the deployment, only
// per-tenant keys work and the service is strict. This makes key rotation a pure
// secrets operation with zero downtime — see ops/ for the rotation runbook.

import type { Env } from "./types";
import { resolveAllowedTenants } from "./tenant-config";

export interface KeyCandidate {
	/** Empty string for the legacy candidate — legacy auth doesn't bind a tenant by itself. */
	tenant: string;
	key: string;
	legacy: boolean;
}

export type AuthOutcome =
	| { ok: true; tenant: string; legacy: boolean }
	| { ok: false; reason: "misconfigured" | "unauthorized" };

const encoder = new TextEncoder();

export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	return crypto.subtle.timingSafeEqual(a, b);
}

/** API_KEY_<TENANT_UPPER>, e.g. tenant "rainer" -> "API_KEY_RAINER". Non [A-Z0-9] chars become "_". */
export function tenantSecretName(tenant: string): string {
	return `API_KEY_${tenant.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/**
 * Discovers every configured auth candidate: one per allowed tenant that has a non-empty
 * API_KEY_<TENANT> secret bound, plus the legacy env.API_KEY if it's still configured.
 * Adding a tenant is purely a secrets operation — bind API_KEY_<NEWTENANT> and it's
 * discoverable here with no code change, as long as the tenant is also in
 * resolveAllowedTenants(env).
 */
export function discoverAuthCandidates(env: Env): KeyCandidate[] {
	const allowedTenants = resolveAllowedTenants(env);
	// Per-tenant secrets are dynamic (API_KEY_<TENANT>) and not statically declared on
	// Env for every possible tenant — read via a loose Record view, intentionally.
	const bag = env as unknown as Record<string, string | undefined>;
	const candidates: KeyCandidate[] = [];

	for (const tenant of allowedTenants) {
		const raw = bag[tenantSecretName(tenant)]?.trim();
		if (raw) candidates.push({ tenant, key: raw, legacy: false });
	}

	const legacyRaw = env.API_KEY?.trim();
	if (legacyRaw) candidates.push({ tenant: "", key: legacyRaw, legacy: true });

	return candidates;
}

/**
 * Resolves which (if any) configured key the presented bearer matches.
 *
 * Constant-time discipline: iterates EVERY candidate unconditionally and never returns
 * early on a match, so the wall-clock time this function takes cannot reveal which
 * tenant (if any) the presented key belongs to — only whether *some* candidate matched.
 */
export function matchAuthCandidate(providedKey: string, candidates: readonly KeyCandidate[]): KeyCandidate | null {
	const providedBytes = encoder.encode(providedKey);
	let matched: KeyCandidate | null = null;
	for (const candidate of candidates) {
		const isMatch = timingSafeEqualBytes(providedBytes, encoder.encode(candidate.key));
		if (isMatch) matched = candidate;
	}
	return matched;
}

/**
 * Full auth resolution: discovers candidates, matches the bearer, and reports the
 * key-bound tenant. Fails closed — a valid key with no tenant mapping is unreachable by
 * construction (every non-legacy candidate carries its tenant), and an unmatched key
 * is always "unauthorized", never a default tenant.
 */
export function resolveAuth(providedKey: string, env: Env): AuthOutcome {
	const candidates = discoverAuthCandidates(env);
	if (candidates.length === 0) return { ok: false, reason: "misconfigured" };

	const matched = matchAuthCandidate(providedKey, candidates);
	if (!matched) return { ok: false, reason: "unauthorized" };

	return { ok: true, tenant: matched.tenant, legacy: matched.legacy };
}
