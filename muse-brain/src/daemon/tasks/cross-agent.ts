// ============ DAEMON TASK: CROSS-AGENT SYNTHESIS ============
// Detects convergent findings across different agent entities.
// When 2+ agents have observations about the same non-agent entity (entity_id),
// creates a consolidation_candidate (type: 'synthesis') and a daemon_proposal
// (type: 'cross_agent') to surface the convergence.

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";

const LOOKBACK_DAYS = 7;

export async function runCrossAgentTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	let proposals_created = 0;

	// Get all agent entities
	const agentEntities = await storage.listEntities({ entity_type: "agent", limit: 200 });
	if (agentEntities.length < 2) {
		// Need at least 2 agents for cross-agent synthesis
		return { task: "cross-agent", changes: 0, proposals_created: 0 };
	}

	const cutoffDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
	const agentIdSet = new Set(agentEntities.map(e => e.id));
	const agentIdList = agentEntities.map(e => e.id);

	// Batch-fetch all agent observations in a single query (N agents → 1 DB call)
	const allEntityObs = await storage.batchGetEntityObservations(agentIdList, 100);

	// Map: entity_id → [ { agent_id, agent_name, obs_id } ]
	const entityToAgentObs = new Map<string, Array<{ agent_id: string; agent_name: string; obs_id: string }>>();

	for (const agent of agentEntities) {
		const entityObs = allEntityObs.get(agent.id) ?? [];

		for (const { observation: obs } of entityObs) {
			// Skip if the observation is about an agent entity itself
			if (!obs.entity_id || agentIdSet.has(obs.entity_id)) continue;

			// Only consider recent observations
			if (obs.created < cutoffDate) continue;

			const existing = entityToAgentObs.get(obs.entity_id) ?? [];
			existing.push({ agent_id: agent.id, agent_name: agent.name, obs_id: obs.id });
			entityToAgentObs.set(obs.entity_id, existing);
		}
	}

	// Collect all entity IDs that have 2+ agent convergence, then batch-check proposals
	const convergentEntityIds: string[] = [];
	for (const [targetEntityId, agentObsList] of entityToAgentObs) {
		const uniqueAgents = new Set(agentObsList.map(e => e.agent_id));
		if (uniqueAgents.size >= 2) convergentEntityIds.push(targetEntityId);
	}

	const crossAgentChecks = convergentEntityIds.map(id => ({ type: "cross_agent", sourceId: id, targetId: id }));
	const existingCrossAgent = await storage.batchProposalExists(crossAgentChecks);

	// Find entities that 2+ different agents have observations about
	for (const [targetEntityId, agentObsList] of entityToAgentObs) {
		// Deduplicate by agent — keep only one obs per agent (most recent = first from getEntityObservations)
		const agentsSeen = new Map<string, { agent_name: string; obs_id: string }>();
		for (const entry of agentObsList) {
			if (!agentsSeen.has(entry.agent_id)) {
				agentsSeen.set(entry.agent_id, { agent_name: entry.agent_name, obs_id: entry.obs_id });
			}
		}

		if (agentsSeen.size < 2) continue;

		const agents = Array.from(agentsSeen.entries());
		const agentNames = agents.map(([, v]) => v.agent_name).join(", ");
		const sourceObsIds = agents.map(([, v]) => v.obs_id);

		// Check if a cross_agent proposal already exists for this entity (batch result)
		if (existingCrossAgent.has(`cross_agent:${targetEntityId}:${targetEntityId}`)) continue;

		// Create consolidation candidate
		await storage.createConsolidationCandidate({
			source_observation_ids: sourceObsIds,
			pattern_description: `${agentNames} independently have findings about entity ${targetEntityId}`,
			suggested_territory: undefined,
			suggested_type: "synthesis",
			status: "pending"
		});

		// Create daemon proposal
		await storage.createProposal({
			tenant_id: storage.getTenant(),
			proposal_type: "cross_agent",
			source_id: targetEntityId,
			target_id: targetEntityId,
			confidence: 0.8,
			rationale: `Agents ${agentNames} have convergent observations about the same entity — synthesis opportunity`,
			metadata: {
				target_entity_id: targetEntityId,
				agents: agents.map(([agent_id, v]) => ({ agent_id, agent_name: v.agent_name, obs_id: v.obs_id })),
				observation_count: sourceObsIds.length
			},
			status: "pending"
		});
		proposals_created++;
	}

	return { task: "cross-agent", changes: 0, proposals_created };
}
