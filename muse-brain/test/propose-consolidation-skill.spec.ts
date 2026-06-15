import { describe, expect, it, vi } from "vitest";
import { handleTool as handleProposeTool } from "../src/tools-v2/propose";
import type { CapturedSkillArtifact, ConsolidationCandidate, DaemonProposal, Observation } from "../src/types";

function makeProposal(overrides: Partial<DaemonProposal> = {}): DaemonProposal {
	return {
		id: overrides.id ?? "proposal_consolidation_1",
		tenant_id: overrides.tenant_id ?? "rainer",
		proposal_type: overrides.proposal_type ?? "consolidation",
		source_id: overrides.source_id ?? "ent_kairo",
		target_id: overrides.target_id ?? "ent_kairo",
		confidence: overrides.confidence ?? 0.82,
		rationale: overrides.rationale ?? "Kairo has repeated boundary-test findings worth consolidating.",
		metadata: overrides.metadata ?? {
			agent_id: "ent_kairo",
			agent_name: "Kairo"
		},
		status: overrides.status ?? "pending",
		proposed_at: overrides.proposed_at ?? "2026-06-15T09:00:00.000Z"
	};
}

function makeCandidate(overrides: Partial<ConsolidationCandidate> = {}): ConsolidationCandidate {
	return {
		id: overrides.id ?? "candidate_kairo_boundary",
		tenant_id: overrides.tenant_id ?? "rainer",
		source_observation_ids: overrides.source_observation_ids ?? ["obs_boundary_a", "obs_boundary_b"],
		pattern_description: overrides.pattern_description ?? "Kairo repeatedly catches missing mode-matrix boundary tests.",
		suggested_type: overrides.suggested_type ?? "skill",
		status: overrides.status ?? "pending",
		created_at: overrides.created_at ?? "2026-06-15T09:00:00.000Z"
	};
}

function makeObservation(id: string): Observation {
	return {
		id,
		content: `learning ${id}`,
		territory: "craft",
		created: "2026-06-15T09:00:00.000Z",
		texture: {
			salience: "background",
			vividness: "soft",
			charge: ["learning"],
			grip: "present",
			charge_phase: "active"
		},
		access_count: 0
	};
}

describe("proposal consolidation review → captured skill artifact", () => {
	it("creates a candidate captured skill artifact with provenance when consolidation is accepted", async () => {
		const proposal = makeProposal();
		const reviewed = { ...proposal, status: "accepted" as const, reviewed_at: "2026-06-15T09:05:00.000Z" };
		const candidate = makeCandidate();
		const capturedSkill: CapturedSkillArtifact = {
			id: "skill_kairo_boundary",
			tenant_id: "rainer",
			skill_key: "derived:rainer:kairo-candidate-kairo-boundary",
			version: 1,
			layer: "derived",
			status: "candidate",
			name: "Consolidated learning: Kairo",
			domain: "agent-learning",
			task_type: "consolidation",
			agent_tenant: "rainer",
			source_observation_id: "obs_skill",
			provenance: {},
			metadata: {},
			created_at: "2026-06-15T09:05:00.000Z",
			updated_at: "2026-06-15T09:05:00.000Z"
		};

		const storage = {
			getTenant: () => "rainer",
			getProposalById: vi.fn(async () => proposal),
			reviewProposal: vi.fn(async () => reviewed),
			listConsolidationCandidates: vi.fn(async () => [candidate]),
			reviewConsolidationCandidate: vi.fn(async () => candidate),
			findObservation: vi.fn(async (id: string) => ({ territory: "craft", observation: makeObservation(id) })),
			updateObservationTexture: vi.fn(async () => undefined),
			appendToTerritory: vi.fn(async () => undefined),
			updateEntity: vi.fn(async () => undefined),
			createCapturedSkillArtifact: vi.fn(async (payload: any) => ({
				...capturedSkill,
				id: "skill_kairo_boundary",
				skill_key: payload.skill_key,
				source_observation_id: payload.source_observation_id,
				provenance: payload.provenance,
				metadata: payload.metadata
			}))
		};

		const result = await handleProposeTool("mind_propose", {
			action: "review",
			proposal_id: proposal.id,
			decision: "accepted"
		}, { storage: storage as any });

		expect(storage.reviewConsolidationCandidate).toHaveBeenCalledWith(candidate.id, "accepted");
		expect(storage.updateObservationTexture).toHaveBeenCalledTimes(2);
		expect(storage.appendToTerritory).toHaveBeenCalledWith("craft", expect.objectContaining({
			type: "skill",
			entity_id: "ent_kairo"
		}));
		expect(storage.createCapturedSkillArtifact).toHaveBeenCalledWith(expect.objectContaining({
			layer: "derived",
			status: "candidate",
			name: "Consolidated learning: Kairo",
			domain: "agent-learning",
			task_type: "consolidation",
			agent_tenant: "rainer",
			provenance: expect.objectContaining({
				proposal_id: proposal.id,
				consolidation_candidate_id: candidate.id,
				source_observation_ids: candidate.source_observation_ids,
				metabolized_observation_ids: candidate.source_observation_ids
			}),
			metadata: expect.objectContaining({
				agent_entity_id: "ent_kairo",
				agent_name: "Kairo",
				review_gate: "candidate_requires_mind_skill_review"
			})
		}));
		expect(result.action_taken).toBe("created_skill_observation_and_candidate_artifact");
		expect(result.captured_skill_id).toBe("skill_kairo_boundary");
		expect(result.captured_skill_status).toBe("candidate");
	});
});
