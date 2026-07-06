import { describe, expect, it } from 'vitest';
import {
	grantedTenantsFor,
	isKnownTenant,
	resolveAllowedTenants,
	resolveCrossTenantReadGrants,
	resolveTenantAlias,
	resolveTenantAliases
} from '../src/tenant-config';
import { ALLOWED_TENANTS } from '../src/constants';
import type { Env } from '../src/types';

describe('tenant-config: env-driven tenant vocabulary', () => {
	describe('resolveAllowedTenants', () => {
		it('defaults to the compiled-in ALLOWED_TENANTS constant with zero configuration', () => {
			expect(resolveAllowedTenants({} as Env)).toEqual(ALLOWED_TENANTS);
		});

		it('overrides via a comma-separated ALLOWED_TENANTS env var', () => {
			const env = { ALLOWED_TENANTS: 'companion,rainer,newco' } as unknown as Env;
			expect(resolveAllowedTenants(env)).toEqual(['companion', 'rainer', 'newco']);
		});

		it('trims whitespace and dedupes', () => {
			const env = { ALLOWED_TENANTS: ' companion , rainer , companion ' } as unknown as Env;
			expect(resolveAllowedTenants(env)).toEqual(['companion', 'rainer']);
		});

		it('falls back to the default when the override is empty/whitespace-only', () => {
			expect(resolveAllowedTenants({ ALLOWED_TENANTS: '   ' } as unknown as Env)).toEqual(ALLOWED_TENANTS);
			expect(resolveAllowedTenants({ ALLOWED_TENANTS: ',,,' } as unknown as Env)).toEqual(ALLOWED_TENANTS);
		});
	});

	describe('resolveTenantAliases / resolveTenantAlias', () => {
		it('defaults to no aliases', () => {
			expect(resolveTenantAliases({} as Env)).toEqual({});
			expect(resolveTenantAlias({} as Env, 'rook')).toBe('rook');
		});

		it('parses ALIAS:CANONICAL pairs and resolves through them', () => {
			const env = { TENANT_ALIASES: 'rook:companion' } as unknown as Env;
			expect(resolveTenantAliases(env)).toEqual({ rook: 'companion' });
			expect(resolveTenantAlias(env, 'rook')).toBe('companion');
		});

		it('passes unknown values through unchanged', () => {
			const env = { TENANT_ALIASES: 'rook:companion' } as unknown as Env;
			expect(resolveTenantAlias(env, 'rainer')).toBe('rainer');
		});

		it('parses multiple pairs', () => {
			const env = { TENANT_ALIASES: 'rook:companion,muse:rainer' } as unknown as Env;
			expect(resolveTenantAliases(env)).toEqual({ rook: 'companion', muse: 'rainer' });
		});
	});

	describe('isKnownTenant', () => {
		it('checks membership against the resolved allowlist', () => {
			expect(isKnownTenant({} as Env, 'rainer')).toBe(true);
			expect(isKnownTenant({} as Env, 'hacker')).toBe(false);
		});
	});

	describe('resolveCrossTenantReadGrants / grantedTenantsFor', () => {
		it('defaults to empty — no tenant may cross-read another without an explicit grant', () => {
			expect(resolveCrossTenantReadGrants({} as Env).size).toBe(0);
			expect(grantedTenantsFor({} as Env, 'rainer').size).toBe(0);
		});

		it('parses GRANTER:GRANTED pairs', () => {
			const env = { CROSS_TENANT_READ_GRANTS: 'rainer:companion' } as unknown as Env;
			expect(grantedTenantsFor(env, 'rainer').has('companion')).toBe(true);
			expect(grantedTenantsFor(env, 'companion').has('rainer')).toBe(false);
		});

		it('supports multiple pairs, including bidirectional grants', () => {
			const env = { CROSS_TENANT_READ_GRANTS: 'rainer:companion,companion:rainer' } as unknown as Env;
			expect(grantedTenantsFor(env, 'rainer')).toEqual(new Set(['companion']));
			expect(grantedTenantsFor(env, 'companion')).toEqual(new Set(['rainer']));
		});

		it('supports one granter having multiple grantees', () => {
			const env = { CROSS_TENANT_READ_GRANTS: 'rainer:companion,rainer:newco' } as unknown as Env;
			expect(grantedTenantsFor(env, 'rainer')).toEqual(new Set(['companion', 'newco']));
		});
	});
});
