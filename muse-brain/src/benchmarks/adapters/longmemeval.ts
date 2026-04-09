import type { BenchmarkCase, BenchmarkDocument } from "../types";

interface LongMemEvalTurn {
	role: string;
	content: string;
	has_answer?: boolean;
}

interface LongMemEvalInstance {
	question_id: string;
	question_type: string;
	question: string;
	answer?: string;
	is_abstention?: boolean;
	abstention?: boolean;
	question_date?: string;
	haystack_session_ids: string[];
	haystack_dates: string[];
	haystack_sessions: LongMemEvalTurn[][];
	answer_session_ids?: string[];
}

function formatSessionContent(sessionId: string, sessionDate: string | undefined, turns: LongMemEvalTurn[]): string {
	const header = [`session_id: ${sessionId}`];
	if (sessionDate) header.push(`session_date: ${sessionDate}`);
	const body = turns.map(turn => `${turn.role}: ${turn.content}`).join("\n");
	return `${header.join("\n")}\n${body}`.trim();
}

function isAbstentionAnswer(answer: string | undefined): boolean {
	const text = String(answer ?? "").trim().toLowerCase();
	if (!text) return false;
	return [
		"unknown",
		"not sure",
		"cannot answer",
		"can't answer",
		"insufficient information",
		"not enough information",
		"no information",
		"n/a"
	].includes(text);
}

function detectAbstention(instance: LongMemEvalInstance): { detected: boolean; source: string } {
	if (instance.is_abstention === true || instance.abstention === true) {
		return { detected: true, source: "explicit_flag" };
	}
	if (instance.question_type.toLowerCase().includes("abstention")) {
		return { detected: true, source: "question_type" };
	}
	if (instance.question_id.endsWith("_abs")) {
		return { detected: true, source: "question_id_suffix" };
	}
	if ((instance.answer_session_ids?.length ?? 0) === 0 && isAbstentionAnswer(instance.answer)) {
		return { detected: true, source: "answer_text" };
	}
	return { detected: false, source: "none" };
}

export function adaptLongMemEval(raw: LongMemEvalInstance[]): BenchmarkCase[] {
	return raw.map(instance => {
		const adapterWarnings: string[] = [];
		if (instance.haystack_session_ids.length !== instance.haystack_sessions.length) {
			adapterWarnings.push(
				`haystack_session_ids(${instance.haystack_session_ids.length}) != haystack_sessions(${instance.haystack_sessions.length})`
			);
		}
		if (instance.haystack_dates.length !== instance.haystack_sessions.length) {
			adapterWarnings.push(
				`haystack_dates(${instance.haystack_dates.length}) != haystack_sessions(${instance.haystack_sessions.length})`
			);
		}

		const documents: BenchmarkDocument[] = instance.haystack_sessions.map((session, index) => {
			const sessionId = instance.haystack_session_ids[index] ?? `${instance.question_id}_session_${index + 1}`;
			const sessionDate = instance.haystack_dates[index];
			return {
				id: sessionId,
				content: formatSessionContent(sessionId, sessionDate, session),
				created: sessionDate ?? instance.question_date ?? new Date(0).toISOString(),
				type: "benchmark_session",
				tags: ["benchmark", "longmemeval", instance.question_type]
			};
		});

		const abstention = detectAbstention(instance);
		const evidenceIds = instance.answer_session_ids ?? [];
		const documentIds = new Set(documents.map(doc => doc.id));
		const missingEvidenceIds = evidenceIds.filter(id => !documentIds.has(id));
		if (missingEvidenceIds.length > 0) {
			adapterWarnings.push(`missing_evidence_in_haystack: ${missingEvidenceIds.join(",")}`);
		}

		let skipRetrievalReason: BenchmarkCase["skip_retrieval_reason"] | undefined;
		if (abstention.detected) skipRetrievalReason = "abstention";
		else if (evidenceIds.length === 0) skipRetrievalReason = "missing_evidence";

		return {
			id: instance.question_id,
			dataset: "longmemeval",
			query: instance.question,
			answer: instance.answer,
			question_type: instance.question_type,
			question_date: instance.question_date,
			evidence_ids: evidenceIds,
			documents,
			skip_retrieval_reason: skipRetrievalReason,
			metadata: {
				question_type: instance.question_type,
				abstention_detected: abstention.detected,
				abstention_source: abstention.source,
				...(adapterWarnings.length > 0 ? { adapter_warnings: adapterWarnings } : {})
			}
		};
	});
}
