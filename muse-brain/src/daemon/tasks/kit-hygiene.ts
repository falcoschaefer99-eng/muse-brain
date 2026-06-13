// ============ DAEMON TASK: KIT HYGIENE ============
// Kit's cleanup cycle runs per agent entity.
// For each agent: counts observations by charge_phase, proposes consolidation
// when metabolized or total counts are high, and proposes dedup for near-duplicate
// observations (vector similarity > 0.92).

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";
import type { DaemonProposalType, Entity, Observation, ProjectWorkspaceRouting, Task } from "../../types";
import { extractProjectWorkspaceRoutingFromMetadata } from "../../tools-v2/project-routing";

const METABOLIZED_THRESHOLD = 20;
const TOTAL_THRESHOLD = 50;
const DEDUP_SIMILARITY = 0.92;
const CONSOLIDATION_LOOKBACK_DAYS = 30;
const PROJECT_RECEIPT_LIMIT = 120;
const MIN_STABLE_RECEIPTS = 2;

type ReceiptKind = "repo_receipt" | "deploy_receipt" | "artifact_receipt";

interface ParsedReceipt {
	id: string;
	type?: string;
	created: string;
	status?: string;
	values: Record<string, string[]>;
}

function firstValue(receipt: ParsedReceipt, key: string): string | undefined {
	return receipt.values[key]?.[0];
}

function parseReceipt(observation: Observation): ParsedReceipt | null {
	const type = observation.type as ReceiptKind | undefined;
	if (type !== "repo_receipt" && type !== "deploy_receipt" && type !== "artifact_receipt") return null;
	const values: Record<string, string[]> = {};
	for (const rawLine of observation.content.split(/\r?\n/)) {
		const line = rawLine.trim();
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (!key || !value) continue;
		(values[key] ??= []).push(value);
	}
	return {
		id: observation.id,
		type,
		created: observation.created,
		status: firstString(values.status),
		values
	};
}

function firstString(values: string[] | undefined): string | undefined {
	return values?.find(value => value.trim().length > 0);
}

function countValues(receipts: ParsedReceipt[], key: string, options?: { successOnly?: boolean }): Map<string, string[]> {
	const counts = new Map<string, string[]>();
	for (const receipt of receipts) {
		if (options?.successOnly && receipt.status && receipt.status !== "success") continue;
		for (const value of receipt.values[key] ?? []) {
			const clean = value.trim();
			if (!clean) continue;
			const ids = counts.get(clean) ?? [];
			ids.push(receipt.id);
			counts.set(clean, ids);
		}
	}
	return counts;
}

function strongest(counts: Map<string, string[]>): { value: string; ids: string[] } | undefined {
	return Array.from(counts.entries())
		.map(([value, ids]) => ({ value, ids }))
		.sort((a, b) => b.ids.length - a.ids.length || a.value.localeCompare(b.value))[0];
}

function routingValues(routing: ProjectWorkspaceRouting | undefined, key: "local_paths" | "artifact_roots" | "deploy_commands"): string[] {
	if (!routing) return [];
	if (key === "deploy_commands") return routing.deploy?.commands ?? [];
	return routing[key] ?? [];
}

function hasValue(values: string[], value: string | undefined): boolean {
	if (!value) return false;
	return values.some(item => item === value);
}

async function createProjectProposalIfMissing(
	storage: IBrainStorage,
	type: DaemonProposalType,
	project: Entity,
	targetId: string,
	confidence: number,
	rationale: string,
	metadata: Record<string, unknown>
): Promise<boolean> {
	const sourceId = project.id;
	const exists = await storage.proposalExists(type, sourceId, targetId);
	if (exists) return false;
	await storage.createProposal({
		tenant_id: storage.getTenant(),
		proposal_type: type,
		source_id: sourceId,
		target_id: targetId,
		confidence,
		rationale,
		metadata: {
			project_entity_id: project.id,
			project_name: project.name,
			...metadata
		},
		status: "pending"
	});
	return true;
}

function taskLooksFileProducing(task: Task): boolean {
	const text = `${task.title}\n${task.description ?? ""}\n${task.source ?? ""}`.toLowerCase();
	return /\b(build|deploy|codegen|generate|export|write|patch|artifact|file|doc|deck|site|worker|package)\b/.test(text);
}

function taskHasArtifactPath(task: Task): boolean {
	return /artifact path:/i.test(task.completion_note ?? "");
}

