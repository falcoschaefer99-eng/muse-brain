// ============ EMBEDDING FACTORY ============
// createEmbeddingProvider returns the appropriate provider for the given AI binding.

import type { IEmbeddingProvider } from "./interface";
import { WorkersAIEmbeddingProvider } from "./workers-ai";

export function createEmbeddingProvider(ai: Ai): IEmbeddingProvider {
	return new WorkersAIEmbeddingProvider(ai);
}

export type { IEmbeddingProvider };
