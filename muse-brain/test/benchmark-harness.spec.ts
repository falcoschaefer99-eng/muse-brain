import { describe, expect, it } from "vitest";

import { adaptBenchmarkDataset } from "../src/benchmarks/adapters/index";
import { adaptLongMemEval } from "../src/benchmarks/adapters/longmemeval";
import { adaptLoCoMo } from "../src/benchmarks/adapters/locomo";
import { parseBenchmarkCliArgs } from "../src/benchmarks/cli";
import {
	buildCaseResult,
	renderBenchmarkSummaryMarkdown,
	runBenchmarkHarness,
	scoreCaseAtK,
	summarizeProfile
} from "../src/benchmarks/harness";
import type { BenchmarkCase } from "../src/benchmarks/types";
import { createStorage } from "../src/storage/factory";

function makeCase(overrides?: Partial<BenchmarkCase>): BenchmarkCase {
	return {
		id: "case_1",
		dataset: "longmemeval",
		query: "alpha",
		evidence_ids: ["doc_hit"],
		documents: [
			{
				id: "doc_hit",
				content: "alpha memory",
				created: "2026-04-01T00:00:00.000Z"
			}
		],
		...overrides
	};
}

describe("benchmark adapters", () => {
	it("adapts LongMemEval instances into benchmark cases", () => {
		const cases = adaptLongMemEval([{
			question_id: "q_1",
			question_type: "single-session-user",
			question: "What tea do I like?",
			answer: "oolong",
			question_date: "2026-04-01T00:00:00.000Z",
			haystack_session_ids: ["sess_1", "sess_2"],
			haystack_dates: ["2026-03-01T00:00:00.000Z", "2026-03-05T00:00:00.000Z"],
			haystack_sessions: [
				[{ role: "user", content: "I like oolong tea." }],
				[{ role: "assistant", content: "Noted." }]
			],
			answer_session_ids: ["sess_1"]
		}]);

		expect(cases).toHaveLength(1);
		expect(cases[0].documents).toHaveLength(2);
		expect(cases[0].evidence_ids).toEqual(["sess_1"]);
		expect(cases[0].documents[0].content).toContain("user: I like oolong tea.");
	});

	it("adapts LoCoMo QA entries and skips missing-evidence cases", () => {
		const cases = adaptLoCoMo([{
			sample_id: "sample_1",
			conversation: {
				speaker_a: "Alice",
				speaker_b: "Bob",
				session_1_date_time: "2026-03-01T00:00:00.000Z",
				session_1: [
					{ speaker: "Alice", dia_id: "d1", text: "I adopted a cat." },
					{ speaker: "Bob", dia_id: "d2", text: "Cute." }
				]
			},
			qa: [
				{ question: "What pet did Alice adopt?", answer: "a cat", category: "memory", evidence: ["d1"] },
				{ question: "What color was the moon?", answer: "unknown", category: "abstention", evidence: [] }
			]
		}]);

		expect(cases).toHaveLength(2);
		expect(cases[0].documents).toHaveLength(2);
		expect(cases[1].skip_retrieval_reason).toBe("missing_evidence");
	});

	it("validates adapter input shape", () => {
		expect(() => adaptBenchmarkDataset("longmemeval", { bad: true })).toThrow(/json array/i);
		expect(() => adaptBenchmarkDataset("locomo", [null])).toThrow(/contain objects/i);
	});
});

describe("benchmark scoring math", () => {
	it("computes true recall@k for multi-evidence questions", () => {
		const scored = scoreCaseAtK(["a", "noise"], ["a", "b", "c"], 2);
		expect(scored.recall).toBeCloseTo(1 / 3, 6);
	});

	it("computes NDCG and handles misses", () => {
		expect(scoreCaseAtK(["a"], ["a"], 1)).toEqual({ recall: 1, ndcg: 1 });
		expect(scoreCaseAtK(["x", "y"], ["a", "b"], 2)).toEqual({ recall: 0, ndcg: 0 });
	});
});

