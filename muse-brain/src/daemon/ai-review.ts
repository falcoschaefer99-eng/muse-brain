// ============ WORKERS AI PROPOSAL REVIEWER ============
// Auto-absorption (tasks/absorption.ts) digests the obvious proposals immediately
// (link >= 0.92, orphan_rescue-rescue >= 0.90, orphan_rescue-archive at any
// confidence). Everything below that pile up unreviewed. This step uses Workers AI
// (a cheap 3B model, same as recap.ts) to make an actual judgment call on what's left:
//   - link proposals, any confidence
//   - orphan_rescue (rescue action only), confidence < 0.90
//   - dedup proposals, any confidence
// All three compare two REAL observations by id, which is what makes an LLM
// comparison possible.
//
// consolidation is intentionally EXCLUDED here: its source_id/target_id are the
// same agent ENTITY id repeated twice (see tasks/kit-hygiene.ts), not observation
// ids — findObservation() can never resolve either side, and the real accept-side
// effect (candidate matching + skill-observation synthesis, see tools-v2/propose.ts)
// is far more involved than a link/rescue/dedup accept. Left pending for human
// review via mind_propose, same as skill_promotion, cross_agent, cross_tenant,
// paradox_detected, recall_contract, fact_commitment.
//
// NOT a daemon task inside runDaemonTasks() — it needs env.AI, which the
// orchestrator doesn't have. Called directly from scheduled() instead, after
// daemon tasks (including absorption) and after subconscious processing, so it
// only ever sees what absorption didn't already handle.

import type { IBrainStorage } from "../storage/interface";
import type { DaemonProposal, Observation } from "../types";
import { createBidirectionalLink } from "./helpers";

const TEXT_GEN_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const BATCH_SIZE = 20;
const FETCH_PER_TYPE = 20; // pool per type before the combined batch is capped
const ORPHAN_RESCUE_ABSORBED_THRESHOLD = 0.90; // absorption.ts already took >= this
const MIN_SIMILARITY_FOR_AI_ACCEPT = 0.60; // model can't override a floor this low — excessive-agency guard
const MAX_CONTENT_CHARS = 500; // keep the prompt small — the 3B model works better concise
const MAX_REASON_CHARS = 300;

type AiTextGenRun = (
	model: string,
	input: { messages: Array<{ role: string; content: string }>; max_tokens?: number }
) => Promise<{ response: string }>;

interface ReviewDecision {
	decision: "accept" | "reject";
	reason: string;
}

/**
 * Reviews up to BATCH_SIZE pending link/orphan_rescue/dedup proposals via Workers AI.
 * Returns the number of proposals actually reviewed (accepted + rejected — not skipped).
 */
export async function runAiProposalReview(storage: IBrainStorage, ai: Ai | undefined): Promise<number> {
	if (!ai) return 0;

	let accepted = 0;
	let rejected = 0;
	let skipped = 0;

	const candidates = await gatherCandidates(storage);

	for (const proposal of candidates.slice(0, BATCH_SIZE)) {
		try {
			const outcome = await reviewOne(storage, ai, proposal);
			if (outcome === "accepted") accepted++;
			else if (outcome === "rejected") rejected++;
			else skipped++;
		} catch (err) {
			console.error(`ai-review: proposal ${proposal.id} (${proposal.proposal_type}) failed:`, err instanceof Error ? err.message : err);
			skipped++;
		}
	}

	const reviewed = accepted + rejected;
	await storeSummary(storage, { reviewed, accepted, rejected, skipped });

	return reviewed;
}

async function gatherCandidates(storage: IBrainStorage): Promise<DaemonProposal[]> {
	const [links, orphanRescues, dedups] = await Promise.all([
		storage.listProposals("link", "pending", FETCH_PER_TYPE),
		storage.listProposals("orphan_rescue", "pending", FETCH_PER_TYPE),
		storage.listProposals("dedup", "pending", FETCH_PER_TYPE)
	]);

	// absorption.ts already took orphan_rescue "archive" (any confidence) and
	// "rescue" >= 0.90 — only lower-confidence rescue attempts remain reviewable here.
	const eligibleOrphanRescues = orphanRescues.filter(p => {
		const meta = (p.metadata ?? {}) as Record<string, unknown>;
		return meta.action !== "archive" && p.confidence < ORPHAN_RESCUE_ABSORBED_THRESHOLD;
	});

	// Cap each type before concatenating so a flood of one type (e.g. links) can't
	// starve the others out of the BATCH_SIZE slice taken by the caller.
	const perType = Math.ceil(BATCH_SIZE / 3); // 7 each
	return [...links.slice(0, perType), ...eligibleOrphanRescues.slice(0, perType), ...dedups.slice(0, perType)].slice(0, BATCH_SIZE);
}

