import type { RetrievalProfile } from "../retrieval/query-signals";

export interface BenchmarkDocument {
	id: string;
	content: string;
	created: string;
	type?: string;
	context?: string;
	tags?: string[];
}

export interface BenchmarkCase {
	id: string;
	dataset: string;
	query: string;
	answer?: string;
	question_type?: string;
	question_date?: string;
	evidence_ids: string[];
	documents: BenchmarkDocument[];
	skip_retrieval_reason?: string;
	metadata?: Record<string, unknown>;
}

export interface BenchmarkRunConfig {
	dataset: string;
	profiles: RetrievalProfile[];
	top_k: number[];
	result_limit: number;
	min_similarity: number;
}

export interface BenchmarkCaseResult {
	case_id: string;
	dataset: string;
	profile: RetrievalProfile;
	query: string;
	question_type?: string;
	evidence_ids: string[];
	returned_ids: string[];
	returned_count: number;
	hit_ranks: number[];
	recall_at: Record<string, number>;
	ndcg_at: Record<string, number>;
	candidate_hit: boolean;
	miss_category?: "abstention" | "missing_evidence" | "no_results" | "candidate_miss";
	top_results: Array<{
		id: string;
		score: number;
		match_sources: string[];
	}>;
	metadata?: Record<string, unknown>;
}

export interface BenchmarkProfileSummary {
	profile: RetrievalProfile;
	evaluated_cases: number;
	skipped_cases: number;
	recall_at: Record<string, number>;
	ndcg_at: Record<string, number>;
	candidate_hit_rate: number;
	miss_categories: Record<string, number>;
}

export interface BenchmarkArtifact {
	dataset: string;
	run_started_at: string;
	run_completed_at: string;
	config: BenchmarkRunConfig & {
		backend: "sqlite" | "postgres";
		vector_enabled: boolean;
	};
	profile_summaries: BenchmarkProfileSummary[];
	profile_comparison: Array<{
		profile: RetrievalProfile;
		recall_at_1?: number;
		recall_at_5?: number;
		recall_at_10?: number;
		ndcg_at_10?: number;
		candidate_hit_rate: number;
	}>;
	case_results: BenchmarkCaseResult[];
}
