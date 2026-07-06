import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import worker from '../src';

function patchTimingSafeEqual(): void {
	const subtle = (globalThis.crypto as any).subtle;
	if (!subtle.timingSafeEqual) {
		subtle.timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
			if (a.byteLength !== b.byteLength) return false;
			let diff = 0;
			for (let i = 0; i < a.byteLength; i += 1) {
				diff |= a[i] ^ b[i];
			}
			return diff === 0;
		};
	}
}

function makeContext(): ExecutionContext {
	return {
		waitUntil: (_promise: Promise<unknown>) => {}
	} as ExecutionContext;
}

function makeRequest(path: string, init?: RequestInit): Request {
	return new Request(`http://example.com${path}`, init);
}

describe('worker HTTP routes', () => {
	let tempDir = '';
	let env: any;

	beforeAll(() => {
		patchTimingSafeEqual();
	});

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'brain-worker-routes-'));
		env = {
			API_KEY: 'test-api-key',
			STORAGE_BACKEND: 'sqlite',
			SQLITE_PATH: join(tempDir, 'brain.sqlite')
		};
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it('/health responds without auth', async () => {
		const response = await worker.fetch(makeRequest('/health', { method: 'GET' }), env, makeContext());
		expect(response.status).toBe(200);
		const payload = await response.json() as { status?: string };
		expect(['ok', 'degraded']).toContain(payload.status);
	});

	it('/mcp rejects invalid auth', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-key' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(401);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Unauthorized');
	});

	it('/mcp rejects requests when API_KEY is unset', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
			}),
			{ ...env, API_KEY: '' },
			makeContext()
		);

		expect(response.status).toBe(503);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Service misconfigured');
	});

	it('/mcp rejects invalid tenant', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'hacker'
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(400);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Invalid tenant');
	});

	it('/mcp trims tenant header values', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': '  companion  '
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(200);
	});

	it('/mcp rejects tenant headers that exceed length limits', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'r'.repeat(65)
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(400);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Invalid tenant');
	});

	it('/mcp rejects malformed JSON payloads', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'companion'
				},
				body: '{bad json'
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(400);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Invalid JSON');
	});

	it('/mcp tools/list succeeds and replay is stable', async () => {
		const requestInit: RequestInit = {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-api-key',
				'X-Brain-Tenant': 'companion'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
		};

		const first = await worker.fetch(makeRequest('/mcp', requestInit), env, makeContext());
		const second = await worker.fetch(makeRequest('/mcp', requestInit), env, makeContext());

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);

		const firstPayload = await first.json() as { result?: { tools?: unknown[] } };
		const secondPayload = await second.json() as { result?: { tools?: unknown[] } };

		expect(Array.isArray(firstPayload.result?.tools)).toBe(true);
		expect((firstPayload.result?.tools?.length ?? 0)).toBeGreaterThan(0);
		expect(secondPayload.result?.tools?.length).toBe(firstPayload.result?.tools?.length);
	});

	it('/mcp SSE validates tenant header', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'GET',
				headers: {
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'hacker'
				}
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(400);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Invalid tenant');
	});

	it('/runtime/trigger rejects invalid auth', async () => {
		const response = await worker.fetch(
			makeRequest('/runtime/trigger', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-key' },
				body: JSON.stringify({ wake_kind: 'duty' })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(401);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Unauthorized');
	});

	it('/runtime/trigger rejects invalid tenant', async () => {
		const response = await worker.fetch(
			makeRequest('/runtime/trigger', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'hacker'
				},
				body: JSON.stringify({ wake_kind: 'duty' })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(400);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Invalid tenant');
	});

	it('/runtime/trigger rejects invalid payload shape', async () => {
		const response = await worker.fetch(
			makeRequest('/runtime/trigger', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'companion'
				},
				body: JSON.stringify([])
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(400);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Body must be a JSON object');
	});

	it('/runtime/trigger returns stable validation error on replay payload', async () => {
		const requestInit: RequestInit = {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-api-key',
				'X-Brain-Tenant': 'companion'
			},
			body: JSON.stringify({ wake_kind: 'not-real' })
		};

		const first = await worker.fetch(makeRequest('/runtime/trigger', requestInit), env, makeContext());
		const second = await worker.fetch(makeRequest('/runtime/trigger', requestInit), env, makeContext());

		expect(first.status).toBe(400);
		expect(second.status).toBe(400);

		const firstPayload = await first.json() as { error?: string };
		const secondPayload = await second.json() as { error?: string };
		expect(firstPayload.error).toMatch(/wake_kind must be one of/i);
		expect(secondPayload.error).toBe(firstPayload.error);
	});
});

// ============ KEY -> TENANT BINDING (ops/MICHAEL_TENANT_KEY_AUDIT_2026-07-06.md) ============

async function getSessionTenant(response: Response): Promise<string | undefined> {
	const payload = await response.json() as { result?: { content?: { text?: string }[] } };
	const text = payload.result?.content?.[0]?.text;
	if (!text) return undefined;
	const parsed = JSON.parse(text) as { agent_tenant?: string };
	return parsed.agent_tenant;
}

function getSessionRequest(headers: Record<string, string> = {}): RequestInit {
	return {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name: 'mind_runtime', arguments: { action: 'get_session' } }
		})
	};
}

