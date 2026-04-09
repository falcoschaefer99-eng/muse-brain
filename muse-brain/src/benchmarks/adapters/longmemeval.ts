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

export function adaptLongMemEval(raw: LongMemEvalInstance[]): BenchmarkCase[] {
	return raw.map(instance => {
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

		const isAbstention = instance.question_id.endsWith("_abs");
		return {
			id: instance.question_id,
			dataset: "longmemeval",
			query: instance.question,
			answer: instance.answer,
			question_type: instance.question_type,
			question_date: instance.question_date,
			evidence_ids: instance.answer_session_ids ?? [],
			documents,
			skip_retrieval_reason: isAbstention ? "abstention" : undefined,
			metadata: {
				question_type: instance.question_type
			}
		};
	});
}
