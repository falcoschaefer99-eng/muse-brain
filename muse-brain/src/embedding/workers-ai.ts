// ============ WORKERS AI EMBEDDING PROVIDER ============
// Implements IEmbeddingProvider using Cloudflare Workers AI.
// Model: @cf/baai/bge-base-en-v1.5 — 768-dimension text embeddings.
// Batch up to 100 texts in a single inference call.

import type { IEmbeddingProvider } from "./interface";

const MODEL = "@cf/baai/bge-base-en-v1.5";

// The Workers AI type definitions may lag behind available models.
// Cast to any to invoke the model by string name when it isn't in AiModels yet.
type AiRun = (model: string, input: { text: string[] }) => Promise<{ data: number[][] }>;

export class WorkersAIEmbeddingProvider implements IEmbeddingProvider {
	readonly name = MODEL;
	readonly dimensions = 768;
	readonly modality = 'text' as const;

	constructor(private readonly ai: Ai) {}

	async embedText(text: string): Promise<number[]> {
		if (!text || text.trim().length === 0) {
			throw new Error('Cannot embed empty text');
		}
		let result: { data: number[][] };
		try {
			result = await (this.ai.run as unknown as AiRun)(MODEL, { text: [text] });
		} catch (err) {
			throw new Error(`Workers AI embedText failed: ${err instanceof Error ? err.message : 'unknown error'}`);
		}
		if (!result?.data?.[0] || !Array.isArray(result.data[0])) {
			throw new Error('Workers AI returned invalid embedding result');
		}
		return result.data[0];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (!texts.length) return [];
		let result: { data: number[][] };
		try {
			result = await (this.ai.run as unknown as AiRun)(MODEL, { text: texts });
		} catch (err) {
			throw new Error(`Workers AI embedBatch failed: ${err instanceof Error ? err.message : 'unknown error'}`);
		}
		if (!result?.data || !Array.isArray(result.data)) {
			throw new Error('Workers AI returned invalid batch embedding result');
		}
		return texts.map((_, i) => {
			if (!result.data[i] || !Array.isArray(result.data[i])) {
				throw new Error(`Workers AI returned invalid embedding for index ${i}`);
			}
			return result.data[i];
		});
	}

	// embedImage not implemented — text-only model
}