async function runProjectRoutingHygiene(storage: IBrainStorage): Promise<number> {
	let proposalsCreated = 0;
	const projects = await storage.listEntities({ entity_type: "project", limit: 200 });
	if (projects.length === 0) return 0;

	for (const project of projects) {
		const dossier = await storage.getProjectDossier(project.id);
		if (!dossier) continue;
		const routing = extractProjectWorkspaceRoutingFromMetadata(dossier.metadata);
		const entityObs = await storage.getEntityObservations(project.id, PROJECT_RECEIPT_LIMIT);
		const receipts = entityObs
			.map(row => parseReceipt(row.observation))
			.filter((receipt): receipt is ParsedReceipt => Boolean(receipt));
		if (receipts.length === 0) continue;

		const localPath = strongest(countValues(receipts, "local_path", { successOnly: true }));
		if (localPath && localPath.ids.length >= MIN_STABLE_RECEIPTS) {
			const existing = routingValues(routing, "local_paths");
			if (existing.length === 0) {
				if (await createProjectProposalIfMissing(
					storage,
					"project_routing_update",
					project,
					`local_path:${localPath.value}`,
					0.82,
					`Project ${project.name} has ${localPath.ids.length} successful receipts pointing to local path ${localPath.value}; propose adding it to workspace_routing.local_paths.`,
					{ field: "workspace_routing.local_paths", proposed_value: localPath.value, supporting_receipts: localPath.ids }
				)) proposalsCreated++;
			} else if (!hasValue(existing, localPath.value)) {
				if (await createProjectProposalIfMissing(
					storage,
					"project_routing_drift",
					project,
					`local_path:${localPath.value}`,
					0.86,
					`Project ${project.name} routing drift: dossier local paths (${existing.join(", ")}) disagree with repeated successful receipt path ${localPath.value}.`,
					{ field: "workspace_routing.local_paths", dossier_values: existing, receipt_value: localPath.value, supporting_receipts: localPath.ids }
				)) proposalsCreated++;
			}
		}

		const artifactRoot = strongest(countValues(receipts, "artifact_path", { successOnly: true }));
		if (artifactRoot && artifactRoot.ids.length >= MIN_STABLE_RECEIPTS && routingValues(routing, "artifact_roots").length === 0) {
			const artifactDir = artifactRoot.value.includes("/") ? artifactRoot.value.replace(/\/[^/]*$/, "") : artifactRoot.value;
			if (await createProjectProposalIfMissing(
				storage,
				"project_routing_update",
				project,
				`artifact_root:${artifactDir}`,
				0.72,
				`Project ${project.name} has repeated artifact receipts under ${artifactDir}; propose adding an artifact root.`,
				{ field: "workspace_routing.artifact_roots", proposed_value: artifactDir, supporting_receipts: artifactRoot.ids }
			)) proposalsCreated++;
		}

		const deployCommand = strongest(countValues(receipts, "deploy_command", { successOnly: true }));
		if (deployCommand && deployCommand.ids.length >= MIN_STABLE_RECEIPTS) {
			const existing = routingValues(routing, "deploy_commands");
			const proposalType: DaemonProposalType = existing.length > 0 && !hasValue(existing, deployCommand.value)
				? "stale_deploy_command"
				: "project_routing_update";
			if ((existing.length === 0 || !hasValue(existing, deployCommand.value)) && await createProjectProposalIfMissing(
				storage,
				proposalType,
				project,
				`deploy_command:${deployCommand.value}`,
				proposalType === "stale_deploy_command" ? 0.84 : 0.78,
				proposalType === "stale_deploy_command"
					? `Project ${project.name} dossier deploy command may be stale; repeated successful receipts use ${deployCommand.value}.`
					: `Project ${project.name} has repeated successful deploy receipts using ${deployCommand.value}; propose adding it to routing metadata.`,
				{ field: "workspace_routing.deploy.commands", dossier_values: existing, proposed_value: deployCommand.value, supporting_receipts: deployCommand.ids }
			)) proposalsCreated++;
		}
	}

	const doneTasks = await storage.listTasks("done", undefined, 200, true);
	for (const task of doneTasks) {
		if (!taskLooksFileProducing(task) || taskHasArtifactPath(task)) continue;
		const projectId = (task.linked_entity_ids ?? [])[0];
		if (!projectId) continue;
		const project = projects.find(item => item.id === projectId);
		if (!project) continue;
		if (await createProjectProposalIfMissing(
			storage,
			"missing_artifact_receipt",
			project,
			`task:${task.id}`,
			0.74,
			`File-producing task "${task.title}" is done but has no artifact_path receipt.`,
			{ task_id: task.id, task_title: task.title, completed_at: task.completed_at, completion_note: task.completion_note }
		)) proposalsCreated++;
	}

	return proposalsCreated;
}

