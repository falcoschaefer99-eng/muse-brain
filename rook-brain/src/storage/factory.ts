// ============ STORAGE FACTORY ============
// Single entry point for creating IBrainStorage instances.
// Supports 'postgres' backend now; 'r2' and 'sqlite' stubs for migration period.
//
// Usage:
//   const storage = createStorage({ backend: 'postgres', databaseUrl: env.DATABASE_URL }, tenant);

import type { IBrainStorage, StorageConfig } from "./interface";
import { createPostgresStorage } from "./postgres";

export function createStorage(config: StorageConfig, tenant: string): IBrainStorage {
	switch (config.backend) {
		case "postgres": {
			if (!config.databaseUrl) {
				throw new Error("createStorage: databaseUrl is required for postgres backend");
			}
			return createPostgresStorage(config.databaseUrl, tenant);
		}
		case "r2":
			// Migration period stub — callers using R2 instantiate BrainStorage directly.
			// Wire through here once the full migration is complete.
			throw new Error("createStorage: r2 backend not yet wired through factory — use BrainStorage directly");
		case "sqlite":
			// Future local-dev backend.
			throw new Error("createStorage: sqlite backend not yet implemented");
		default: {
			// Exhaustiveness check — TypeScript will catch unknown backends at compile time.
			const _exhaustive: never = config.backend;
			throw new Error(`createStorage: unknown backend: ${String(_exhaustive)}`);
		}
	}
}
