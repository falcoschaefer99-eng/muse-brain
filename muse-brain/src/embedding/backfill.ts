// ============ RESILIENT EMBEDDING BACKFILL ============
// A single bad row (transient provider error, unusual content) must skip itself, never
// poison its chunk-mates and never throw out of this helper. See
// src/embedding/workers-ai.ts:37-54 for why a whole embedBatch() call throws on ANY
// invalid element — this helper is what keeps that all-or-nothing behavior from
// wedging an entire cron cycle or /admin/backfill request.

import type { IEmbeddingProvider } from "./interface";

export interface BackfillRow {
	id: string;
	content: string;
}

export interface BackfillSkip {
	id: string;
	reason: string;
}

export interface BackfillResult {
	embedded: Array<{ id: string; embedding: number[] }>;
	skipped: BackfillSkip[];
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : "unknown embedding error";
}

/**
 * Embeds `rows` in chunks of at most `chunkSize`. Per chunk: try the batch call first
 * (cheap, one round trip). If the batch throws for ANY reason, fall back to embedding
 * each row in the chunk individually — a single bad row is recorded in `skipped` and the
 * rest of the chunk still succeeds. Never throws; every row ends up in exactly one of
 * `embedded` or `skipped`.
 */
export async function embedBackfillBatch(
	provider: IEmbeddingProvider,
	rows: BackfillRow[],
	options: { chunkSize?: number } = {}
): Promise<BackfillResult> {
	const chunkSize = Math.max(1, options.chunkSize ?? 50);
	const embedded: BackfillResult["embedded"] = [];
	const skipped: BackfillSkip[] = [];

	for (let i = 0; i < rows.length; i += chunkSize) {
		const chunk = rows.slice(i, i + chunkSize);

		try {
			const vectors = await provider.embedBatch(chunk.map(row => row.content));
			if (vectors.length !== chunk.length) {
				throw new Error(`Embedding batch size mismatch: expected ${chunk.length}, got ${vectors.length}`);
			}
			for (let j = 0; j < chunk.length; j += 1) {
				embedded.push({ id: chunk[j].id, embedding: vectors[j] });
			}
		} catch {
			// Batch failed for the whole chunk — fall back per-row so one poisoned row
			// doesn't take its chunk-mates down with it.
			for (const row of chunk) {
				try {
					const vector = await provider.embedText(row.content);
					embedded.push({ id: row.id, embedding: vector });
				} catch (rowErr) {
					skipped.push({ id: row.id, reason: errorMessage(rowErr) });
				}
			}
		}
	}

	return { embedded, skipped };
}
