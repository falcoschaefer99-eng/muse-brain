import { describe, expect, it } from "vitest";

import { adaptLongMemEval } from "../src/benchmarks/adapters/longmemeval";
import { adaptLoCoMo } from "../src/benchmarks/adapters/locomo";
import { parseBenchmarkCliArgs } from "../src/benchmarks/cli";
import { renderBenchmarkSummaryMarkdown, runBenchmarkHarness } from "../src/benchmarks/harness";
import { createStorage } from "../src/storage/factory";

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
});

describe("benchmark harness", () => {
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
		expect(artifact.case_results[0].candidate_hit).toBe(true);
		expect(renderBenchmarkSummaryMarkdown(artifact)).toContain("| native |");
	});

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
});
