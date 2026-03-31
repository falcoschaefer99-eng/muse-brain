// ============ STORAGE FACTORY ============
// Single entry point for creating IBrainStorage instances.
//
// Usage:
//   const storage = createStorage({ backend: 'postgres', databaseUrl: env.DATABASE_URL }, tenant);

import type { IBrainStorage, StorageConfig } from "./interface";
import { createPostgresStorage } from "./postgres";

export function createStorage(config: StorageConfig, tenant: string): IBrainStorage {
	if (config.backend !== "postgres") {
		throw new Error(`createStorage: unknown backend: ${String(config.backend)}`);
	}
	if (!config.databaseUrl) {
		throw new Error("createStorage: databaseUrl is required for postgres backend");
	}
	return createPostgresStorage(config.databaseUrl, tenant);
}
