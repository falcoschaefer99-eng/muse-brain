import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import worker from '../src';
import { createStorage } from '../src/storage';
import { LEASE_CAPABILITIES, LEASE_HEADER, type BrainLease } from '../src/security/leases';

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

function makeLease(capabilities: string[] = [LEASE_CAPABILITIES.systemRoot], territory = 'craft'): BrainLease {
	return {
		lease_id: `lease_test_${capabilities.join('_')}`,
		agent_id: 'rainer',
		platform: 'codex',
		session_id: 'session_test',
		run_id: 'run_test',
		delegation_chain: ['falco', 'rainer'],
		capabilities: capabilities as BrainLease['capabilities'],
		scope: {
			tenant: 'rainer',
			territories: [territory]
		},
		issued_at: '2026-05-11T12:00:00.000Z',
		expires_at: '2099-01-01T00:00:00.000Z'
	};
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

	it('/mcp resolves human-facing tenant aliases', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'rook'
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(200);
	});

	it('/mcp stores alias-scoped writes under the canonical tenant', async () => {
		const writeResponse = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'rook'
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: {
						name: 'mind_letter',
						arguments: {
							action: 'write',
							to_context: 'chat',
							content: 'canonical tenant proof'
						}
					}
				})
			}),
			env,
			makeContext()
		);
		expect(writeResponse.status).toBe(200);

		const readResponse = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'companion'
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: {
						name: 'mind_letter',
						arguments: {
							action: 'read',
							context: 'chat',
							unread_only: true
						}
					}
				})
			}),
			env,
			makeContext()
		);

		expect(readResponse.status).toBe(200);
		const rpc = await readResponse.json() as any;
		const text = rpc.result.content[0].text;
		const result = JSON.parse(text);
		expect(result.count).toBe(1);
		expect(result.letters[0].content).toBe('canonical tenant proof');
	});

	it('/mcp persists presented header leases before returning tool results', async () => {
		const lease = makeLease([LEASE_CAPABILITIES.systemRoot]);
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'rainer',
					[LEASE_HEADER]: JSON.stringify(lease)
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: {
						name: 'mind_letter',
						arguments: {
							action: 'list',
							context: 'chat',
							limit: 1
						}
					}
				})
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(200);
		const storage = createStorage({ backend: 'sqlite', sqlitePath: env.SQLITE_PATH }, 'rainer');
		const recorded = await storage.getAgentLease(lease.lease_id);
		expect(recorded?.lease_id).toBe(lease.lease_id);
		expect(recorded?.status).toBe('active');
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

	it('/mcp required lease mode rejects missing leases before tool execution', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key'
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'mind_pull', arguments: { id: 'obs_missing' } }
				})
			}),
			{ ...env, LEASE_ENFORCEMENT_MODE: 'required' },
			makeContext()
		);

		expect(response.status).toBe(401);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Lease denied');
	});

	it('/mcp required lease mode enforces tool capabilities', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Lease': JSON.stringify(makeLease([LEASE_CAPABILITIES.memoryRead]))
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'mind_observe', arguments: { content: 'lease denial test', territory: 'craft' } }
				})
			}),
			{ ...env, LEASE_ENFORCEMENT_MODE: 'required' },
			makeContext()
		);

		expect(response.status).toBe(200);
		const payload = await response.json() as { error?: { message?: string; data?: { reason?: string } } };
		expect(payload.error?.message).toBe('Lease denied');
		expect(payload.error?.data?.reason).toBe('lease capability denied');
	});

	it('/mcp required lease mode allows scoped writes with observe.write', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Lease': JSON.stringify(makeLease([LEASE_CAPABILITIES.observeWrite]))
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'mind_observe', arguments: { content: 'lease allowed test', territory: 'craft', entity_id: 'ent_test' } }
				})
			}),
			{ ...env, LEASE_ENFORCEMENT_MODE: 'required' },
			makeContext()
		);

		expect(response.status).toBe(200);
		const payload = await response.json() as { result?: { content?: Array<{ text?: string }> }; error?: unknown };
		expect(payload.error).toBeUndefined();
		const text = payload.result?.content?.[0]?.text ?? '{}';
		const result = JSON.parse(text) as { observed?: boolean; territory?: string };
		expect(result.observed).toBe(true);
		expect(result.territory).toBe('craft');
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
