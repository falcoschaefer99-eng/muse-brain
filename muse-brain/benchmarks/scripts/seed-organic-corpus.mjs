#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
	const args = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) continue;
		if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
			args.set(token, argv[i + 1]);
			i += 1;
		} else {
			args.set(token, "true");
		}
	}
	return {
		input: args.get("--input"),
		sqlitePath: args.get("--sqlite-path"),
		tenant: args.get("--tenant") ?? "companion"
	};
}

function runCompile(cwd) {
	const result = spawnSync("npx", ["tsc", "-p", "benchmarks/tsconfig.json"], {
		cwd,
		stdio: "inherit",
		env: process.env
	});
	if ((result.status ?? 1) !== 0) {
		throw new Error("Failed to compile benchmark workspace before seeding corpus.");
	}
}

function normalizeTexture(texture) {
	return {
		salience: texture?.salience ?? "active",
		vividness: texture?.vividness ?? "vivid",
		charge: Array.isArray(texture?.charge) ? texture.charge : [],
		grip: texture?.grip ?? "present",
		charge_phase: texture?.charge_phase ?? "processing",
		somatic: texture?.somatic
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.input || !args.sqlitePath) {
		throw new Error("Usage: node benchmarks/scripts/seed-organic-corpus.mjs --input <corpus.json> --sqlite-path <sqlite-file>");
	}

	const cwd = process.cwd();
	runCompile(cwd);

	const factoryPath = path.resolve(cwd, ".bench-dist/src/storage/factory.js");
	const { createStorage } = await import(`file://${factoryPath}`);
	const storage = createStorage({ backend: "sqlite", sqlitePath: args.sqlitePath }, args.tenant);

	const corpusRaw = JSON.parse(await readFile(path.resolve(cwd, args.input), "utf8"));
	if (!Array.isArray(corpusRaw)) throw new Error("Corpus must be a JSON array.");

	for (const row of corpusRaw) {
		if (!row?.id || !row?.content || !row?.territory || !row?.created) {
			throw new Error(`Invalid corpus row: ${JSON.stringify(row)}`);
		}
		await storage.appendToTerritory(row.territory, {
			id: row.id,
			content: row.content,
			territory: row.territory,
			created: row.created,
			texture: normalizeTexture(row.texture),
			context: row.context,
			type: row.type,
			tags: row.tags,
			access_count: 0
		});
	}
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
