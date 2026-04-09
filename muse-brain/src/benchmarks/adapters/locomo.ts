import type { BenchmarkCase, BenchmarkDocument } from "../types";

interface LoCoMoTurn {
	speaker: string;
	dia_id: string;
	text: string;
}

interface LoCoMoQA {
	question: string;
	answer?: string;
	category?: string;
	evidence?: string[];
}

interface LoCoMoConversation {
	speaker_a?: string;
	speaker_b?: string;
	[key: string]: unknown;
}

interface LoCoMoSample {
	sample_id: string;
	conversation: LoCoMoConversation;
	qa: LoCoMoQA[];
}

function getSessionNumbers(conversation: LoCoMoConversation): number[] {
	return Object.keys(conversation)
		.map(key => {
			const match = key.match(/^session_(\d+)$/);
			return match ? Number.parseInt(match[1], 10) : NaN;
		})
		.filter(num => Number.isFinite(num))
		.sort((a, b) => a - b);
}

function flattenConversation(sample: LoCoMoSample): BenchmarkDocument[] {
	const documents: BenchmarkDocument[] = [];
	for (const sessionNumber of getSessionNumbers(sample.conversation)) {
		const turns = (sample.conversation[`session_${sessionNumber}`] as LoCoMoTurn[] | undefined) ?? [];
		const sessionDate = String(sample.conversation[`session_${sessionNumber}_date_time`] ?? new Date(0).toISOString());
		for (const turn of turns) {
			documents.push({
				id: turn.dia_id,
				content: `sample_id: ${sample.sample_id}\nsession: ${sessionNumber}\nsession_date: ${sessionDate}\n${turn.speaker}: ${turn.text}`,
				created: sessionDate,
				type: "benchmark_turn",
				tags: ["benchmark", "locomo", "dialog_turn"]
			});
		}
	}
	return documents;
}

export function adaptLoCoMo(raw: LoCoMoSample[]): BenchmarkCase[] {
	const cases: BenchmarkCase[] = [];
	for (const sample of raw) {
		const documents = flattenConversation(sample);
		sample.qa.forEach((qa, index) => {
			const evidenceIds = Array.isArray(qa.evidence) ? qa.evidence.filter(Boolean) : [];
			cases.push({
				id: `${sample.sample_id}:qa:${index + 1}`,
				dataset: "locomo",
				query: qa.question,
				answer: qa.answer,
				question_type: qa.category,
				evidence_ids: evidenceIds,
				documents,
				skip_retrieval_reason: evidenceIds.length === 0 ? "missing_evidence" : undefined,
				metadata: {
					sample_id: sample.sample_id,
					category: qa.category
				}
			});
		});
	}
	return cases;
}
