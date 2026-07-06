import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	discoverAuthCandidates,
	findDuplicateSecretValues,
	matchAuthCandidate,
	resolveAuth,
	tenantSecretName,
	timingSafeEqualBytes
} from '../src/auth';
import type { Env } from '../src/types';

function patchTimingSafeEqual(): void {
	const subtle = (globalThis.crypto as any).subtle;
	if (!subtle.timingSafeEqual) {
		subtle.timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
			if (a.byteLength !== b.byteLength) return false;
			let diff = 0;
			for (let i = 0; i < a.byteLength; i += 1) diff |= a[i] ^ b[i];
			return diff === 0;
		};
	}
}

describe('auth: key -> tenant binding', () => {
	beforeAll(() => {
		patchTimingSafeEqual();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('tenantSecretName', () => {
		it('uppercases and prefixes the tenant', () => {
			expect(tenantSecretName('rainer')).toBe('API_KEY_RAINER');
			expect(tenantSecretName('companion')).toBe('API_KEY_COMPANION');
		});

		it('replaces non [A-Z0-9] characters with underscores', () => {
			expect(tenantSecretName('new-co.beta')).toBe('API_KEY_NEW_CO_BETA');
		});
	});

	describe('discoverAuthCandidates', () => {
		it('finds one candidate per configured per-tenant secret, tagged with its env var name', () => {
			const env = { API_KEY_COMPANION: 'key-a', API_KEY_RAINER: 'key-b' } as unknown as Env;
			const candidates = discoverAuthCandidates(env);
			expect(candidates).toEqual(
				expect.arrayContaining([
					{ tenant: 'companion', key: 'key-a', legacy: false, envVar: 'API_KEY_COMPANION' },
					{ tenant: 'rainer', key: 'key-b', legacy: false, envVar: 'API_KEY_RAINER' }
				])
			);
			expect(candidates).toHaveLength(2);
		});

		it('ignores empty/whitespace-only per-tenant secrets', () => {
			const env = { API_KEY_COMPANION: '   ', API_KEY_RAINER: 'key-b' } as unknown as Env;
			const candidates = discoverAuthCandidates(env);
			expect(candidates).toEqual([{ tenant: 'rainer', key: 'key-b', legacy: false, envVar: 'API_KEY_RAINER' }]);
		});

		it('appends the legacy candidate (empty tenant, legacy: true, envVar "API_KEY") when API_KEY is configured', () => {
			const env = { API_KEY: 'legacy-key' } as unknown as Env;
			const candidates = discoverAuthCandidates(env);
			expect(candidates).toEqual([{ tenant: '', key: 'legacy-key', legacy: true, envVar: 'API_KEY' }]);
		});

		it('returns nothing when no keys at all are configured', () => {
			expect(discoverAuthCandidates({} as Env)).toEqual([]);
		});

		it('respects ALLOWED_TENANTS override when discovering per-tenant secrets', () => {
			const env = {
				ALLOWED_TENANTS: 'newco',
				API_KEY_NEWCO: 'newco-key',
				API_KEY_RAINER: 'should-be-ignored-not-in-allowlist'
			} as unknown as Env;
			const candidates = discoverAuthCandidates(env);
			expect(candidates).toEqual([{ tenant: 'newco', key: 'newco-key', legacy: false, envVar: 'API_KEY_NEWCO' }]);
		});
	});

	describe('findDuplicateSecretValues — M1 hardening (Michael, PASS WITH CONDITIONS re-review)', () => {
		it('finds no conflicts when every candidate has a distinct value', () => {
			const candidates = [
				{ tenant: 'companion', key: 'aaaa', legacy: false, envVar: 'API_KEY_COMPANION' },
				{ tenant: 'rainer', key: 'bbbb', legacy: false, envVar: 'API_KEY_RAINER' }
			];
			expect(findDuplicateSecretValues(candidates)).toEqual([]);
		});

		it('flags a per-tenant key reused as the legacy key (the exact M1 scenario)', () => {
			const candidates = [
				{ tenant: 'rainer', key: 'shared-value', legacy: false, envVar: 'API_KEY_RAINER' },
				{ tenant: '', key: 'shared-value', legacy: true, envVar: 'API_KEY' }
			];
			const conflicts = findDuplicateSecretValues(candidates);
			expect(conflicts).toEqual([{ envVarA: 'API_KEY_RAINER', envVarB: 'API_KEY' }]);
		});

		it('flags two tenants sharing the same key value', () => {
			const candidates = [
				{ tenant: 'companion', key: 'oops-same', legacy: false, envVar: 'API_KEY_COMPANION' },
				{ tenant: 'rainer', key: 'oops-same', legacy: false, envVar: 'API_KEY_RAINER' }
			];
			const conflicts = findDuplicateSecretValues(candidates);
			expect(conflicts).toEqual([{ envVarA: 'API_KEY_COMPANION', envVarB: 'API_KEY_RAINER' }]);
		});

		it('never includes secret VALUES in the reported conflict, only env var names', () => {
			const candidates = [
				{ tenant: 'companion', key: 'top-secret-value', legacy: false, envVar: 'API_KEY_COMPANION' },
				{ tenant: 'rainer', key: 'top-secret-value', legacy: false, envVar: 'API_KEY_RAINER' }
			];
			const conflicts = findDuplicateSecretValues(candidates);
			expect(JSON.stringify(conflicts)).not.toContain('top-secret-value');
		});
	});

	describe('matchAuthCandidate — timing-safety structural test', () => {
		it('calls the constant-time comparison for EVERY candidate, never short-circuiting on an early match', () => {
			const spy = vi.spyOn(globalThis.crypto.subtle, 'timingSafeEqual');
			const candidates = [
				{ tenant: 'companion', key: 'aaaa', legacy: false, envVar: 'API_KEY_COMPANION' },
				{ tenant: 'rainer', key: 'bbbb', legacy: false, envVar: 'API_KEY_RAINER' },
				{ tenant: 'third', key: 'cccc', legacy: false, envVar: 'API_KEY_THIRD' }
			];

			// Match is the FIRST candidate — if the loop short-circuited, later candidates
			// would never be compared. Assert all three were still compared.
			matchAuthCandidate('aaaa', candidates);
			expect(spy).toHaveBeenCalledTimes(3);
		});

		it('still compares every candidate when NOTHING matches', () => {
			const spy = vi.spyOn(globalThis.crypto.subtle, 'timingSafeEqual');
			const candidates = [
				{ tenant: 'companion', key: 'aaaa', legacy: false, envVar: 'API_KEY_COMPANION' },
				{ tenant: 'rainer', key: 'bbbb', legacy: false, envVar: 'API_KEY_RAINER' }
			];
			matchAuthCandidate('nope', candidates);
			expect(spy).toHaveBeenCalledTimes(2);
		});

		it('picks the correct candidate when the match is in the middle of the list', () => {
			const candidates = [
				{ tenant: 'companion', key: 'aaaa', legacy: false, envVar: 'API_KEY_COMPANION' },
				{ tenant: 'rainer', key: 'bbbb', legacy: false, envVar: 'API_KEY_RAINER' },
				{ tenant: 'third', key: 'cccc', legacy: false, envVar: 'API_KEY_THIRD' }
			];
			expect(matchAuthCandidate('bbbb', candidates)?.tenant).toBe('rainer');
		});

		describe('M1 hardening: non-legacy match always wins over a legacy match on the same value', () => {
			it('legacy evaluated FIRST, non-legacy SECOND — non-legacy still wins, and both are still compared', () => {
				const spy = vi.spyOn(globalThis.crypto.subtle, 'timingSafeEqual');
				const candidates = [
					{ tenant: '', key: 'shared-value', legacy: true, envVar: 'API_KEY' },
					{ tenant: 'rainer', key: 'shared-value', legacy: false, envVar: 'API_KEY_RAINER' }
				];
				const matched = matchAuthCandidate('shared-value', candidates);
				expect(matched).toEqual({ tenant: 'rainer', key: 'shared-value', legacy: false, envVar: 'API_KEY_RAINER' });
				expect(spy).toHaveBeenCalledTimes(2);
			});

			it('legacy evaluated LAST (real discoverAuthCandidates order) — non-legacy still wins', () => {
				const spy = vi.spyOn(globalThis.crypto.subtle, 'timingSafeEqual');
				const candidates = [
					{ tenant: 'rainer', key: 'shared-value', legacy: false, envVar: 'API_KEY_RAINER' },
					{ tenant: '', key: 'shared-value', legacy: true, envVar: 'API_KEY' }
				];
				const matched = matchAuthCandidate('shared-value', candidates);
				expect(matched?.legacy).toBe(false);
				expect(matched?.tenant).toBe('rainer');
				expect(spy).toHaveBeenCalledTimes(2);
			});

			it('falls back to the legacy match when NO non-legacy candidate matches', () => {
				const candidates = [
					{ tenant: 'companion', key: 'other-value', legacy: false, envVar: 'API_KEY_COMPANION' },
					{ tenant: '', key: 'legacy-only-value', legacy: true, envVar: 'API_KEY' }
				];
				const matched = matchAuthCandidate('legacy-only-value', candidates);
				expect(matched?.legacy).toBe(true);
			});
		});
	});

	describe('timingSafeEqualBytes', () => {
		it('returns false without calling the crypto API when lengths differ (still safe: no secret-dependent branch)', () => {
			const spy = vi.spyOn(globalThis.crypto.subtle, 'timingSafeEqual');
			const encoder = new TextEncoder();
			expect(timingSafeEqualBytes(encoder.encode('a'), encoder.encode('ab'))).toBe(false);
			expect(spy).not.toHaveBeenCalled();
		});
	});

	describe('resolveAuth — end-to-end resolution', () => {
		const env = {
			API_KEY_COMPANION: 'companion-secret',
			API_KEY_RAINER: 'rainer-secret'
		} as unknown as Env;

		it('key A resolves to tenant A', () => {
			expect(resolveAuth('companion-secret', env)).toEqual({ ok: true, tenant: 'companion', legacy: false });
		});

		it('key B resolves to tenant B', () => {
			expect(resolveAuth('rainer-secret', env)).toEqual({ ok: true, tenant: 'rainer', legacy: false });
		});

		it('unknown key is unauthorized, never defaults to a tenant', () => {
			expect(resolveAuth('not-a-real-key', env)).toEqual({ ok: false, reason: 'unauthorized' });
		});

		it('fails closed (misconfigured) when nothing is configured at all', () => {
			expect(resolveAuth('anything', {} as Env)).toEqual({ ok: false, reason: 'misconfigured' });
		});

		it('legacy key resolves with legacy: true and an empty tenant (tenant TBD from header)', () => {
			const legacyEnv = { API_KEY: 'legacy-secret' } as unknown as Env;
			expect(resolveAuth('legacy-secret', legacyEnv)).toEqual({ ok: true, tenant: '', legacy: true });
		});

		it('legacy bearer is rejected once the legacy secret is absent, even if it was valid before rotation', () => {
			const rotatedEnv = { API_KEY_RAINER: 'rainer-secret' } as unknown as Env;
			expect(resolveAuth('legacy-secret', rotatedEnv)).toEqual({ ok: false, reason: 'unauthorized' });
		});

		it('single-tenant self-host: exactly one per-tenant key configured resolves only that tenant', () => {
			const singleTenantEnv = { API_KEY_RAINER: 'only-key' } as unknown as Env;
			expect(resolveAuth('only-key', singleTenantEnv)).toEqual({ ok: true, tenant: 'rainer', legacy: false });
			expect(resolveAuth('anything-else', singleTenantEnv)).toEqual({ ok: false, reason: 'unauthorized' });
		});
	});

	describe('resolveAuth — M1: duplicate secret values are a hard config error (chosen consistent behavior)', () => {
		it('a per-tenant key reused as the legacy key value -> 503-class misconfigured, NOT a successful tenant resolution', () => {
			const env = { API_KEY_RAINER: 'shared-value', API_KEY: 'shared-value' } as unknown as Env;
			const result = resolveAuth('shared-value', env);
			expect(result.ok).toBe(false);
			expect(result).toMatchObject({ ok: false, reason: 'misconfigured' });
		});

		it('the misconfigured detail names only ENV VAR NAMES, never the shared secret value', () => {
			const env = { API_KEY_RAINER: 'top-secret-shared-value', API_KEY: 'top-secret-shared-value' } as unknown as Env;
			const result = resolveAuth('top-secret-shared-value', env);
			expect(result.ok).toBe(false);
			const detail = (result as { detail?: string }).detail ?? '';
			expect(detail).toContain('API_KEY_RAINER');
			expect(detail).toContain('API_KEY');
			expect(detail).not.toContain('top-secret-shared-value');
		});

		it('two tenants sharing the same key value -> misconfigured, even for an otherwise-correct bearer', () => {
			const env = { API_KEY_COMPANION: 'oops-same', API_KEY_RAINER: 'oops-same' } as unknown as Env;
			expect(resolveAuth('oops-same', env)).toMatchObject({ ok: false, reason: 'misconfigured' });
		});

		it('misconfigured (duplicate values) rejects EVERY bearer, not just the shared one', () => {
			const env = { API_KEY_COMPANION: 'oops-same', API_KEY_RAINER: 'oops-same' } as unknown as Env;
			expect(resolveAuth('some-other-random-bearer', env)).toMatchObject({ ok: false, reason: 'misconfigured' });
		});

		it('does NOT flag a config error when all configured values are distinct', () => {
			const env = {
				API_KEY_COMPANION: 'companion-secret',
				API_KEY_RAINER: 'rainer-secret',
				API_KEY: 'legacy-secret'
			} as unknown as Env;
			expect(resolveAuth('companion-secret', env)).toEqual({ ok: true, tenant: 'companion', legacy: false });
		});
	});
});