export async function runKitHygieneTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	let proposals_created = 0;

	// Get all agent entities for this tenant
	const agentEntities = await storage.listEntities({ entity_type: "agent", limit: 200 });

	if (agentEntities.length === 0) {
		proposals_created += await runProjectRoutingHygiene(storage);
		return { task: "kit-hygiene", changes: 0, proposals_created };
	}

	const cutoffDate = new Date(Date.now() - CONSOLIDATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

	// Hoist listProposals — avoids one DB call per agent hitting the total threshold.
	// Only track source_ids with accepted consolidations within the lookback window.
	const recentConsolidations = await storage.listProposals("consolidation", "accepted", 200);
	const consolidatedSourceIds = new Set(
		recentConsolidations.filter(p => p.proposed_at >= cutoffDate).map(p => p.source_id)
	);

	const agentIds = agentEntities.map(a => a.id);

	// Batch-fetch all agent observations in a single query (N agents → 1 DB call)
	const allEntityObs = await storage.batchGetEntityObservations(agentIds, 200);

	// Batch-check all consolidation proposals upfront (all share the same source=target=agent.id pattern)
	const consolidationChecks = agentIds.map(id => ({ type: "consolidation", sourceId: id, targetId: id }));
	const existingConsolidations = await storage.batchProposalExists(consolidationChecks);

	// Global cap on findSimilarUnlinked calls — 200 agents × 30 obs would blow the 1000 subrequest limit
	let vectorQueriesRemaining = 30;

	for (const agent of agentEntities) {
		const entityObs = allEntityObs.get(agent.id) ?? [];

		if (entityObs.length === 0) continue;

		const observations = entityObs.map(r => r.observation);

		// Count by charge_phase
		let metabolizedCount = 0;
		let totalCount = observations.length;
		for (const obs of observations) {
			if (obs.texture?.charge_phase === "metabolized") metabolizedCount++;
		}

		const consolidationKey = `consolidation:${agent.id}:${agent.id}`;

		// (a) High metabolized count → propose archival consolidation
		if (metabolizedCount > METABOLIZED_THRESHOLD) {
			if (!existingConsolidations.has(consolidationKey)) {
				await storage.createProposal({
					tenant_id: storage.getTenant(),
					proposal_type: "consolidation",
					source_id: agent.id,
					target_id: agent.id,
					confidence: 0.85,
					rationale: `Agent ${agent.name} has ${metabolizedCount} metabolized observations ready for archival`,
					metadata: { agent_id: agent.id, agent_name: agent.name, metabolized_count: metabolizedCount },
					status: "pending"
				});
				proposals_created++;
			}
		}
		// (b) High total count without recent consolidation → propose consolidation
		else if (totalCount > TOTAL_THRESHOLD) {
			// Use pre-fetched consolidation set — avoids a DB call per agent
			const hasRecentConsolidation = consolidatedSourceIds.has(agent.id);

			if (!hasRecentConsolidation) {
				if (!existingConsolidations.has(consolidationKey)) {
					await storage.createProposal({
						tenant_id: storage.getTenant(),
						proposal_type: "consolidation",
						source_id: agent.id,
						target_id: agent.id,
						confidence: 0.75,
						rationale: `Agent ${agent.name} has ${totalCount} total observations, needs consolidation`,
						metadata: { agent_id: agent.id, agent_name: agent.name, total_count: totalCount },
						status: "pending"
					});
					proposals_created++;
				}
			}
		}

		// (c) Dedup check — look for near-duplicate observations among this agent's obs
		// Compare pairs using findSimilarUnlinked on each observation and check similarity > 0.92
		// Only scan non-metabolized observations to keep the N² manageable
		const scannable = observations.filter(o => o.texture?.charge_phase !== "metabolized").slice(0, 30);

		const dupPairsFound = new Set<string>();

		for (const obs of scannable) {
			if (vectorQueriesRemaining <= 0) break;
			const similar = await storage.findSimilarUnlinked(obs.id, 5);
			vectorQueriesRemaining--;

			for (const candidate of similar) {
				if (candidate.similarity < DEDUP_SIMILARITY) continue;

				// Only flag pairs within this agent's observation set
				const candidateIsAgentObs = observations.some(o => o.id === candidate.observation.id);
				if (!candidateIsAgentObs) continue;

				// Canonical pair key (sorted) to avoid double-proposing
				const pairKey = [obs.id, candidate.observation.id].sort().join("|");
				if (dupPairsFound.has(pairKey)) continue;
				dupPairsFound.add(pairKey);

				const exists = await storage.proposalExists("dedup", obs.id, candidate.observation.id);
				if (!exists) {
					await storage.createProposal({
						tenant_id: storage.getTenant(),
						proposal_type: "dedup",
						source_id: obs.id,
						target_id: candidate.observation.id,
						similarity: candidate.similarity,
						confidence: candidate.similarity,
						rationale: `Two observations by agent ${agent.name} are near-duplicates (similarity ${Math.round(candidate.similarity * 100)}%)`,
						metadata: { agent_id: agent.id, agent_name: agent.name },
						status: "pending"
					});
					proposals_created++;
				}
			}
		}
	}

	proposals_created += await runProjectRoutingHygiene(storage);

	return { task: "kit-hygiene", changes: 0, proposals_created };
}
