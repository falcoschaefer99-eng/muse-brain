import type { BenchmarkCase, BenchmarkDocument } from "../types";

interface CognitiveAdvantageDocumentInput {
	id: string;
	content: string;
	created: string;
	type?: string;
	context?: string;
	tags?: string[];
	territory?: string;
	texture?: BenchmarkDocument["texture"];
}

interface CognitiveAdvantageCaseInput {
	case_id: string;
	query: string;
	answer?: string;
	family: string;
	evidence_ids: string[];
	documents?: CognitiveAdvantageDocumentInput[];
	use_existing_memory?: boolean;
	metadata?: Record<string, unknown>;
}

function toDocument(input: CognitiveAdvantageDocumentInput, family: string): BenchmarkDocument {
	return {
		id: input.id,
		content: input.content,
		created: input.created,
		type: input.type ?? "benchmark_memory",
		context: input.context,
		tags: input.tags ?? ["benchmark", "cognitive_advantage", family],
		territory: input.territory,
		texture: input.texture
	};
}

export function adaptCognitiveAdvantage(raw: CognitiveAdvantageCaseInput[]): BenchmarkCase[] {
	return raw.map(item => {
		const useExistingMemory = item.use_existing_memory === true;
		const documents = (item.documents ?? []).map(doc => toDocument(doc, item.family));
		const documentIds = new Set(documents.map(doc => doc.id));
		const missingEvidenceIds = useExistingMemory ? [] : item.evidence_ids.filter(id => !documentIds.has(id));
		const skipRetrievalReason = item.evidence_ids.length === 0
			|| (!useExistingMemory && missingEvidenceIds.length > 0)
			? "missing_evidence"
			: undefined;

		return {
			id: item.case_id,
			dataset: "cognitive_advantage",
			query: item.query,
			answer: item.answer,
			question_type: item.family,
			evidence_ids: item.evidence_ids,
			documents,
			skip_retrieval_reason: skipRetrievalReason,
			metadata: {
				family: item.family,
				use_existing_memory: useExistingMemory || undefined,
				...(missingEvidenceIds.length > 0 ? { adapter_warnings: [`missing_evidence_in_documents: ${missingEvidenceIds.join(",")}`] } : {}),
				...(item.metadata ?? {})
			}
		};
	});
}