describe("benchmark pure helpers", () => {
	it("honors miss-category precedence including run_error override", () => {
		const baseCase = makeCase({ evidence_ids: ["doc_hit"] });
		expect(buildCaseResult(
			{ ...baseCase, skip_retrieval_reason: "abstention" },
			"native",
			[],
			[],
			[1]
		).miss_category).toBe("abstention");
		expect(buildCaseResult(
			{ ...baseCase, skip_retrieval_reason: "missing_evidence" },
			"native",
			[],
			[],
			[1]
		).miss_category).toBe("missing_evidence");
		expect(buildCaseResult(baseCase, "native", [], [], [1]).miss_category).toBe("no_results");
		expect(buildCaseResult(baseCase, "native", ["doc_noise"], [], [1]).miss_category).toBe("candidate_miss");
		expect(buildCaseResult(
			baseCase,
			"native",
			[],
			[],
			[1],
			{ force_miss_category: "run_error", run_error: "boom" }
		).miss_category).toBe("run_error");
	});

	it("excludes skipped + run_error from profile denominators", () => {
		const evalResult = buildCaseResult(
			makeCase({ evidence_ids: ["doc_hit", "doc_missing"] }),
			"native",
			["doc_hit"],
			[],
			[1, 5]
		);
		const skippedResult = buildCaseResult(
			makeCase({ id: "case_abs", skip_retrieval_reason: "abstention" }),
			"native",
			[],
			[],
			[1, 5]
		);
		const runErrorResult = buildCaseResult(
			makeCase({ id: "case_err" }),
			"native",
			[],
			[],
			[1, 5],
			{ force_miss_category: "run_error", run_error: "query failed" }
		);

		const summary = summarizeProfile("native", [evalResult, skippedResult, runErrorResult], [1, 5]);
		expect(summary.evaluated_cases).toBe(1);
		expect(summary.skipped_cases).toBe(2);
		expect(summary.recall_at["1"]).toBe(0.5);
		expect(summary.recall_at["5"]).toBe(0.5);
	});
});

