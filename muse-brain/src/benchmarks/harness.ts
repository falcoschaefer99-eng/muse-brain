import type { Observation } from "../types";
import type { IBrainStorage } from "../storage/interface";
import type { RetrievalProfile } from "../retrieval/query-signals";
import type {
	BenchmarkArtifact,
	BenchmarkCase,
	BenchmarkCaseResult,
	BenchmarkProfileSummary,
	BenchmarkRunIssue,
	BenchmarkRunConfig
} from "./types";

function makeObservationFromDocument(doc: BenchmarkCase["documents"][number]): Observation {
	return {
		id: doc.id,
		content: doc.content,
		territory: "episodic",
		created: doc.created,
		texture: {
			salience: "background",
			vividness: "soft",
			charge: [],
			grip: "present",
			charge_phase: "fresh"
		},
		context: doc.context,
		type: doc.type,
		tags: doc.tags,
		access_count: 0
	};
}

export function scoreCaseAtK(returnedIds: string[], evidenceIds: string[], k: number): { recall: number; ndcg: number } {
	const relevant = new Set(evidenceIds);
	const window = returnedIds.slice(0, k);
	const hits = window.filter(id => relevant.has(id)).length;

	let dcg = 0;
	for (let i = 0; i < window.length; i++) {
		if (relevant.has(window[i])) {
			dcg += 1 / Math.log2(i + 2);
		}
	}
	const idealCount = Math.min(relevant.size, k);
	let idcg = 0;
	for (let i = 0; i < idealCount; i++) {
		idcg += 1 / Math.log2(i + 2);
	}

	return {
		recall: relevant.size > 0 ? hits / relevant.size : 0,
		ndcg: idcg > 0 ? dcg / idcg : 0
	};
}

export function buildCaseResult(
	testCase: BenchmarkCase,
	profile: RetrievalProfile,
	returnedIds: string[],
	topResults: Array<{ id: string; score: number; match_sources: string[] }>,
	topK: number[],
	options?: {
		force_miss_category?: BenchmarkCaseResult["miss_category"];
		run_error?: string;
	}
): BenchmarkCaseResult {
	const recallAt: Record<string, number> = {};
	const ndcgAt: Record<string, number> = {};
	for (const k of topK) {
		const scored = scoreCaseAtK(returnedIds, testCase.evidence_ids, k);
		recallAt[String(k)] = scored.recall;
		ndcgAt[String(k)] = Number(scored.ndcg.toFixed(4));
	}

	const evidenceSet = new Set(testCase.evidence_ids);
	const hitRanks = returnedIds
		.map((id, index) => evidenceSet.has(id) ? index + 1 : 0)
		.filter(rank => rank > 0);

	let missCategory: BenchmarkCaseResult["miss_category"] | undefined;
	if (options?.force_miss_category) missCategory = options.force_miss_category;
	else if (testCase.skip_retrieval_reason === "abstention") missCategory = "abstention";
	else if (testCase.skip_retrieval_reason === "missing_evidence") missCategory = "missing_evidence";
	else if (returnedIds.length === 0) missCategory = "no_results";
	else if (hitRanks.length === 0) missCategory = "candidate_miss";

	return {
		case_id: testCase.id,
		dataset: testCase.dataset,
		profile,
		query: testCase.query,
		question_type: testCase.question_type,
		evidence_ids: testCase.evidence_ids,
		returned_ids: returnedIds,
		returned_count: returnedIds.length,
		hit_ranks: hitRanks,
		recall_at: recallAt,
		ndcg_at: ndcgAt,
		candidate_hit: hitRanks.length > 0,
		miss_category: missCategory,
		run_error: options?.run_error,
		top_results: topResults,
		metadata: testCase.metadata
	};
}

export function summarizeProfile(
	profile: RetrievalProfile,
	results: BenchmarkCaseResult[],
	topK: number[]
): BenchmarkProfileSummary {
	const evaluated = results.filter(
		result =>
			result.miss_category !== "abstention"
			&& result.miss_category !== "missing_evidence"
			&& result.miss_category !== "run_error"
	);
	const skipped = results.length - evaluated.length;
	const recallAt: Record<string, number> = {};
	const ndcgAt: Record<string, number> = {};

	for (const k of topK) {
		const key = String(k);
		const recallSum = evaluated.reduce((sum, result) => sum + (result.recall_at[key] ?? 0), 0);
		const ndcgSum = evaluated.reduce((sum, result) => sum + (result.ndcg_at[key] ?? 0), 0);
		recallAt[key] = evaluated.length ? Number((recallSum / evaluated.length).toFixed(4)) : 0;
		ndcgAt[key] = evaluated.length ? Number((ndcgSum / evaluated.length).toFixed(4)) : 0;
	}

	const missCategories: Record<string, number> = {};
	for (const result of results) {
		if (!result.miss_category) continue;
		missCategories[result.miss_category] = (missCategories[result.miss_category] ?? 0) + 1;
	}

	const candidateHitRate = evaluated.length
		? Number((evaluated.filter(result => result.candidate_hit).length / evaluated.length).toFixed(4))
		: 0;

	return {
		profile,
		evaluated_cases: evaluated.length,
		skipped_cases: skipped,
		recall_at: recallAt,
		ndcg_at: ndcgAt,
		candidate_hit_rate: candidateHitRate,
		miss_categories: missCategories
	};
}

