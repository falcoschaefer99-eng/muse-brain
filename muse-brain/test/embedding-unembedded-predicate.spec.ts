import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStorage } from '../src/storage/factory';
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
});