describe("benchmark harness integration", () => {
	it("runs profile-based retrieval and produces summaries + miss analysis", async () => {
		const dbPath = `/tmp/muse-brain-benchmark-${crypto.randomUUID()}.sqlite`;
		const storage = createStorage({ backend: "sqlite", sqlitePath: dbPath }, "companion");
		const artifact = await runBenchmarkHarness({
			storage,
			backend: "sqlite",
			run_config: {
				dataset: "longmemeval",
				profiles: ["native", "balanced", "benchmark"],
				top_k: [1, 5, 10],
				result_limit: 10,
				min_similarity: 0.01
			},
			cases: adaptLongMemEval([{
				question_id: "q_tea",
				question_type: "single-session-user",
				question: "What tea do I like?",
				answer: "oolong",
				question_date: "2026-04-01T00:00:00.000Z",
				haystack_session_ids: ["sess_hit", "sess_noise"],
				haystack_dates: ["2026-03-01T00:00:00.000Z", "2026-03-02T00:00:00.000Z"],
				haystack_sessions: [
					[{ role: "user", content: "I like oolong tea." }],
					[{ role: "assistant", content: "The weather is mild." }]
				],
				answer_session_ids: ["sess_hit"]
			}])
		});

		expect(artifact.profile_summaries).toHaveLength(3);
		expect(artifact.profile_summaries.every(summary => summary.recall_at["1"] === 1)).toBe(true);
		expect(artifact.case_results).toHaveLength(3);
		expect(artifact.run_issues).toEqual([]);
		expect(renderBenchmarkSummaryMarkdown(artifact)).toContain("Run issues: 0");
	});

	it("uses fractional recall when only part of evidence set is retrieved", async () => {
		const dbPath = `/tmp/muse-brain-benchmark-multi-${crypto.randomUUID()}.sqlite`;
		const storage = createStorage({ backend: "sqlite", sqlitePath: dbPath }, "companion");
		const artifact = await runBenchmarkHarness({
			storage,
			backend: "sqlite",
			run_config: {
				dataset: "longmemeval",
				profiles: ["native"],
				top_k: [1],
				result_limit: 5,
				min_similarity: 0.01
			},
			cases: [makeCase({
				id: "case_multi",
				query: "alpha memory",
				evidence_ids: ["doc_hit", "doc_missing"],
				documents: [
					{ id: "doc_hit", content: "alpha memory", created: "2026-03-01T00:00:00.000Z" },
					{ id: "doc_noise", content: "unrelated", created: "2026-03-01T00:00:00.000Z" }
				]
			})]
		});

		expect(artifact.case_results).toHaveLength(1);
		expect(artifact.case_results[0].recall_at["1"]).toBe(0.5);
	});

	it("skips abstention cases before document insert", async () => {
		const dbPath = `/tmp/muse-brain-benchmark-skip-${crypto.randomUUID()}.sqlite`;
		const storage = createStorage({ backend: "sqlite", sqlitePath: dbPath }, "companion");
		let appendCalls = 0;
		const originalAppend = storage.appendToTerritory.bind(storage);
		(storage as any).appendToTerritory = async (...args: any[]) => {
			appendCalls += 1;
			return originalAppend(...args);
		};

		await runBenchmarkHarness({
			storage,
			backend: "sqlite",
			run_config: {
				dataset: "longmemeval",
				profiles: ["native", "benchmark"],
				top_k: [1],
				result_limit: 5,
				min_similarity: 0.01
			},
			cases: [makeCase({
				id: "case_abs",
				skip_retrieval_reason: "abstention",
				documents: [
					{ id: "doc1", content: "will not insert", created: "2026-03-01T00:00:00.000Z" }
				]
			})]
		});

		expect(appendCalls).toBe(0);
	});

	it("records query failures and continues other profiles", async () => {
		const dbPath = `/tmp/muse-brain-benchmark-errors-${crypto.randomUUID()}.sqlite`;
		const storage = createStorage({ backend: "sqlite", sqlitePath: dbPath }, "companion");
		const originalHybridSearch = storage.hybridSearch.bind(storage);
		(storage as any).hybridSearch = async (options: any) => {
			if (options.retrieval_profile === "balanced") throw new Error("synthetic failure");
			return originalHybridSearch(options);
		};

		const artifact = await runBenchmarkHarness({
			storage,
			backend: "sqlite",
			run_config: {
				dataset: "longmemeval",
				profiles: ["native", "balanced", "benchmark"],
				top_k: [1],
				result_limit: 5,
				min_similarity: 0.01
			},
			cases: [makeCase()]
		});

		expect(artifact.case_results).toHaveLength(3);
		expect(artifact.case_results.find(result => result.profile === "balanced")?.miss_category).toBe("run_error");
		expect(artifact.run_issues).toHaveLength(1);
		expect(artifact.profile_summaries.find(summary => summary.profile === "balanced")?.evaluated_cases).toBe(0);
	});

	it("executes vector path when embed_text is provided", async () => {
		const dbPath = `/tmp/muse-brain-benchmark-vector-${crypto.randomUUID()}.sqlite`;
		const storage = createStorage({ backend: "sqlite", sqlitePath: dbPath }, "companion");
		const embedded: string[] = [];
		const artifact = await runBenchmarkHarness({
			storage,
			backend: "sqlite",
			run_config: {
				dataset: "longmemeval",
				profiles: ["native"],
				top_k: [1],
				result_limit: 5,
				min_similarity: 0.01
			},
			cases: [makeCase()],
			embed_text: async (text: string) => {
				embedded.push(text);
				return [0.5, 0.2, 0.1];
			}
		});

		expect(artifact.config.vector_enabled).toBe(true);
		expect(embedded).toEqual(["alpha memory", "alpha"]);
	});
});

describe("benchmark CLI parsing", () => {
	it("parses CLI args for benchmark runner", () => {
		const parsed = parseBenchmarkCliArgs([
			"--dataset", "longmemeval",
			"--input", "fixtures/longmemeval.json",
			"--profiles", "native,benchmark"
		]);

		expect(parsed.dataset).toBe("longmemeval");
		expect(parsed.profiles).toEqual(["native", "benchmark"]);
		expect(parsed.backend).toBe("sqlite");
	});

	it("rejects invalid profile names and missing values", () => {
		expect(() => parseBenchmarkCliArgs([
			"--dataset", "longmemeval",
			"--input", "fixtures/longmemeval.json",
			"--profiles", "native,typo"
		])).toThrow(/Invalid profile: typo/);

		expect(() => parseBenchmarkCliArgs([
			"--dataset", "longmemeval",
			"--input"
		])).toThrow(/Missing value for --input/);
	});

	it("requires database url when backend is postgres", () => {
		expect(() => parseBenchmarkCliArgs([
			"--dataset", "locomo",
			"--input", "fixtures/locomo.json",
			"--backend", "postgres"
		])).toThrow(/--database-url/);
	});
});
