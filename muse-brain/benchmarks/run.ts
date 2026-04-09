import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { parseBenchmarkCliArgs } from "../src/benchmarks/cli";
import { adaptBenchmarkDataset } from "../src/benchmarks/adapters/index";
import { renderBenchmarkSummaryMarkdown, runBenchmarkHarness } from "../src/benchmarks/harness";
import { createStorage } from "../src/storage/factory";

async function main(): Promise<void> {
	const options = parseBenchmarkCliArgs(process.argv.slice(2));
	const raw = JSON.parse(await readFile(options.input, "utf8"));
	const cases = adaptBenchmarkDataset(options.dataset, raw);
	const storage = createStorage(
		options.backend === "sqlite"
			? { backend: "sqlite", sqlitePath: options.sqlite_path }
			: { backend: "postgres", databaseUrl: options.database_url },
		options.tenant
	);

	const artifact = await runBenchmarkHarness({
		storage,
		backend: options.backend,
		run_config: {
			dataset: options.dataset,
			profiles: options.profiles,
			top_k: [1, 5, 10],
			result_limit: options.result_limit,
			min_similarity: options.min_similarity
		},
		cases
	});

	const outputDir = path.resolve(options.output_dir);
	const missAnalysis = artifact.case_results.filter(result => Boolean(result.miss_category));
	await mkdir(outputDir, { recursive: true });
	await writeFile(path.join(outputDir, "artifact.json"), JSON.stringify(artifact, null, 2));
	await writeFile(path.join(outputDir, "summary.md"), renderBenchmarkSummaryMarkdown(artifact));
	await writeFile(path.join(outputDir, "miss-analysis.json"), JSON.stringify(missAnalysis, null, 2));
	await writeFile(path.join(outputDir, "run-issues.json"), JSON.stringify(artifact.run_issues, null, 2));
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
