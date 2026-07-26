#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

	const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	return {
		input: args.get("--input"),
		outputRoot: args.get("--output-root") ?? `benchmarks/results/cognitive-advantage-${stamp}-lane`,
		sqliteBase: args.get("--sqlite-base") ?? `benchmarks/results/cognitive-advantage-${stamp}-lane`,
		profiles: args.get("--profiles") ?? "native,balanced,benchmark,flat",
		resultLimit: args.get("--result-limit") ?? "10",
		minSimilarity: args.get("--min-similarity") ?? "0.01",
		rerankTopN: args.get("--rerank-top-n") ?? "30"
	};
}

function runCommand(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
		env: process.env
	});
	if ((result.status ?? 1) !== 0) {
		throw new Error(`Command failed: ${command} ${args.join(" ")}`);
	}
}

function buildBenchmarkArgs({ input, outputDir, sqlitePath, profiles, resultLimit, minSimilarity, rerankTopN, withRerank }) {
	const args = [
		"run",
		"benchmark:retrieval",
		"--",
		"--dataset", "cognitive_advantage",
		"--input", input,
		"--output-dir", outputDir,
		"--sqlite-path", sqlitePath,
		"--profiles", profiles,
		"--result-limit", resultLimit,
		"--min-similarity", minSimilarity
	];
	if (withRerank) {
		args.push("--rerank-mode", "heuristic", "--rerank-top-n", rerankTopN);
	}
	return args;
}

function profileMap(artifact) {
	return new Map((artifact.profile_summaries ?? []).map(summary => [summary.profile, summary]));
}

async function renderLaneSummary(baseArtifactPath, rerankArtifactPath, outputPath) {
	const baseArtifact = JSON.parse(await readFile(baseArtifactPath, "utf8"));
	const rerankArtifact = JSON.parse(await readFile(rerankArtifactPath, "utf8"));
	const baseMap = profileMap(baseArtifact);
	const rerankMap = profileMap(rerankArtifact);
	const orderedProfiles = ["native", "balanced", "benchmark", "flat"];

	const lines = [
		"# Cognitive Advantage Lane Summary",
		"",
		`- Base artifact: ${baseArtifactPath}`,
		`- Rerank artifact: ${rerankArtifactPath}`,
		"",
		"| Profile | Base R@1 | Rerank R@1 | Delta |",
		"| --- | ---: | ---: | ---: |"
	];

	for (const profile of orderedProfiles) {
		const base = baseMap.get(profile);
		const rerank = rerankMap.get(profile);
		if (!base && !rerank) continue;
		const baseR1 = Number(base?.recall_at?.["1"] ?? 0);
		const rerankR1 = Number(rerank?.recall_at?.["1"] ?? 0);
		const delta = Number((rerankR1 - baseR1).toFixed(4));
		lines.push(`| ${profile} | ${baseR1} | ${rerankR1} | ${delta} |`);
	}

	const nativeBase = Number(baseMap.get("native")?.recall_at?.["1"] ?? 0);
	const flatBase = Number(baseMap.get("flat")?.recall_at?.["1"] ?? 0);
	const nativeRerank = Number(rerankMap.get("native")?.recall_at?.["1"] ?? 0);
	const flatRerank = Number(rerankMap.get("flat")?.recall_at?.["1"] ?? 0);
	lines.push("");
	lines.push(`- Native vs Flat gap (base): ${(nativeBase - flatBase).toFixed(4)}`);
	lines.push(`- Native vs Flat gap (rerank): ${(nativeRerank - flatRerank).toFixed(4)}`);

	await writeFile(outputPath, `${lines.join("\n")}\n`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.input) {
		throw new Error("Usage: node benchmarks/scripts/cognitive-lane.mjs --input <dataset.json> [--output-root <dir>]");
	}

	const cwd = process.cwd();
	const outputRoot = path.resolve(cwd, args.outputRoot);
	const baseDir = path.join(outputRoot, "base");
	const rerankDir = path.join(outputRoot, "rerank");
	await mkdir(baseDir, { recursive: true });
	await mkdir(rerankDir, { recursive: true });

	runCommand("npm", buildBenchmarkArgs({
		input: args.input,
		outputDir: baseDir,
		sqlitePath: `${args.sqliteBase}_base.sqlite`,
		profiles: args.profiles,
		resultLimit: args.resultLimit,
		minSimilarity: args.minSimilarity,
		rerankTopN: args.rerankTopN,
		withRerank: false
	}), cwd);
	runCommand("node", [
		"benchmarks/scripts/cognitive-report.mjs",
		"--artifact", path.join(baseDir, "artifact.json"),
		"--output-dir", baseDir,
		"--primary-profile", "native",
		"--baseline-profile", "flat"
	], cwd);

	runCommand("npm", buildBenchmarkArgs({
		input: args.input,
		outputDir: rerankDir,
		sqlitePath: `${args.sqliteBase}_rerank.sqlite`,
		profiles: args.profiles,
		resultLimit: args.resultLimit,
		minSimilarity: args.minSimilarity,
		rerankTopN: args.rerankTopN,
		withRerank: true
	}), cwd);
	runCommand("node", [
		"benchmarks/scripts/cognitive-report.mjs",
		"--artifact", path.join(rerankDir, "artifact.json"),
		"--output-dir", rerankDir,
		"--primary-profile", "native",
		"--baseline-profile", "flat"
	], cwd);

	await renderLaneSummary(
		path.join(baseDir, "artifact.json"),
		path.join(rerankDir, "artifact.json"),
		path.join(outputRoot, "lane-summary.md")
	);
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
