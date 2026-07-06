import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	discoverAuthCandidates,
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
		it('finds one candidate per configured per-tenant secret', () => {
			const env = { API_KEY_COMPANION: 'key-a', API_KEY_RAINER: 'key-b' } as unknown as Env;
			const candidates = discoverAuthCandidates(env);
			expect(candidates).toEqual(
				expect.arrayContaining([
					{ tenant: 'companion', key: 'key-a', legacy: false },
					{ tenant: 'rainer', key: 'key-b', legacy: false }
				])
			);
			expect(candidates).toHaveLength(2);
		});

		it('ignores empty/whitespace-only per-tenant secrets', () => {
			const env = { API_KEY_COMPANION: '   ', API_KEY_RAINER: 'key-b' } as unknown as Env;
			const candidates = discoverAuthCandidates(env);
			expect(candidates).toEqual([{ tenant: 'rainer', key: 'key-b', legacy: false }]);
		});

		it('appends the legacy candidate (empty tenant, legacy: true) when API_KEY is configured', () => {
			const env = { API_KEY: 'legacy-key' } as unknown as Env;
			const candidates = discoverAuthCandidates(env);
			expect(candidates).toEqual([{ tenant: '', key: 'legacy-key', legacy: true }]);
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
			expect(candidates).toEqual([{ tenant: 'newco', key: 'newco-key', legacy: false }]);
		});
	});

	describe('matchAuthCandidate — timing-safety structural test', () => {
		it('calls the constant-time comparison for EVERY candidate, never short-circuiting on an early match', () => {
			const spy = vi.spyOn(globalThis.crypto.subtle, 'timingSafeEqual');
			const candidates = [
				{ tenant: 'companion', key: 'aaaa', legacy: false },
				{ tenant: 'rainer', key: 'bbbb', legacy: false },
				{ tenant: 'third', key: 'cccc', legacy: false }
			];

			// Match is the FIRST candidate — if the loop short-circuited, later candidates
			// would never be compared. Assert all three were still compared.
			matchAuthCandidate('aaaa', candidates);
			expect(spy).toHaveBeenCalledTimes(3);
		});

		it('still compares every candidate when NOTHING matches', () => {
			const spy = vi.spyOn(globalThis.crypto.subtle, 'timingSafeEqual');
			const candidates = [
				{ tenant: 'companion', key: 'aaaa', legacy: false },
				{ tenant: 'rainer', key: 'bbbb', legacy: false }
			];
			matchAuthCandidate('nope', candidates);
			expect(spy).toHaveBeenCalledTimes(2);
		});

		it('picks the correct candidate when the match is in the middle of the list', () => {
			const candidates = [
				{ tenant: 'companion', key: 'aaaa', legacy: false },
				{ tenant: 'rainer', key: 'bbbb', legacy: false },
				{ tenant: 'third', key: 'cccc', legacy: false }
			];
			expect(matchAuthCandidate('bbbb', candidates)?.tenant).toBe('rainer');
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
});