describe('worker HTTP routes — per-tenant key binding', () => {
	let tempDir = '';
	let env: any;

	beforeAll(() => {
		patchTimingSafeEqual();
	});

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'brain-tenant-key-'));
		env = {
			API_KEY_COMPANION: 'companion-secret-key',
			API_KEY_RAINER: 'rainer-secret-key',
			STORAGE_BACKEND: 'sqlite',
			SQLITE_PATH: join(tempDir, 'brain.sqlite')
		};
	});

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	});

	it('key A resolves to tenant A (no header needed)', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({ Authorization: 'Bearer companion-secret-key' })),
			env,
			makeContext()
		);
		expect(response.status).toBe(200);
		expect(await getSessionTenant(response)).toBe('companion');
	});

	it('key B resolves to tenant B (no header needed)', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({ Authorization: 'Bearer rainer-secret-key' })),
			env,
			makeContext()
		);
		expect(response.status).toBe(200);
		expect(await getSessionTenant(response)).toBe('rainer');
	});

	it('unknown key is rejected with 401, never a default tenant', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({ Authorization: 'Bearer not-a-real-key' })),
			env,
			makeContext()
		);
		expect(response.status).toBe(401);
	});

	it('header mismatch with a per-tenant key is rejected with 403, never an override', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({
				Authorization: 'Bearer rainer-secret-key',
				'X-Brain-Tenant': 'companion'
			})),
			env,
			makeContext()
		);
		expect(response.status).toBe(403);
	});

	it('header matching the key-derived tenant is accepted (200)', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({
				Authorization: 'Bearer rainer-secret-key',
				'X-Brain-Tenant': 'rainer'
			})),
			env,
			makeContext()
		);
		expect(response.status).toBe(200);
		expect(await getSessionTenant(response)).toBe('rainer');
	});

	it('absent header is accepted — tenant is the key tenant (200)', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({ Authorization: 'Bearer companion-secret-key' })),
			env,
			makeContext()
		);
		expect(response.status).toBe(200);
		expect(await getSessionTenant(response)).toBe('companion');
	});

	it('fails closed: no per-tenant keys and no legacy API_KEY configured -> 503, never a default tenant', async () => {
		const noKeyEnv = { ...env, API_KEY_COMPANION: undefined, API_KEY_RAINER: undefined };
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({ Authorization: 'Bearer anything' })),
			noKeyEnv,
			makeContext()
		);
		expect(response.status).toBe(503);
	});

	it('single-tenant self-host: only one per-tenant key configured makes that the only reachable tenant', async () => {
		const singleTenantEnv = { ...env, API_KEY_COMPANION: undefined };
		const ok = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({ Authorization: 'Bearer rainer-secret-key' })),
			singleTenantEnv,
			makeContext()
		);
		expect(ok.status).toBe(200);
		expect(await getSessionTenant(ok)).toBe('rainer');

		// The header can't reach a tenant that has no key bound, even though "companion" is
		// still in the compiled-in tenant vocabulary.
		const mismatched = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({
				Authorization: 'Bearer rainer-secret-key',
				'X-Brain-Tenant': 'companion'
			})),
			singleTenantEnv,
			makeContext()
		);
		expect(mismatched.status).toBe(403);
	});

	it('M1 (Michael, PASS WITH CONDITIONS re-review): a per-tenant key reused as the legacy key value is a hard config error, not a reopened cross-tenant path', async () => {
		// Operator misconfiguration: API_KEY_RAINER was set to the SAME value as the
		// still-configured legacy API_KEY. Before the M1 fix, this bearer would resolve via
		// the legacy candidate (pushed last, matched last) -> keyTenant=null ->
		// header-authoritative -> the header cross-check reopens, letting the caller name
		// ANY tenant again. Must now fail closed with 503, for every bearer, not just the
		// shared one.
		const duplicateEnv = { ...env, API_KEY: 'rainer-secret-key' };

		const withSharedKey = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({
				Authorization: 'Bearer rainer-secret-key',
				'X-Brain-Tenant': 'companion'
			})),
			duplicateEnv,
			makeContext()
		);
		expect(withSharedKey.status).toBe(503);

		const withUnrelatedKey = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({ Authorization: 'Bearer companion-secret-key' })),
			duplicateEnv,
			makeContext()
		);
		expect(withUnrelatedKey.status).toBe(503);
	});

	it('mind_letter sender is forced to the key-derived tenant, not any header value', async () => {
		const writeLetter: RequestInit = {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: 'Bearer rainer-secret-key' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'mind_letter',
					arguments: { action: 'write', to: 'companion', to_context: 'chat', content: 'hello from rainer' }
				}
			})
		};

		const response = await worker.fetch(makeRequest('/mcp', writeLetter), env, makeContext());
		expect(response.status).toBe(200);

		const { SQLiteBrainStorage } = await import('../src/storage/sqlite');
		const companionStorage = new SQLiteBrainStorage(join(tempDir, 'brain.sqlite'), 'companion');
		const letters = await companionStorage.readLetters();
		expect(letters).toHaveLength(1);
		expect(letters[0].from_context).toBe('rainer');
	});

	it('a spoofed header cannot forge cross-tenant sender identity — request is rejected before the tool ever runs', async () => {
		const writeLetter: RequestInit = {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer rainer-secret-key',
				// Attacker tries to pose as companion by setting the header — must 403, not write anything.
				'X-Brain-Tenant': 'companion'
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'mind_letter',
					arguments: { action: 'write', to: 'rainer', to_context: 'chat', content: 'spoofed sender attempt' }
				}
			})
		};

		const response = await worker.fetch(makeRequest('/mcp', writeLetter), env, makeContext());
		expect(response.status).toBe(403);

		const { SQLiteBrainStorage } = await import('../src/storage/sqlite');
		const rainerStorage = new SQLiteBrainStorage(join(tempDir, 'brain.sqlite'), 'rainer');
		const letters = await rainerStorage.readLetters();
		expect(letters).toHaveLength(0);
	});
});

