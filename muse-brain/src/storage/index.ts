// ============ STORAGE BARREL ============
// Re-exports everything consumers need. Import from here, not from subdirectories.

export type {
	IBrainStorage,
	ObservationFilter,
	SimilarSearchOptions,
	SimilarResult,
	TextureUpdate,
	StorageConfig
} from "./interface";

export { createStorage } from "./factory";

// Export implementation class for tests and for callers that need the concrete type.
export { PostgresBrainStorage, createPostgresStorage } from "./postgres";
export { SQLiteBrainStorage, createSQLiteStorage } from "./sqlite";
