import type { Config } from "./config.js";
import { BrainClient } from "./brain.js";

type ProposalDecision = "accepted" | "rejected";

interface PendingProposal {
  id: string;
  type?: string;
  confidence?: number;
  rationale?: string;
}

export interface SelfImprovementResult {
  enabled: boolean;
  pending: number;
  reviewed: number;
  accepted: number;
  rejected: number;
  reviewedIds: string[];
  toolCalls: string[];
  error?: string;
}

function parseJsonFromText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to extract the widest JSON object/array from wrapped text.
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const maybe = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(maybe);
      } catch {
        return null;
      }
    }
    const firstBracket = trimmed.indexOf("[");
    const lastBracket = trimmed.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      const maybe = trimmed.slice(firstBracket, lastBracket + 1);
      try {
        return JSON.parse(maybe);
      } catch {
        return null;
      }
    }
  }

  return null;
}

function extractPendingProposals(raw: unknown): PendingProposal[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const obj = raw as Record<string, unknown>;
  const proposals = obj["proposals"];
  if (!Array.isArray(proposals)) return [];

  return proposals
    .map((item): PendingProposal | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      if (typeof row["id"] !== "string") return null;
      const confidence =
        typeof row["confidence"] === "number" && Number.isFinite(row["confidence"])
          ? row["confidence"]
          : undefined;
      return {
        id: row["id"],
        type: typeof row["type"] === "string" ? row["type"] : undefined,
        confidence,
        rationale: typeof row["rationale"] === "string" ? row["rationale"] : undefined,
      };
    })
    .filter((item): item is PendingProposal => item !== null);
}

function decideProposal(proposal: PendingProposal, threshold: number): { decision: ProposalDecision; note: string } {
  if (proposal.confidence === undefined) {
    return {
      decision: "rejected",
      note: "Auto-review: missing confidence score, rejected conservatively.",
    };
  }

  if (proposal.confidence >= threshold) {
    return {
      decision: "accepted",
      note: `Auto-review: accepted (confidence ${proposal.confidence.toFixed(2)} >= threshold ${threshold.toFixed(2)}).`,
    };
  }

  return {
    decision: "rejected",
    note: `Auto-review: rejected (confidence ${proposal.confidence.toFixed(2)} < threshold ${threshold.toFixed(2)}).`,
  };
}

function buildTelemetryContent(input: {
  runId: string;
  harnessName: string;
  summary: string;
  pending: number;
  reviewed: number;
  accepted: number;
  rejected: number;
  reviewedIds: string[];
  threshold: number;
}): string {
  return [
    `Self-improvement loop (${input.harnessName})`,
    `run_id: ${input.runId}`,
    `summary: ${input.summary}`,
    `pending: ${input.pending}`,
    `reviewed: ${input.reviewed}`,
    `accepted: ${input.accepted}`,
    `rejected: ${input.rejected}`,
    `threshold: ${input.threshold.toFixed(2)}`,
    `reviewed_ids: ${input.reviewedIds.join(", ") || "none"}`,
  ].join("\n");
}

export async function runSelfImprovement(params: {
  config: Config;
  brain: BrainClient;
  runId: string;
  harnessName: string;
  runSummary: string;
}): Promise<SelfImprovementResult> {
  const { config, brain, runId, harnessName, runSummary } = params;

  if (!config.enableSelfImprovement) {
    return {
      enabled: false,
      pending: 0,
      reviewed: 0,
      accepted: 0,
      rejected: 0,
      reviewedIds: [],
      toolCalls: [],
    };
  }

  try {
    const toolCalls: string[] = [];
    const listText = await brain.callTool("mind_propose", {
      action: "list",
      status: "pending",
      limit: config.proposalReviewLimit,
    });
    toolCalls.push("mind_propose");

    const parsed = parseJsonFromText(listText);
    const proposals = extractPendingProposals(parsed);

    let reviewed = 0;
    let accepted = 0;
    let rejected = 0;
    const reviewedIds: string[] = [];

    for (const proposal of proposals) {
      const { decision, note } = decideProposal(proposal, config.proposalAcceptThreshold);
      const resultText = await brain.callTool("mind_propose", {
        action: "review",
        proposal_id: proposal.id,
        decision,
        feedback_note: note,
      });
      toolCalls.push("mind_propose");

      // If the tool returns an explicit error payload, skip counters for this proposal.
      const resultParsed = parseJsonFromText(resultText);
      if (
        resultParsed &&
        typeof resultParsed === "object" &&
        !Array.isArray(resultParsed) &&
        "error" in (resultParsed as Record<string, unknown>)
      ) {
        continue;
      }

      reviewed += 1;
      reviewedIds.push(proposal.id);
      if (decision === "accepted") accepted += 1;
      if (decision === "rejected") rejected += 1;
    }

    const telemetryContent = buildTelemetryContent({
      runId,
      harnessName,
      summary: runSummary,
      pending: proposals.length,
      reviewed,
      accepted,
      rejected,
      reviewedIds,
      threshold: config.proposalAcceptThreshold,
    });

    await brain.callTool("mind_observe", {
      mode: "observe",
      territory: "craft",
      salience: "active",
      grip: "present",
      vividness: "soft",
      content: telemetryContent,
      context: "autonomous self-improvement loop",
    });
    toolCalls.push("mind_observe");

    return {
      enabled: true,
      pending: proposals.length,
      reviewed,
      accepted,
      rejected,
      reviewedIds,
      toolCalls,
    };
  } catch (err: unknown) {
    return {
      enabled: true,
      pending: 0,
      reviewed: 0,
      accepted: 0,
      rejected: 0,
      reviewedIds: [],
      toolCalls: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
