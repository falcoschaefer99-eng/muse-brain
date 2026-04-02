// ============ STORAGE FACTORY ============
// Single entry point for creating IBrainStorage instances.
//
// Usage:
//   const storage = createStorage({ backend: 'postgres', databaseUrl: env.DATABASE_URL }, tenant);

import type { IBrainStorage, StorageConfig } from "./interface";
import { createPostgresStorage } from "./postgres";
import { createSQLiteStorage } from "./sqlite";

export function createStorage(config: StorageConfig, tenant: string): IBrainStorage {
	if (config.backend === "postgres") {
		if (!config.databaseUrl) {
			throw new Error("createStorage: databaseUrl is required for postgres backend");
		}
		return createPostgresStorage(config.databaseUrl, tenant);
	}

	if (config.backend === "sqlite") {
		if (!config.sqlitePath) {
			throw new Error("createStorage: sqlitePath is required for sqlite backend");
		}
		return createSQLiteStorage(config.sqlitePath, tenant);
	}

	throw new Error(`createStorage: unknown backend: ${String((config as any).backend)}`);
}