export interface BenchmarkHarnessOptions {
	storage: IBrainStorage;
	backend: "sqlite" | "postgres";
	run_config: BenchmarkRunConfig;
	cases: BenchmarkCase[];
	embed_text?: (text: string) => Promise<number[]>;
}

export async function runBenchmarkHarness(options: BenchmarkHarnessOptions): Promise<BenchmarkArtifact> {
	const startedAt = new Date().toISOString();
	const storage = options.storage;
	const caseResults: BenchmarkCaseResult[] = [];
	const runIssues: BenchmarkRunIssue[] = [];

	for (const testCase of options.cases) {
		if (testCase.skip_retrieval_reason) {
			for (const profile of options.run_config.profiles) {
				caseResults.push(buildCaseResult(
					testCase,
					profile,
					[],
					[],
					options.run_config.top_k
				));
			}
			continue;
		}

		const observations = testCase.documents.map(makeObservationFromDocument);
		let caseReadyForQuery = true;
		try {
			for (const observation of observations) {
				await storage.appendToTerritory("episodic", observation);
				if (options.embed_text) {
					const embedding = await options.embed_text(observation.content);
					await storage.updateObservationEmbedding(observation.id, embedding);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			runIssues.push({
				case_id: testCase.id,
				stage: "insert_documents",
				message
			});
			caseReadyForQuery = false;
		}

		let queryEmbedding: number[] | undefined;
		if (caseReadyForQuery && options.embed_text) {
			try {
				queryEmbedding = await options.embed_text(testCase.query);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				runIssues.push({
					case_id: testCase.id,
					stage: "query",
					message: `query_embedding: ${message}`
				});
				caseReadyForQuery = false;
			}
		}

		for (const profile of options.run_config.profiles) {
			if (!caseReadyForQuery) {
				caseResults.push(buildCaseResult(
					testCase,
					profile,
					[],
					[],
					options.run_config.top_k,
					{
						force_miss_category: "run_error",
						run_error: "case_setup_failed"
					}
				));
				continue;
			}

			try {
				const results = await storage.hybridSearch({
					query: testCase.query,
					embedding: queryEmbedding,
					retrieval_profile: profile,
					limit: options.run_config.result_limit,
					min_similarity: options.run_config.min_similarity
				});

				caseResults.push(buildCaseResult(
					testCase,
					profile,
					results.map(result => result.observation.id),
					results.map(result => ({
						id: result.observation.id,
						score: Number(result.score.toFixed(4)),
						match_sources: result.match_sources
					})),
					options.run_config.top_k
				));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				runIssues.push({
					case_id: testCase.id,
					profile,
					stage: "query",
					message
				});
				caseResults.push(buildCaseResult(
					testCase,
					profile,
					[],
					[],
					options.run_config.top_k,
					{
						force_miss_category: "run_error",
						run_error: message
					}
				));
			}
		}

		for (const observation of observations) {
			try {
				await storage.deleteObservation(observation.id);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				runIssues.push({
					case_id: testCase.id,
					stage: "delete_documents",
					message: `${observation.id}: ${message}`
				});
			}
		}
	}

	const profileSummaries = options.run_config.profiles.map(profile =>
		summarizeProfile(
			profile,
			caseResults.filter(result => result.profile === profile),
			options.run_config.top_k
		)
	);

	const completedAt = new Date().toISOString();
	return {
		dataset: options.run_config.dataset,
		run_started_at: startedAt,
		run_completed_at: completedAt,
		config: {
			...options.run_config,
			backend: options.backend,
			vector_enabled: Boolean(options.embed_text)
		},
		profile_summaries: profileSummaries,
		profile_comparison: profileSummaries.map(summary => ({
			profile: summary.profile,
			recall_at_1: summary.recall_at["1"],
			recall_at_5: summary.recall_at["5"],
			recall_at_10: summary.recall_at["10"],
			ndcg_at_10: summary.ndcg_at["10"],
			candidate_hit_rate: summary.candidate_hit_rate
		})),
		case_results: caseResults,
		run_issues: runIssues
	};
}

export function renderBenchmarkSummaryMarkdown(artifact: BenchmarkArtifact): string {
	const lines = [
		`# MUSE Brain Benchmark Run — ${artifact.dataset}`,
		"",
		`- Started: ${artifact.run_started_at}`,
		`- Completed: ${artifact.run_completed_at}`,
		`- Backend: ${artifact.config.backend}`,
		`- Vector enabled: ${artifact.config.vector_enabled}`,
		`- Run issues: ${artifact.run_issues.length}`,
		"",
		"| Profile | R@1 | R@5 | R@10 | NDCG@10 | Candidate Hit | Evaluated | Skipped |",
		"|---|---:|---:|---:|---:|---:|---:|---:|"
	];

	for (const summary of artifact.profile_summaries) {
		lines.push(`| ${summary.profile} | ${summary.recall_at["1"] ?? 0} | ${summary.recall_at["5"] ?? 0} | ${summary.recall_at["10"] ?? 0} | ${summary.ndcg_at["10"] ?? 0} | ${summary.candidate_hit_rate} | ${summary.evaluated_cases} | ${summary.skipped_cases} |`);
	}

	return lines.join("\n");
}