async function reviewOne(storage: IBrainStorage, ai: Ai, proposal: DaemonProposal): Promise<"accepted" | "rejected" | "skipped"> {
	const [sourceFound, targetFound] = await Promise.all([
		storage.findObservation(proposal.source_id),
		storage.findObservation(proposal.target_id)
	]);

	if (!sourceFound || !targetFound) {
		// Deleted since the proposal was created — nothing left to compare, auto-reject.
		await storage.reviewProposal(proposal.id, "rejected", "AI-reviewed: source or target observation no longer exists");
		return "rejected";
	}

	const prompt = buildPrompt(proposal, sourceFound.observation, targetFound.observation);

	let decision: ReviewDecision | null;
	try {
		decision = await runModelReview(ai, prompt);
	} catch (err) {
		console.warn(`ai-review: model call failed for proposal ${proposal.id}:`, err instanceof Error ? err.message : err);
		return "skipped";
	}

	if (!decision) {
		console.warn(`ai-review: could not parse model response for proposal ${proposal.id}`);
		return "skipped";
	}

	const feedbackNote = `AI-reviewed: ${decision.reason}`.slice(0, 1000);

	if (decision.decision === "accept") {
		const score = proposal.similarity ?? proposal.confidence;
		if (score < MIN_SIMILARITY_FOR_AI_ACCEPT) {
			await storage.reviewProposal(
				proposal.id,
				"rejected",
				`AI-reviewed: model approved but similarity ${Math.round(score * 100)}% below ${MIN_SIMILARITY_FOR_AI_ACCEPT * 100}% floor`
			);
			return "rejected";
		}

		if (proposal.proposal_type === "link") {
			await createBidirectionalLink(storage, proposal);
		} else if (proposal.proposal_type === "orphan_rescue") {
			await createBidirectionalLink(storage, proposal);
			await storage.updateOrphanStatus(proposal.source_id, "rescued");
		}
		// dedup: no extra side effect on accept — mirrors mind_propose's existing
		// behavior (dedup isn't special-cased there either; accept just marks it accepted).
		await storage.reviewProposal(proposal.id, "accepted", feedbackNote);
		return "accepted";
	}

	await storage.reviewProposal(proposal.id, "rejected", feedbackNote);
	return "rejected";
}

function truncate(content: string): string {
	return content.length > MAX_CONTENT_CHARS ? `${content.slice(0, MAX_CONTENT_CHARS)}…` : content;
}

function buildPrompt(proposal: DaemonProposal, source: Observation, target: Observation): string {
	const scorePct = Math.round((proposal.similarity ?? proposal.confidence) * 100);
	const rationale = proposal.rationale ?? "none given";

	if (proposal.proposal_type === "orphan_rescue") {
		return `You are a memory curator reviewing whether an orphaned memory belongs with a candidate rescue target.

Orphaned memory (territory: ${source.territory}):
${truncate(source.content)}

Candidate rescue target (territory: ${target.territory}):
${truncate(target.content)}

Proposal type: orphan_rescue
Similarity score: ${scorePct}%
Daemon rationale: ${rationale}

Does the orphaned memory genuinely belong with the rescue target? Consider:
- Do they share a meaningful relationship (thematic, causal, temporal, referential)?
- Would linking the orphan to this target help it surface again in the right context?
- Is this a genuine connection or just surface-level word overlap?

Respond with JSON only:
{"decision": "accept" | "reject", "reason": "one sentence"}`;
	}

	return `You are a memory curator reviewing whether two memories should be linked.

Memory A (territory: ${source.territory}):
${truncate(source.content)}

Memory B (territory: ${target.territory}):
${truncate(target.content)}

Proposal type: ${proposal.proposal_type}
Similarity score: ${scorePct}%
Daemon rationale: ${rationale}

Should these memories be connected? Consider:
- Do they share a meaningful relationship (thematic, causal, temporal, referential)?
- Would connecting them help retrieval — would finding one make the other relevant?
- Is this a genuine connection or just surface-level word overlap?

Respond with JSON only:
{"decision": "accept" | "reject", "reason": "one sentence"}`;
}

async function runModelReview(ai: Ai, prompt: string): Promise<ReviewDecision | null> {
	let result: { response: string };
	try {
		result = await (ai.run as unknown as AiTextGenRun)(TEXT_GEN_MODEL, {
			messages: [
				{ role: "system", content: "You are a precise, concise memory curator. Respond with JSON only, no commentary." },
				{ role: "user", content: prompt }
			],
			max_tokens: 200
		});
	} catch (err) {
		throw new Error(`Workers AI text generation failed: ${err instanceof Error ? err.message : "unknown error"}`);
	}

	const responseText = typeof result.response === "string"
		? result.response
		: (result.response != null ? JSON.stringify(result.response) : "");

	if (!responseText) return null;

	// The model sometimes wraps JSON in markdown code fences — strip them (same pattern as recap.ts).
	const raw = responseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

	try {
		const parsed = JSON.parse(raw);
		if (parsed && (parsed.decision === "accept" || parsed.decision === "reject")) {
			return {
				decision: parsed.decision,
				reason: typeof parsed.reason === "string" && parsed.reason.trim()
					? parsed.reason.trim().slice(0, MAX_REASON_CHARS)
					: "no reason given"
			};
		}
	} catch {
		// Not JSON — treat as unparseable, caller leaves the proposal pending.
	}

	return null;
}

async function storeSummary(
	storage: IBrainStorage,
	counts: { reviewed: number; accepted: number; rejected: number; skipped: number }
): Promise<void> {
	const summary = {
		timestamp: new Date().toISOString(),
		reviewed: counts.reviewed,
		accepted: counts.accepted,
		rejected: counts.rejected,
		skipped: counts.skipped
	};

	try {
		const config = await storage.readDaemonConfig();
		const data = { ...(config.data as Record<string, unknown>), last_ai_review: summary };
		await storage.updateDaemonConfigData(data);
	} catch (err) {
		console.error("ai-review: failed to store summary:", err instanceof Error ? err.message : err);
	}
}
