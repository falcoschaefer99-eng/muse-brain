import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import worker from '../src';
import { createStorage } from '../src/storage/factory';
import type { Observation } from '../src/types';

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

function makeContext(): ExecutionContext {
	return { waitUntil: (_promise: Promise<unknown>) => {} } as ExecutionContext;
}

function makeRequest(path: string, init?: RequestInit): Request {
	return new Request(`http://example.com${path}`, init);
}

/** Fake Workers AI binding — `run` mimics @cf/baai/bge-base-en-v1.5 shape. If
 * `poisonText` appears anywhere in the requested batch, the whole call throws
 * (matching real Workers AI batch-call semantics). */
function fakeAiBinding(poisonText?: string): Ai {
	return {
		run: async (_model: string, input: { text: string[] }) => {
			if (poisonText && input.text.includes(poisonText)) {
				throw new Error('fake AI batch failure');
			}
			return { data: input.text.map(() => new Array(768).fill(0.01)) };
		}
	} as unknown as Ai;
}

function makeObservation(id: string, content: string): Observation {
	return {
		id,
		content,
		territory: 'craft',
		created: new Date().toISOString(),
		texture: { salience: 'active', vividness: 'vivid', charge: [], grip: 'present', charge_phase: 'fresh' },
		access_count: 0
	};
}

describe('POST /admin/backfill', () => {
	let tempDir = '';
	let env: any;

	beforeAll(() => {
		patchTimingSafeEqual();
	});

	beforeEach(async () => {
		tempDir = mkdtempSync(join(tmpdir(), 'brain-admin-backfill-'));
		env = {
			API_KEY_COMPANION: 'companion-secret-key',
			STORAGE_BACKEND: 'sqlite',
			SQLITE_PATH: join(tempDir, 'brain.sqlite'),
			AI: fakeAiBinding()
		};

		const storage = createStorage({ backend: 'sqlite', sqlitePath: env.SQLITE_PATH }, 'companion');
		for (let i = 0; i < 3; i += 1) {
			await storage.appendToTerritory('craft', makeObservation(`obs_backfill_${i}`, `unembedded memory number ${i}`));
		}
	});

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	});

	function postBackfill(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
		return worker.fetch(
			makeRequest('/admin/backfill', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer companion-secret-key', ...headers },
				body: JSON.stringify(body)
			}),
			env,
			makeContext()
		);
	}

	it('rejects requests without valid auth', async () => {
		const response = await worker.fetch(
			makeRequest('/admin/backfill', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-key' },
				body: JSON.stringify({})
			}),
			env,
			makeContext()
		);
		expect(response.status).toBe(401);
	});

	it('coverage mode reports totals without triggering inference', async () => {
		const response = await postBackfill({ mode: 'coverage' });
		expect(response.status).toBe(200);
		const payload = await response.json() as { tenant: string; total: number; embedded: number };
		expect(payload.tenant).toBe('companion');
		expect(payload.total).toBe(3);
		expect(payload.embedded).toBe(0);
	});

	it('backfill mode embeds all unembedded rows and reports zero remaining', async () => {
		const response = await postBackfill({ mode: 'backfill', limit: 10, chunkSize: 2 });
		expect(response.status).toBe(200);
		const payload = await response.json() as {
			tenant: string; requested: number; embedded: number; skipped: unknown[]; remaining: number; backfilledIds: string[];
		};
		expect(payload.tenant).toBe('companion');
		expect(payload.requested).toBe(10);
		expect(payload.embedded).toBe(3);
		expect(payload.skipped).toEqual([]);
		expect(payload.remaining).toBe(0);
		expect(payload.backfilledIds.sort()).toEqual(['obs_backfill_0', 'obs_backfill_1', 'obs_backfill_2']);
	});

	it('defaults mode to backfill, limit to 200, chunkSize to 50 when omitted', async () => {
		const response = await postBackfill({});
		expect(response.status).toBe(200);
		const payload = await response.json() as { requested: number; embedded: number };
		expect(payload.requested).toBe(200);
		expect(payload.embedded).toBe(3);
	});

	it('isolates a poisoned row without failing the whole request', async () => {
		env.AI = fakeAiBinding('unembedded memory number 1');
		const response = await postBackfill({ mode: 'backfill', limit: 10, chunkSize: 50 });
		expect(response.status).toBe(200);
		const payload = await response.json() as { embedded: number; skipped: { id: string; reason: string }[]; remaining: number };
		expect(payload.embedded).toBe(2);
		expect(payload.skipped).toHaveLength(1);
		expect(payload.skipped[0].id).toBe('obs_backfill_1');
		expect(payload.remaining).toBe(1);
	});

	it('returns 503 in backfill mode when no AI binding is configured', async () => {
		const noAiEnv = { ...env, AI: undefined };
		const response = await worker.fetch(
			makeRequest('/admin/backfill', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer companion-secret-key' },
				body: JSON.stringify({ mode: 'backfill' })
			}),
			noAiEnv,
			makeContext()
		);
		expect(response.status).toBe(503);
	});

	it.each([
		[{ limit: 401 }],
		[{ limit: 0 }],
		[{ limit: 1.5 }],
		[{ mode: 'nonsense' }],
		[{ chunkSize: 0 }],
		[{ chunkSize: 101 }],
		[{ chunkSize: 1.5 }],
		[[]],
		['not an object']
	])('rejects invalid body %j with 400', async (body) => {
		const response = await postBackfill(body);
		expect(response.status).toBe(400);
	});

	it('rejects malformed JSON with 400', async () => {
		const response = await worker.fetch(
			makeRequest('/admin/backfill', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer companion-secret-key' },
				body: '{not json'
			}),
			env,
			makeContext()
		);
		expect(response.status).toBe(400);
	});

	it('is scoped to the resolved tenant — a different tenant sees its own empty queue', async () => {
		const rainerEnv = { ...env, API_KEY_RAINER: 'rainer-secret-key' };
		const response = await worker.fetch(
			makeRequest('/admin/backfill', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer rainer-secret-key' },
				body: JSON.stringify({ mode: 'coverage' })
			}),
			rainerEnv,
			makeContext()
		);
		expect(response.status).toBe(200);
		const payload = await response.json() as { tenant: string; total: number };
		expect(payload.tenant).toBe('rainer');
		expect(payload.total).toBe(0);
	});
});
