import { describe, expect, it } from "vitest";

import { runKitHygieneTask } from "../src/daemon/tasks/kit-hygiene";
import { createStorage } from "../src/storage/factory";

describe("kit hygiene project routing synthesis", () => {
	it("proposes routing updates from repeated project receipts and flags missing artifact paths", async () => {
		const dbPath = `/tmp/muse-brain-kit-routing-${crypto.randomUUID()}.sqlite`;
		const storage = createStorage({ backend: "sqlite", sqlitePath: dbPath }, "rainer");
		const now = "2026-06-13T09:00:00.000Z";

		const project = await storage.createEntity({
			tenant_id: "rainer",
			name: "MUSE Brain",
			entity_type: "project",
			tags: ["muse-brain"],
			salience: "active",
			primary_context: "Persistent memory substrate"
		});
		await storage.createProjectDossier({
			project_entity_id: project.id,
			lifecycle_status: "active",
			summary: "Brain work",
			goals: [],
			constraints: [],
			decisions: [],
			open_questions: [],
			next_actions: [],
			metadata: {}
		});

		for (const suffix of ["a", "b"]) {
			await storage.appendToTerritory("craft", {
				id: `obs_repo_${suffix}`,
				content: [
					"repo_receipt",
					`project_entity_id: ${project.id}`,
					"project_name: MUSE Brain",
					"status: success",
					"repo_slug: muse-brain",
					"local_path: /Users/falco/AI/rainer-workspace/muse-brain-public",
					"deploy_command: npm run deploy"
				].join("\n"),
				territory: "craft",
				created: now,
				texture: {
					salience: "background",
					vividness: "soft",
					charge: ["receipt", "repo", "success", "project-routing"],
					grip: "loose",
					charge_phase: "fresh"
				},
				access_count: 0,
				type: "repo_receipt",
				tags: ["repo-receipt", "muse-brain"],
				entity_id: project.id
			});
		}

		await storage.createTask({
			title: "Build release artifact",
			status: "done",
			priority: "normal",
			source: "test",
			linked_observation_ids: [],
			linked_entity_ids: [project.id],
			completion_note: "Built the package but forgot the path.",
			completed_at: now
		});

		const result = await runKitHygieneTask(storage);
		expect(result.proposals_created).toBeGreaterThanOrEqual(2);

		const routingUpdates = await storage.listProposals("project_routing_update", "pending", 20);
		expect(routingUpdates.some(proposal =>
			proposal.metadata.project_entity_id === project.id
			&& proposal.metadata.field === "workspace_routing.local_paths"
			&& proposal.metadata.proposed_value === "/Users/falco/AI/rainer-workspace/muse-brain-public"
		)).toBe(true);

		const missingArtifacts = await storage.listProposals("missing_artifact_receipt", "pending", 20);
		expect(missingArtifacts.some(proposal =>
			proposal.metadata.project_entity_id === project.id
			&& proposal.metadata.task_title === "Build release artifact"
		)).toBe(true);
	});
});
