import { describe, it, expect } from 'vitest';
import { embedBackfillBatch } from '../src/embedding/backfill';
import type { IEmbeddingProvider } from '../src/embedding/interface';

function makeProvider(poisonText: string): IEmbeddingProvider {
	return {
		name: 'fake-provider',
		dimensions: 3,
		modality: 'text',
		async embedText(text: string) {
			if (text === poisonText) throw new Error('poison row rejected by embedText');
			return [1, 2, 3];
		},
		async embedBatch(texts: string[]) {
			if (texts.includes(poisonText)) throw new Error('batch poisoned');
			return texts.map(() => [1, 2, 3]);
		}
	};
}

describe('embedBackfillBatch', () => {
	it('falls back to per-row embedding when a chunk throws, isolating only the poison row', async () => {
		const provider = makeProvider('BAD-ROW');
		const rows = [
			{ id: 'a', content: 'good content 1' },
			{ id: 'b', content: 'BAD-ROW' },
			{ id: 'c', content: 'good content 2' }
		];

		const result = await embedBackfillBatch(provider, rows, { chunkSize: 50 });

		expect(result.skipped).toEqual([{ id: 'b', reason: 'poison row rejected by embedText' }]);
		expect(result.embedded.map(e => e.id).sort()).toEqual(['a', 'c']);
		expect(result.embedded.every(e => e.embedding.length === 3)).toBe(true);
	});

	it('chunks input by chunkSize and never throws when a chunk is clean', async () => {
		const rows = Array.from({ length: 5 }, (_, i) => ({ id: `id${i}`, content: `text ${i}` }));
		let batchCalls = 0;
		const provider: IEmbeddingProvider = {
			name: 'counting-provider',
			dimensions: 3,
			modality: 'text',
			async embedText() { return [1, 2, 3]; },
			async embedBatch(texts: string[]) {
				batchCalls += 1;
				return texts.map(() => [1, 2, 3]);
			}
		};

		const result = await embedBackfillBatch(provider, rows, { chunkSize: 2 });

		expect(batchCalls).toBe(3); // ceil(5/2)
		expect(result.embedded).toHaveLength(5);
		expect(result.skipped).toHaveLength(0);
	});

	it('never throws out of the helper even when both batch and per-row fail', async () => {
		const provider: IEmbeddingProvider = {
			name: 'always-fails-provider',
			dimensions: 3,
			modality: 'text',
			async embedText() { throw new Error('always fails'); },
			async embedBatch() { throw new Error('always fails'); }
		};

		const result = await embedBackfillBatch(provider, [{ id: 'x', content: 'whatever' }]);

		expect(result.embedded).toHaveLength(0);
		expect(result.skipped).toEqual([{ id: 'x', reason: 'always fails' }]);
	});

	it('returns empty result for empty input without calling the provider', async () => {
		let called = false;
		const provider: IEmbeddingProvider = {
			name: 'unused-provider',
			dimensions: 3,
			modality: 'text',
			async embedText() { called = true; return [1, 2, 3]; },
			async embedBatch() { called = true; return []; }
		};

		const result = await embedBackfillBatch(provider, []);

		expect(result).toEqual({ embedded: [], skipped: [] });
		expect(called).toBe(false);
	});
});
