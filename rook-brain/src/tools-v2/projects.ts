// ============ PROJECT DOSSIER TOOL (v2) ============
// mind_project — create, inspect, list, and update project dossiers.
// Canonical identity lives in entities(entity_type='project'); dossier is companion metadata.

import type { Entity, ProjectDossier } from "../types";
import { getTimestamp } from "../helpers";
import type { ToolContext } from "./context";
import { cleanText, normalizeMetadata, normalizeOptionalTimestamp, normalizeStringList } from "./utils";

const LIFECYCLE_STATUSES = ["active", "paused", "archived"] as const;

export const TOOL_DEFS = [
	{
		name: "mind_project",
		description: "Manage project dossiers. action=create creates a project entity plus dossier. action=get fetches a dossier. action=list lists dossiers. action=update updates dossier and project metadata.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["create", "get", "list", "update"],
					description: "create: new project entity + dossier. get: fetch single project dossier. list: list project dossiers. update: modify project dossier or project metadata."
				},
				name: { type: "string", description: "[create/get/update] Project name" },
				entity_id: { type: "string", description: "[get/update] Project entity id" },
				primary_context: { type: "string", description: "[create/update] One-line project description on the entity" },
				tags: { type: "array", items: { type: "string" }, description: "[create/update] Project entity tags" },
				salience: {
					type: "string",
					enum: ["foundational", "active", "background", "archive"],
					description: "[create/update] Project entity salience"
				},
				lifecycle_status: {
					type: "string",
					enum: [...LIFECYCLE_STATUSES],
					description: "[create/update/list] Project lifecycle status"
				},
				summary: { type: "string", description: "[create/update] Project dossier summary" },
				goals: { type: "array", items: { type: "string" }, description: "[create/update] Current goals" },
				constraints: { type: "array", items: { type: "string" }, description: "[create/update] Current constraints" },
				decisions: { type: "array", items: { type: "string" }, description: "[create/update] Decisions already made" },
				open_questions: { type: "array", items: { type: "string" }, description: "[create/update] Open questions" },
				next_actions: { type: "array", items: { type: "string" }, description: "[create/update] Next actions" },
				metadata: { type: "object", description: "[create/update] Flexible project metadata" },
				updated_after: { type: "string", description: "[list] ISO timestamp filter for recent project activity" },
				limit: { type: "number", description: "[list] Max results (default 20)" }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_project": {
			const storage = context.storage;
			const action = args.action;

			switch (action) {
				case "create": {
					if (!args.name?.trim()) return { error: "name is required for action=create" };
					if (args.lifecycle_status !== undefined && !normalizeLifecycleStatus(args.lifecycle_status)) {
						return { error: `lifecycle_status must be one of: ${LIFECYCLE_STATUSES.join(", ")}` };
					}

					const cleanName = cleanText(args.name);
					if (!cleanName) return { error: "name is required for action=create" };
					const metadataResult = normalizeMetadata(args.metadata);
					if (metadataResult.error) return { error: metadataResult.error };

					const existing = await storage.findEntityByName(cleanName);
					if (existing) return { error: "Project already exists", entity_id: existing.id };

					const entity = await storage.createEntity({
						tenant_id: storage.getTenant(),
						name: cleanName,
						entity_type: "project",
						tags: normalizeStringList(args.tags),
						salience: args.salience || "active",
						primary_context: cleanText(args.primary_context)
					});

					const dossier = await storage.createProjectDossier({
						project_entity_id: entity.id,
						lifecycle_status: normalizeLifecycleStatus(args.lifecycle_status) ?? "active",
						summary: cleanText(args.summary),
						goals: normalizeStringList(args.goals),
						constraints: normalizeStringList(args.constraints),
						decisions: normalizeStringList(args.decisions),
						open_questions: normalizeStringList(args.open_questions),
						next_actions: normalizeStringList(args.next_actions),
						metadata: metadataResult.value,
						last_active_at: getTimestamp()
					});

					return {
						created: true,
						project: {
							entity,
							dossier
						}
					};
				}

				case "get": {
					const entity = await resolveProjectEntity(storage, args);
					if ("error" in entity) return entity;

					const dossier = await storage.getProjectDossier(entity.id);
					if (!dossier) return { error: `Project dossier not found for ${entity.name}` };

					return { project: { entity, dossier } };
				}

				case "list": {
					if (args.lifecycle_status !== undefined && !normalizeLifecycleStatus(args.lifecycle_status)) {
						return { error: `lifecycle_status must be one of: ${LIFECYCLE_STATUSES.join(", ")}` };
					}
					const updatedAfter = normalizeOptionalTimestamp(args.updated_after);
					if (args.updated_after !== undefined && !updatedAfter) {
						return { error: "updated_after must be a valid timestamp" };
					}

					const dossiers = await storage.listProjectDossiers({
						lifecycle_status: normalizeLifecycleStatus(args.lifecycle_status),
						updated_after: updatedAfter,
						limit: args.limit ?? 20
					});

					const projects = await Promise.all(dossiers.map(async (dossier) => {
						const entity = await storage.findEntityById(dossier.project_entity_id);
						return entity ? { entity, dossier } : null;
					}));

					const presentProjects = projects.filter((project): project is { entity: Entity; dossier: ProjectDossier } => project != null);
					return { projects: presentProjects, count: presentProjects.length };
				}

				case "update": {
					const entity = await resolveProjectEntity(storage, args);
					if ("error" in entity) return entity;
					if (args.lifecycle_status !== undefined && !normalizeLifecycleStatus(args.lifecycle_status)) {
						return { error: `lifecycle_status must be one of: ${LIFECYCLE_STATUSES.join(", ")}` };
					}

					const entityUpdates: Partial<Pick<Entity, "tags" | "salience" | "primary_context">> = {};
					if (args.tags !== undefined) entityUpdates.tags = normalizeStringList(args.tags);
					if (args.salience !== undefined) entityUpdates.salience = args.salience;
					if (args.primary_context !== undefined) entityUpdates.primary_context = cleanText(args.primary_context);

					const dossierUpdates: Partial<Pick<ProjectDossier, "lifecycle_status" | "summary" | "goals" | "constraints" | "decisions" | "open_questions" | "next_actions" | "metadata" | "last_active_at">> = {};
					if (args.lifecycle_status !== undefined) dossierUpdates.lifecycle_status = normalizeLifecycleStatus(args.lifecycle_status);
					if (args.summary !== undefined) dossierUpdates.summary = cleanText(args.summary);
					if (args.goals !== undefined) dossierUpdates.goals = normalizeStringList(args.goals);
					if (args.constraints !== undefined) dossierUpdates.constraints = normalizeStringList(args.constraints);
					if (args.decisions !== undefined) dossierUpdates.decisions = normalizeStringList(args.decisions);
					if (args.open_questions !== undefined) dossierUpdates.open_questions = normalizeStringList(args.open_questions);
					if (args.next_actions !== undefined) dossierUpdates.next_actions = normalizeStringList(args.next_actions);
					if (args.metadata !== undefined) {
						const metadataResult = normalizeMetadata(args.metadata);
						if (metadataResult.error) return { error: metadataResult.error };
						dossierUpdates.metadata = metadataResult.value;
					}

					if (Object.keys(entityUpdates).length === 0 && Object.keys(dossierUpdates).length === 0) {
						return { error: "No fields to update" };
					}
					dossierUpdates.last_active_at = getTimestamp();

					const [updatedEntity, updatedDossier] = await Promise.all([
						Object.keys(entityUpdates).length ? storage.updateEntity(entity.id, entityUpdates) : Promise.resolve(entity),
						storage.updateProjectDossier(entity.id, dossierUpdates)
					]);

					return {
						updated: true,
						project: {
							entity: updatedEntity,
							dossier: updatedDossier
						}
					};
				}

				default:
					return { error: `Unknown action: ${action}. Must be create, get, list, or update.` };
			}
		}

		default:
			throw new Error(`Unknown project tool: ${name}`);
	}
}

async function resolveProjectEntity(storage: ToolContext["storage"], args: any): Promise<Entity | { error: string }> {
	let entity: Entity | null = null;

	if (args.entity_id) {
		entity = await storage.findEntityById(args.entity_id);
	} else if (args.name?.trim()) {
		entity = await storage.findEntityByName(args.name.trim());
	} else {
		return { error: "Provide entity_id or name" };
	}

	if (!entity) return { error: "Project not found" };
	if (entity.entity_type !== "project") return { error: `Entity ${entity.name} is not a project` };
	return entity;
}

function normalizeLifecycleStatus(value: unknown): ProjectDossier["lifecycle_status"] | undefined {
	if (typeof value !== "string") return undefined;
	return LIFECYCLE_STATUSES.includes(value as ProjectDossier["lifecycle_status"])
		? value as ProjectDossier["lifecycle_status"]
		: undefined;
}
