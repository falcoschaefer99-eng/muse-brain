// ============ EMBEDDING PROVIDER INTERFACE ============
// Pure interface — no imports, no side effects.
// Implementations plug in at the factory layer.

export interface IEmbeddingProvider {
	readonly name: string;
	readonly dimensions: number;
	readonly modality: 'text' | 'text+image';
	embedText(text: string): Promise<number[]>;
	embedImage?(imageUrl: string): Promise<number[]>;
	embedBatch(texts: string[]): Promise<number[][]>;
}
