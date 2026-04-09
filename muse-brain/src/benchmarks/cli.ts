import type { RetrievalProfile } from "../retrieval/query-signals";
import type { SupportedBenchmarkDataset } from "./adapters/index";

export interface CliOptions {
	dataset: SupportedBenchmarkDataset;
	input: string;
	output_dir: string;
	backend: "sqlite" | "postgres";
	sqlite_path?: string;
	database_url?: string;
	tenant: string;
	profiles: RetrievalProfile[];
	result_limit: number;
	min_similarity: number;
}

function requireValue(flag: string, value: string | undefined): string {
	if (!value) throw new Error(`Missing value for ${flag}`);
	return value;
}

function parseProfiles(value: string | undefined): RetrievalProfile[] {
	if (!value || value === "all") return ["native", "balanced", "benchmark"];
	return value.split(",").map(profile => profile.trim()).filter(Boolean) as RetrievalProfile[];
}

export function parseBenchmarkCliArgs(argv: string[]): CliOptions {
	const args = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) continue;
		args.set(token, argv[i + 1]);
		i += 1;
	}

	const dataset = requireValue("--dataset", args.get("--dataset")) as SupportedBenchmarkDataset;
	if (dataset !== "longmemeval" && dataset !== "locomo") {
		throw new Error(`Unsupported dataset: ${dataset}`);
	}

	const backend = (args.get("--backend") ?? "sqlite") as "sqlite" | "postgres";
	if (backend !== "sqlite" && backend !== "postgres") {
		throw new Error(`Unsupported backend: ${backend}`);
	}

	return {
		dataset,
		input: requireValue("--input", args.get("--input")),
		output_dir: args.get("--output-dir") ?? "benchmarks/results/latest",
		backend,
		sqlite_path: args.get("--sqlite-path") ?? "benchmarks/results/benchmark.sqlite",
		database_url: args.get("--database-url"),
		tenant: args.get("--tenant") ?? "companion",
		profiles: parseProfiles(args.get("--profiles")),
		result_limit: Number.parseInt(args.get("--result-limit") ?? "10", 10),
		min_similarity: Number.parseFloat(args.get("--min-similarity") ?? "0.01")
	};
}
