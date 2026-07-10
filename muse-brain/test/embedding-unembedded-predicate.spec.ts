import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStorage } from '../src/storage/factory';
import { createPostgresStorage } from '../src/storage/postgres';
import type { Observation } from '../src/types';

// Slice 1 — the nightly cron selects the oldest-N unembedded observations deterministically.
// A single empty-content row used to sit at the front of that queue forever (it can never be
// embedded — WorkersAIEmbeddingProvider throws on empty text) and poisoned the whole batch via
// embedBatch's throw-on-empty. This locks the fix: empty-content rows are excluded from
// selection entirely, on both storage backends.

function makeObservation(id: string, content: string): Observation {
	return {
		id,
		content,
		territory: 'craft',
		created: new Date().toISOString(),
		texture: {
			salience: 'active',
			vividness: 'vivid',
			charge: [],
			grip: 'present',
			charge_phase: 'fresh'
		},
		access_count: 0
	};
}

describe('queryUnembedded / countUnembedded exclude empty-content rows (sqlite)', () => {
	let tempDir = '';

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'brain-unembedded-predicate-'));
	});

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	});

	it('returns only the genuine unembedded row, never the empty-content one', async () => {
		const storage = createStorage({ backend: 'sqlite', sqlitePath: join(tempDir, 'brain.sqlite') }, 'companion');

		await storage.appendToTerritory('craft', makeObservation('obs_empty', ''));
		await storage.appendToTerritory('craft', makeObservation('obs_whitespace', '   '));
		await storage.appendToTerritory('craft', makeObservation('obs_real', 'a real memory worth embedding'));

		const rows = await storage.queryUnembedded(20);
		expect(rows.map(r => r.id)).toEqual(['obs_real']);

		const count = await storage.countUnembedded();
		expect(count).toBe(1);
	});

	// Regression: JS's `.trim()` (unlike Postgres's plain `btrim()`) already strips tabs
	// and newlines, so this is the executable twin proving the sqlite backend was never
	// exposed to the btrim(content) gap fixed in postgres.ts — it locks that parity.
	it('excludes tab/newline-only content — not just literal-space-only content', async () => {
		const storage = createStorage({ backend: 'sqlite', sqlitePath: join(tempDir, 'brain.sqlite') }, 'companion');

		await storage.appendToTerritory('craft', makeObservation('obs_tabs_newlines', '\t\n'));
		await storage.appendToTerritory('craft', makeObservation('obs_real', 'a real memory worth embedding'));

		const rows = await storage.queryUnembedded(20);
		expect(rows.map(r => r.id)).toEqual(['obs_real']);

		const count = await storage.countUnembedded();
		expect(count).toBe(1);
	});
});

// Structural check for the Postgres backend — no live Postgres in this test environment,
// so this asserts the SQL string itself rather than executing it. Locks the fix for
// https://www.postgresql.org/docs/current/functions-string.html#btrim: plain `btrim(content)`
// only strips literal spaces (U+0020); tab/newline/CR/form-feed/vertical-tab-only content
// would pass the old predicate and re-wedge the oldest-first backfill queue on the real
// production backend (sqlite never had this gap — see the behavioral case above).
describe('queryUnembedded / countUnembedded whitespace predicate (postgres — structural)', () => {
	function sqlTextOf(query: { strings: readonly string[] }): string {
		return query.strings.join('?');
	}

	function spySql() {
		const calls: { strings: readonly string[] }[] = [];
		const fn = (strings: TemplateStringsArray, ..._values: unknown[]) => {
			calls.push({ strings });
			return Promise.resolve([]);
		};
		return { fn, calls };
	}

	it('queryUnembedded strips the full whitespace class via btrim, not just literal spaces', async () => {
		const storage = createPostgresStorage('postgres://fake:fake@localhost:1/fake', 'companion') as any;
		const spy = spySql();
		storage.sql = spy.fn;

		await storage.queryUnembedded(10);

		expect(spy.calls).toHaveLength(1);
		const sqlText = sqlTextOf(spy.calls[0]);
		// Note: the source's `E' \t\n\r\f\v'` is a JS template literal — `\t` etc. are already
		// real control characters by the time this string exists, both in postgres.ts and here.
		expect(sqlText).toContain("btrim(content, E' \t\n\r\f\v')");
		expect(sqlText).not.toMatch(/btrim\(content\)\s*<>/);
	});

	it('countUnembedded mirrors the same whitespace predicate as queryUnembedded', async () => {
		const storage = createPostgresStorage('postgres://fake:fake@localhost:1/fake', 'companion') as any;
		const spy = spySql();
		storage.sql = spy.fn;

		await storage.countUnembedded();

		expect(spy.calls).toHaveLength(1);
		const sqlText = sqlTextOf(spy.calls[0]);
		expect(sqlText).toContain("btrim(content, E' \t\n\r\f\v')");
		expect(sqlText).not.toMatch(/btrim\(content\)\s*<>/);
	});
});
