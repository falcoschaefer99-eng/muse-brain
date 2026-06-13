#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
	const args = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) continue;
		args.set(token, argv[i + 1]);
		i += 1;
	}
	return {
		artifact: args.get("--artifact"),
		outputDir: args.get("--output-dir"),
		primaryProfile: args.get("--primary-profile") ?? "native",
		baselineProfile: args.get("--baseline-profile") ?? "flat"
	};
}

function aggregateByFamily(caseResults) {
	const map = new Map();
	for (const row of caseResults) {
		const family = row?.metadata?.family ?? row?.question_type ?? "unknown";
		const key = `${row.profile}::${family}`;
		const bucket = map.get(key) ?? {
			profile: row.profile,
			family,
			cases: 0,
			recall_at_1: 0,
			recall_at_5: 0,
			recall_at_10: 0,
			candidate_hit_rate: 0
		};
		bucket.cases += 1;
		bucket.recall_at_1 += row?.recall_at?.["1"] ?? 0;
		bucket.recall_at_5 += row?.recall_at?.["5"] ?? 0;
		bucket.recall_at_10 += row?.recall_at?.["10"] ?? 0;
		bucket.candidate_hit_rate += row?.candidate_hit ? 1 : 0;
		map.set(key, bucket);
	}
	return Array.from(map.values())
		.map(row => ({
			...row,
			recall_at_1: Number((row.recall_at_1 / row.cases).toFixed(4)),
			recall_at_5: Number((row.recall_at_5 / row.cases).toFixed(4)),
			recall_at_10: Number((row.recall_at_10 / row.cases).toFixed(4)),
			candidate_hit_rate: Number((row.candidate_hit_rate / row.cases).toFixed(4))
		}))
		.sort((a, b) => a.profile.localeCompare(b.profile) || a.family.localeCompare(b.family));
}

function compareTop1(caseResults, primaryProfile, baselineProfile) {
	const byCase = new Map();
	for (const row of caseResults) {
		if (!byCase.has(row.case_id)) {
			byCase.set(row.case_id, {
				case_id: row.case_id,
				family: row?.metadata?.family ?? row?.question_type ?? "unknown",
				evidence_ids: row.evidence_ids ?? [],
				profiles: {}
			});
		}
		const entry = byCase.get(row.case_id);
		entry.profiles[row.profile] = {
			top_id: row.returned_ids?.[0],
			top_is_hit: (row.hit_ranks ?? []).includes(1)
		};
	}

	const rows = [];
	for (const entry of byCase.values()) {
		const primary = entry.profiles[primaryProfile] ?? { top_id: undefined, top_is_hit: false };
		const baseline = entry.profiles[baselineProfile] ?? { top_id: undefined, top_is_hit: false };
		let verdict = "tie";
		if (primary.top_is_hit && !baseline.top_is_hit) verdict = `${primaryProfile}_win`;
		else if (!primary.top_is_hit && baseline.top_is_hit) verdict = `${baselineProfile}_win`;
		else if (primary.top_is_hit && baseline.top_is_hit) verdict = "both_hit";
		else if (!primary.top_is_hit && !baseline.top_is_hit) verdict = "both_miss";
		rows.push({
			case_id: entry.case_id,
			family: entry.family,
			primary_profile: primaryProfile,
			primary_top_id: primary.top_id,
			primary_top_is_hit: primary.top_is_hit,
			baseline_profile: baselineProfile,
			baseline_top_id: baseline.top_id,
			baseline_top_is_hit: baseline.top_is_hit,
			verdict
		});
	}

	return rows.sort((a, b) => a.family.localeCompare(b.family) || a.case_id.localeCompare(b.case_id));
}

function renderFamilyMarkdown(rows) {
	const lines = [
		"# Cognitive Advantage — Family Breakdown",
		"",
		"| Profile | Family | Cases | R@1 | R@5 | R@10 | Candidate Hit |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: |"
	];
	for (const row of rows) {
		lines.push(`| ${row.profile} | ${row.family} | ${row.cases} | ${row.recall_at_1} | ${row.recall_at_5} | ${row.recall_at_10} | ${row.candidate_hit_rate} |`);
	}
	return lines.join("\n");
}

function renderComparisonMarkdown(rows, primaryProfile, baselineProfile) {
	const lines = [
		`# Cognitive Advantage — Top1 Comparison (${primaryProfile} vs ${baselineProfile})`,
		"",
		"| Family | Case | " + `${primaryProfile} top1` + " | " + `${primaryProfile} hit@1` + " | " + `${baselineProfile} top1` + " | " + `${baselineProfile} hit@1` + " | Verdict |",
		"| --- | --- | --- | ---: | --- | ---: | --- |"
	];
	for (const row of rows) {
		lines.push(
			`| ${row.family} | ${row.case_id} | ${row.primary_top_id ?? "-"} | ${row.primary_top_is_hit ? "1" : "0"} | ${row.baseline_top_id ?? "-"} | ${row.baseline_top_is_hit ? "1" : "0"} | ${row.verdict} |`
		);
	}
	return lines.join("\n");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.artifact || !args.outputDir) {
		throw new Error("Usage: node benchmarks/scripts/cognitive-report.mjs --artifact <artifact.json> --output-dir <dir> [--primary-profile native] [--baseline-profile flat]");
	}

	const artifactPath = path.resolve(args.artifact);
	const outputDir = path.resolve(args.outputDir);
	const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
	const familyRows = aggregateByFamily(artifact.case_results ?? []);
	const comparisonRows = compareTop1(artifact.case_results ?? [], args.primaryProfile, args.baselineProfile);

	await mkdir(outputDir, { recursive: true });
	await writeFile(path.join(outputDir, "family-breakdown.json"), JSON.stringify(familyRows, null, 2));
	await writeFile(path.join(outputDir, "family-breakdown.md"), renderFamilyMarkdown(familyRows));
	await writeFile(path.join(outputDir, "profile-comparison.json"), JSON.stringify(comparisonRows, null, 2));
	await writeFile(
		path.join(outputDir, "profile-comparison.md"),
		renderComparisonMarkdown(comparisonRows, args.primaryProfile, args.baselineProfile)
	);
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