describe('worker HTTP routes — legacy shared-key dual-accept transition', () => {
	let tempDir = '';
	let env: any;

	beforeAll(() => {
		patchTimingSafeEqual();
	});

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'brain-legacy-key-'));
		env = {
			API_KEY: 'legacy-shared-key',
			STORAGE_BACKEND: 'sqlite',
			SQLITE_PATH: join(tempDir, 'brain.sqlite')
		};
	});

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	});

	it('legacy key + header keeps header-derived-tenant behavior and logs a deprecation warning', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({
				Authorization: 'Bearer legacy-shared-key',
				'X-Brain-Tenant': 'companion'
			})),
			env,
			makeContext()
		);
		expect(response.status).toBe(200);
		expect(await getSessionTenant(response)).toBe('companion');
		expect(warnSpy).toHaveBeenCalled();
		const loggedPayload = warnSpy.mock.calls.map(call => String(call[0])).join('\n');
		expect(loggedPayload).toMatch(/deprecated_auth_legacy_api_key/);
		warnSpy.mockRestore();
	});

	it('legacy key without a header keeps the old default-to-"rainer" behavior', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({ Authorization: 'Bearer legacy-shared-key' })),
			env,
			makeContext()
		);
		expect(response.status).toBe(200);
		expect(await getSessionTenant(response)).toBe('rainer');
	});

	it('once the legacy secret is absent, the legacy bearer is rejected outright (no fallback) even when per-tenant keys have been rotated in', async () => {
		// Rotation in progress: a per-tenant key now exists alongside the (about to be
		// deleted) legacy key. Once API_KEY is removed, the legacy bearer must be
		// "unauthorized" (401) — there's still a valid auth path (rainer-secret-key), just
		// not for the legacy value.
		const rotatedEnv = { ...env, API_KEY: undefined, API_KEY_RAINER: 'rainer-secret-key' };
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({
				Authorization: 'Bearer legacy-shared-key',
				'X-Brain-Tenant': 'companion'
			})),
			rotatedEnv,
			makeContext()
		);
		expect(response.status).toBe(401);
	});

	it('once the legacy secret is absent with no per-tenant keys either, the service fails closed (503 misconfigured)', async () => {
		const noKeysEnv = { ...env, API_KEY: undefined };
		const response = await worker.fetch(
			makeRequest('/mcp', getSessionRequest({ Authorization: 'Bearer legacy-shared-key' })),
			noKeysEnv,
			makeContext()
		);
		expect(response.status).toBe(503);
	});
});
