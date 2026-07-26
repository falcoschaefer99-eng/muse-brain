// ============ RECEIPTS TOOL (v2) ============
// mind_receipt — write operational truth receipts for project routing/retrieval.

import type { Entity, Observation, ProjectDossier, Task, WorkspaceRouting } from "../types";
import { generateId, getTimestamp } from "../helpers";
import type { ToolContext } from "./context";
import { extractProjectWorkspaceRoutingFromMetadata, projectWorkspaceRoutingToRuntimeRouting } from "./project-routing";
import { cleanText } from "./utils";

const DEPLOY_STATUSES = ["success", "failed"] as const;
type DeployStatus = typeof DEPLOY_STATUSES[number];
const REPO_STATUSES = ["success", "failed"] as const;
type RepoStatus = typeof REPO_STATUSES[number];

const MAX_SHORT_FIELD_LENGTH = 500;
const MAX_COMMAND_LENGTH = 2000;
const MAX_REASON_LENGTH = 2000;
const MAX_PATH_LENGTH = 1000;
const MAX_CHANGED_PATHS = 200;

export const TOOL_DEFS = [
	{
		name: "mind_receipt",
		description: "Write structured operational receipts for retrieval truth. action=deploy records project deploy outcomes; action=repo records repo/branch/commit changes as linked observations.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["deploy", "repo"],
					description: "deploy: record a project deploy receipt. repo: record repository activity for cloud-repo to brain ingestion."
				},
				project_entity_id: { type: "string", description: "[deploy/repo] Project entity id to link this receipt to" },
				project_name: { type: "string", description: "[deploy/repo] Project name lookup if project_entity_id is not provided" },
				status: {
					type: "string",
					enum: ["success", "failed"],
					description: "[deploy/repo] Outcome"
				},
				deploy_command: { type: "string", description: "[deploy] Command or workflow that produced the deploy" },
				deploy_target: { type: "string", description: "[deploy] Target environment/platform, e.g. cloudflare-pages, worker, production" },
				repo_slug: { type: "string", description: "[repo] Repository slug, e.g. funkatorium/muse-brain or muse-brain" },
				repo_url: { type: "string", description: "[repo] Canonical repository URL" },
				branch: { type: "string", description: "[deploy/repo] Branch deployed or changed" },
				default_branch: { type: "string", description: "[repo] Repository default branch" },
				commit_sha: { type: "string", description: "[deploy/repo] Commit SHA deployed or observed" },
				local_path: { type: "string", description: "[repo] Local checkout path, if known" },
				changed_paths: {
					type: "array",
					items: { type: "string" },
					description: "[repo] Changed repository-relative file paths"
				},
				actor: { type: "string", description: "[repo] Actor/agent/user responsible for the change" },
				platform: { type: "string", description: "[repo] Source platform, e.g. github, codex, claude-code" },
				source: { type: "string", description: "[repo] Source event or integration name" },
				summary: { type: "string", description: "[repo] Short change summary" },
				preview_url: { type: "string", description: "[deploy] Preview URL produced by the deploy" },
				production_url: { type: "string", description: "[deploy] Production URL touched by the deploy" },
				artifact_path: { type: "string", description: "[deploy] Artifact path deployed, if known" },
				started_at: { type: "string", description: "[deploy] Deploy start timestamp" },
				completed_at: { type: "string", description: "[deploy/repo] Completion/recorded timestamp" },
				failure_reason: { type: "string", description: "[deploy/repo] Failure reason when status=failed" }
			},
			required: ["action", "status"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_receipt": {
			if (args.action === "deploy") {
				const deployInput = validateDeployReceiptInput(args);
				if ("error" in deployInput) return { error: deployInput.error };

				const projectResult = await resolveReceiptProject(context.storage, {
					project_entity_id: deployInput.project_entity_id,
					project_name: deployInput.project_name
				});
				if ("error" in projectResult) return { error: projectResult.error };

				const receipt = buildDeployReceiptObservation({
					projectEntity: projectResult.entity,
					dossier: projectResult.dossier,
					...deployInput
				});

				await context.storage.appendToTerritory("craft", receipt);
				return {
					recorded: true,
					receipt
				};
			}

			if (args.action === "repo") {
				const repoInput = validateRepoReceiptInput(args);
				if ("error" in repoInput) return { error: repoInput.error };

				const projectResult = await resolveReceiptProject(context.storage, {
					project_entity_id: repoInput.project_entity_id,
					project_name: repoInput.project_name
				});
				if ("error" in projectResult) return { error: projectResult.error };

				const receipt = buildRepoReceiptObservation({
					projectEntity: projectResult.entity,
					dossier: projectResult.dossier,
					...repoInput
				});

				await context.storage.appendToTerritory("craft", receipt);
				return {
					recorded: true,
					receipt
				};
			}

			return { error: "Unknown action: must be deploy or repo" };
		}

		default:
			throw new Error(`Unknown receipts tool: ${name}`);
	}
}

export function buildArtifactReceiptObservation(input: {
	existingTask: Task;
	updatedTask: Task;
	projectEntity: Entity;
	dossier: ProjectDossier;
	artifactPath: string;
}): Observation {
	const routing = getRuntimeRouting(input.dossier);
	const completedAt = input.updatedTask.completed_at ?? getTimestamp();
	const completionNote = cleanText(input.updatedTask.completion_note)
		?? cleanText(input.existingTask.completion_note);
	const content = buildArtifactReceiptContent(
		input.existingTask,
		input.projectEntity,
		input.artifactPath,
		completedAt,
		completionNote,
		routing
	);
	const context = buildReceiptContext("artifact_receipt", {
		task_id: input.existingTask.id,
		project_entity_id: input.projectEntity.id,
		artifact_path: input.artifactPath,
		repo_slug: routing?.repo_slug
	});

	return {
		id: generateId("obs"),
		content,
		territory: "craft",
		created: completedAt,
		texture: {
			salience: "background",
			vividness: "soft",
			charge: ["receipt", "artifact", "project-routing"],
			grip: "loose",
			charge_phase: "fresh"
		},
		context,
		access_count: 0,
		type: "artifact_receipt",
		tags: buildReceiptTags("artifact-receipt", routing?.repo_slug, "task-complete"),
		entity_id: input.projectEntity.id
	};
}

export function buildDeployReceiptObservation(input: {
	projectEntity: Entity;
	dossier: ProjectDossier;
	status: DeployStatus;
	deploy_command?: string;
	deploy_target?: string;
	branch?: string;
	commit_sha?: string;
	preview_url?: string;
	production_url?: string;
	artifact_path?: string;
	started_at?: string;
	completed_at?: string;
	failure_reason?: string;
}): Observation {
	const routing = getRuntimeRouting(input.dossier);
	const completedAt = input.completed_at ?? getTimestamp();
	const effectiveBranch = input.branch ?? routing?.default_branch;
	const effectiveDeployCommand = input.deploy_command ?? routing?.deploy_commands?.[0];
	const effectivePreviewUrl = input.preview_url ?? routing?.preview_urls?.[0];
	const effectiveProductionUrl = input.production_url ?? routing?.production_urls?.[0];
	const content = buildDeployReceiptContent({
		...input,
		branch: effectiveBranch,
		deploy_command: effectiveDeployCommand,
		preview_url: effectivePreviewUrl,
		production_url: effectiveProductionUrl,
		completed_at: completedAt,
		routing
	});
	const context = buildReceiptContext("deploy_receipt", {
		project_entity_id: input.projectEntity.id,
		status: input.status,
		repo_slug: routing?.repo_slug,
		branch: effectiveBranch,
		commit_sha: input.commit_sha,
		deploy_target: input.deploy_target,
		production_url: effectiveProductionUrl,
		preview_url: effectivePreviewUrl
	});

	return {
		id: generateId("obs"),
		content,
		territory: "craft",
		created: completedAt,
		texture: {
			salience: input.status === "failed" ? "active" : "background",
			vividness: input.status === "failed" ? "vivid" : "soft",
			charge: ["receipt", "deploy", input.status, "project-routing"],
			grip: input.status === "failed" ? "present" : "loose",
			charge_phase: "fresh"
		},
		context,
		access_count: 0,
		type: "deploy_receipt",
		tags: buildReceiptTags("deploy-receipt", routing?.repo_slug, input.status, input.deploy_target),
		entity_id: input.projectEntity.id
	};
}

export function buildRepoReceiptObservation(input: {
	projectEntity: Entity;
	dossier: ProjectDossier;
	status: RepoStatus;
	repo_slug?: string;
	repo_url?: string;
	branch?: string;
	default_branch?: string;
	commit_sha?: string;
	local_path?: string;
	changed_paths?: string[];
	actor?: string;
	platform?: string;
	source?: string;
	summary?: string;
	completed_at?: string;
	failure_reason?: string;
}): Observation {
	const routing = getRuntimeRouting(input.dossier);
	const completedAt = input.completed_at ?? getTimestamp();
	const effectiveRepoSlug = input.repo_slug ?? routing?.repo_slug;
	const effectiveRepoUrl = input.repo_url ?? routing?.canonical_repo_url;
	const effectiveBranch = input.branch ?? input.default_branch ?? routing?.default_branch;
	const effectiveDefaultBranch = input.default_branch ?? routing?.default_branch;
	const effectiveLocalPath = input.local_path ?? routing?.local_workspace;
	const content = buildRepoReceiptContent({
		...input,
		repo_slug: effectiveRepoSlug,
		repo_url: effectiveRepoUrl,
		branch: effectiveBranch,
		default_branch: effectiveDefaultBranch,
		local_path: effectiveLocalPath,
		completed_at: completedAt,
		routing
	});
	const context = buildReceiptContext("repo_receipt", {
		project_entity_id: input.projectEntity.id,
		status: input.status,
		repo_slug: effectiveRepoSlug,
		repo_url: effectiveRepoUrl,
		branch: effectiveBranch,
		commit_sha: input.commit_sha,
		platform: input.platform,
		source: input.source
	});

	return {
		id: generateId("obs"),
		content,
		territory: "craft",
		created: completedAt,
		texture: {
			salience: input.status === "failed" ? "active" : "background",
			vividness: input.status === "failed" ? "vivid" : "soft",
			charge: ["receipt", "repo", input.status, "project-routing"],
			grip: input.status === "failed" ? "present" : "loose",
			charge_phase: "fresh"
		},
		context,
		access_count: 0,
		type: "repo_receipt",
		tags: buildReceiptTags("repo-receipt", effectiveRepoSlug, input.status, input.platform, input.source),
		entity_id: input.projectEntity.id
	};
}

async function resolveReceiptProject(
	storage: ToolContext["storage"],
	input: { project_entity_id?: string; project_name?: string }
): Promise<{ entity: Entity; dossier: ProjectDossier } | { error: string }> {
	let entity: Entity | null = null;
	if (input.project_entity_id) {
		entity = await storage.findEntityById(input.project_entity_id);
	} else if (input.project_name) {
		entity = await storage.findEntityByName(input.project_name);
	} else {
		return { error: "project_entity_id or project_name is required" };
	}

	if (!entity) return { error: "Project not found" };
	if (entity.entity_type !== "project") return { error: "Receipt target must be a project entity" };

	const dossier = await storage.getProjectDossier(entity.id);
	if (!dossier) return { error: `Project dossier not found for ${entity.id}` };

	return { entity, dossier };
}

function validateDeployReceiptInput(args: any): {
	project_entity_id?: string;
	project_name?: string;
	status: DeployStatus;
	deploy_command?: string;
	deploy_target?: string;
	branch?: string;
	commit_sha?: string;
	preview_url?: string;
	production_url?: string;
	artifact_path?: string;
	started_at?: string;
	completed_at?: string;
	failure_reason?: string;
} | { error: string } {
	const projectEntityId = cleanText(args.project_entity_id);
	const projectName = cleanText(args.project_name);
	if (!projectEntityId && !projectName) return { error: "project_entity_id or project_name is required" };

	const status = cleanText(args.status);
	if (!status || !DEPLOY_STATUSES.includes(status as DeployStatus)) {
		return { error: `status must be one of: ${DEPLOY_STATUSES.join(", ")}` };
	}

	const deployCommand = normalizeBoundedString(args.deploy_command, "deploy_command", MAX_COMMAND_LENGTH);
	if ("error" in deployCommand) return { error: deployCommand.error };
	const deployTarget = normalizeBoundedString(args.deploy_target, "deploy_target", MAX_SHORT_FIELD_LENGTH);
	if ("error" in deployTarget) return { error: deployTarget.error };
	const branch = normalizeBoundedString(args.branch, "branch", MAX_SHORT_FIELD_LENGTH);
	if ("error" in branch) return { error: branch.error };
	const commitSha = normalizeBoundedString(args.commit_sha, "commit_sha", MAX_SHORT_FIELD_LENGTH);
	if ("error" in commitSha) return { error: commitSha.error };
	const previewUrl = normalizeBoundedString(args.preview_url, "preview_url", MAX_PATH_LENGTH);
	if ("error" in previewUrl) return { error: previewUrl.error };
	const productionUrl = normalizeBoundedString(args.production_url, "production_url", MAX_PATH_LENGTH);
	if ("error" in productionUrl) return { error: productionUrl.error };
	const artifactPath = normalizeBoundedString(args.artifact_path, "artifact_path", MAX_PATH_LENGTH);
	if ("error" in artifactPath) return { error: artifactPath.error };
	const failureReason = normalizeBoundedString(args.failure_reason, "failure_reason", MAX_REASON_LENGTH);
	if ("error" in failureReason) return { error: failureReason.error };

	const startedAt = normalizeTimestamp(args.started_at, "started_at");
	if ("error" in startedAt) return { error: startedAt.error };
	const completedAt = normalizeTimestamp(args.completed_at, "completed_at");
	if ("error" in completedAt) return { error: completedAt.error };

	return {
		project_entity_id: projectEntityId,
		project_name: projectName,
		status: status as DeployStatus,
		deploy_command: deployCommand.value,
		deploy_target: deployTarget.value,
		branch: branch.value,
		commit_sha: commitSha.value,
		preview_url: previewUrl.value,
		production_url: productionUrl.value,
		artifact_path: artifactPath.value,
		started_at: startedAt.value,
		completed_at: completedAt.value,
		failure_reason: failureReason.value
	};
}

function validateRepoReceiptInput(args: any): {
	project_entity_id?: string;
	project_name?: string;
	status: RepoStatus;
	repo_slug?: string;
	repo_url?: string;
	branch?: string;
	default_branch?: string;
	commit_sha?: string;
	local_path?: string;
	changed_paths?: string[];
	actor?: string;
	platform?: string;
	source?: string;
	summary?: string;
	completed_at?: string;
	failure_reason?: string;
} | { error: string } {
	const projectEntityId = cleanText(args.project_entity_id);
	const projectName = cleanText(args.project_name);
	if (!projectEntityId && !projectName) return { error: "project_entity_id or project_name is required" };

	const status = cleanText(args.status);
	if (!status || !REPO_STATUSES.includes(status as RepoStatus)) {
		return { error: `status must be one of: ${REPO_STATUSES.join(", ")}` };
	}

	const repoSlug = normalizeBoundedString(args.repo_slug, "repo_slug", MAX_SHORT_FIELD_LENGTH);
	if ("error" in repoSlug) return { error: repoSlug.error };
	const repoUrl = normalizeBoundedString(args.repo_url, "repo_url", MAX_PATH_LENGTH);
	if ("error" in repoUrl) return { error: repoUrl.error };
	const branch = normalizeBoundedString(args.branch, "branch", MAX_SHORT_FIELD_LENGTH);
	if ("error" in branch) return { error: branch.error };
	const defaultBranch = normalizeBoundedString(args.default_branch, "default_branch", MAX_SHORT_FIELD_LENGTH);
	if ("error" in defaultBranch) return { error: defaultBranch.error };
	const commitSha = normalizeBoundedString(args.commit_sha, "commit_sha", MAX_SHORT_FIELD_LENGTH);
	if ("error" in commitSha) return { error: commitSha.error };
	const localPath = normalizeBoundedString(args.local_path, "local_path", MAX_PATH_LENGTH);
	if ("error" in localPath) return { error: localPath.error };
	const actor = normalizeBoundedString(args.actor, "actor", MAX_SHORT_FIELD_LENGTH);
	if ("error" in actor) return { error: actor.error };
	const platform = normalizeBoundedString(args.platform, "platform", MAX_SHORT_FIELD_LENGTH);
	if ("error" in platform) return { error: platform.error };
	const source = normalizeBoundedString(args.source, "source", MAX_SHORT_FIELD_LENGTH);
	if ("error" in source) return { error: source.error };
	const summary = normalizeBoundedString(args.summary, "summary", MAX_REASON_LENGTH);
	if ("error" in summary) return { error: summary.error };
	const failureReason = normalizeBoundedString(args.failure_reason, "failure_reason", MAX_REASON_LENGTH);
	if ("error" in failureReason) return { error: failureReason.error };
	const changedPaths = normalizeRepoPathList(args.changed_paths, "changed_paths");
	if ("error" in changedPaths) return { error: changedPaths.error };
	const completedAt = normalizeTimestamp(args.completed_at, "completed_at");
	if ("error" in completedAt) return { error: completedAt.error };

	return {
		project_entity_id: projectEntityId,
		project_name: projectName,
		status: status as RepoStatus,
		repo_slug: repoSlug.value,
		repo_url: repoUrl.value,
		branch: branch.value,
		default_branch: defaultBranch.value,
		commit_sha: commitSha.value,
		local_path: localPath.value,
		changed_paths: changedPaths.value,
		actor: actor.value,
		platform: platform.value,
		source: source.value,
		summary: summary.value,
		completed_at: completedAt.value,
		failure_reason: failureReason.value
	};
}

function getRuntimeRouting(dossier: ProjectDossier): WorkspaceRouting | undefined {
	return projectWorkspaceRoutingToRuntimeRouting(
		extractProjectWorkspaceRoutingFromMetadata(dossier.metadata)
	);
}

function buildArtifactReceiptContent(
	task: Task,
	projectEntity: Entity,
	artifactPath: string,
	completedAt: string,
	completionNote?: string,
	routing?: WorkspaceRouting
): string {
	const lines = compactLines([
		"artifact_receipt",
		`task_id: ${task.id}`,
		`task_title: ${task.title}`,
		`project_entity_id: ${projectEntity.id}`,
		`project_name: ${projectEntity.name}`,
		`artifact_path: ${artifactPath}`,
		`completed_at: ${completedAt}`,
		task.source ? `task_source: ${task.source}` : undefined,
		routing?.repo_slug ? `repo_slug: ${routing.repo_slug}` : undefined,
		routing?.canonical_repo_url ? `canonical_repo_url: ${routing.canonical_repo_url}` : undefined,
		routing?.default_branch ? `default_branch: ${routing.default_branch}` : undefined,
		routing?.local_workspace ? `local_workspace: ${routing.local_workspace}` : undefined,
		routing?.artifact_workspace ? `artifact_workspace: ${routing.artifact_workspace}` : undefined
	]);

	appendCommandLines(lines, "deploy_command", routing?.deploy_commands);
	appendCommandLines(lines, "test_command", routing?.test_commands);

	if (completionNote) {
		lines.push("", "completion_note:", completionNote);
	}

	return lines.join("\n");
}

function buildDeployReceiptContent(input: {
	projectEntity: Entity;
	status: DeployStatus;
	deploy_command?: string;
	deploy_target?: string;
	branch?: string;
	commit_sha?: string;
	preview_url?: string;
	production_url?: string;
	artifact_path?: string;
	started_at?: string;
	completed_at: string;
	failure_reason?: string;
	routing?: WorkspaceRouting;
}): string {
	const lines = compactLines([
		"deploy_receipt",
		`project_entity_id: ${input.projectEntity.id}`,
		`project_name: ${input.projectEntity.name}`,
		`status: ${input.status}`,
		input.deploy_target ? `deploy_target: ${input.deploy_target}` : undefined,
		input.deploy_command ? `deploy_command: ${input.deploy_command}` : undefined,
		input.branch ? `branch: ${input.branch}` : undefined,
		input.commit_sha ? `commit_sha: ${input.commit_sha}` : undefined,
		input.artifact_path ? `artifact_path: ${input.artifact_path}` : undefined,
		input.preview_url ? `preview_url: ${input.preview_url}` : undefined,
		input.production_url ? `production_url: ${input.production_url}` : undefined,
		input.started_at ? `started_at: ${input.started_at}` : undefined,
		`completed_at: ${input.completed_at}`,
		input.routing?.repo_slug ? `repo_slug: ${input.routing.repo_slug}` : undefined,
		input.routing?.canonical_repo_url ? `canonical_repo_url: ${input.routing.canonical_repo_url}` : undefined,
		input.routing?.local_workspace ? `local_workspace: ${input.routing.local_workspace}` : undefined,
		input.routing?.artifact_workspace ? `artifact_workspace: ${input.routing.artifact_workspace}` : undefined
	]);

	if (input.failure_reason) {
		lines.push("", "failure_reason:", input.failure_reason);
	}

	return lines.join("\n");
}

function buildRepoReceiptContent(input: {
	projectEntity: Entity;
	status: RepoStatus;
	repo_slug?: string;
	repo_url?: string;
	branch?: string;
	default_branch?: string;
	commit_sha?: string;
	local_path?: string;
	changed_paths?: string[];
	actor?: string;
	platform?: string;
	source?: string;
	summary?: string;
	completed_at: string;
	failure_reason?: string;
	routing?: WorkspaceRouting;
}): string {
	const lines = compactLines([
		"repo_receipt",
		`project_entity_id: ${input.projectEntity.id}`,
		`project_name: ${input.projectEntity.name}`,
		`status: ${input.status}`,
		input.repo_slug ? `repo_slug: ${input.repo_slug}` : undefined,
		input.repo_url ? `repo_url: ${input.repo_url}` : undefined,
		input.branch ? `branch: ${input.branch}` : undefined,
		input.default_branch ? `default_branch: ${input.default_branch}` : undefined,
		input.commit_sha ? `commit_sha: ${input.commit_sha}` : undefined,
		input.local_path ? `local_path: ${input.local_path}` : undefined,
		input.actor ? `actor: ${input.actor}` : undefined,
		input.platform ? `platform: ${input.platform}` : undefined,
		input.source ? `source: ${input.source}` : undefined,
		`completed_at: ${input.completed_at}`
	]);

	if (input.changed_paths?.length) {
		lines.push("", "changed_paths:");
		for (const changedPath of input.changed_paths) {
			lines.push(`- ${changedPath}`);
		}
	}

	if (input.summary) {
		lines.push("", "summary:", input.summary);
	}

	if (input.failure_reason) {
		lines.push("", "failure_reason:", input.failure_reason);
	}

	return lines.join("\n");
}

function normalizeBoundedString(
	value: unknown,
	field: string,
	maxLength: number
): { value?: string } | { error: string } {
	if (value === undefined) return {};
	if (typeof value !== "string") return { error: `${field} must be a string` };
	if (value.includes("\0")) return { error: `${field} cannot contain null bytes` };
	const cleaned = cleanText(value);
	if (!cleaned) return {};
	if (cleaned.length > maxLength) return { error: `${field} too long (max ${maxLength} chars)` };
	return { value: cleaned };
}

function normalizeRepoPathList(value: unknown, field: string): { value?: string[] } | { error: string } {
	if (value === undefined) return {};
	if (!Array.isArray(value)) return { error: `${field} must be an array of strings` };
	if (value.length > MAX_CHANGED_PATHS) return { error: `${field} too long (max ${MAX_CHANGED_PATHS} paths)` };

	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") return { error: `${field} entries must be strings` };
		if (item.includes("\0")) return { error: `${field} entries cannot contain null bytes` };
		const cleaned = cleanText(item);
		if (!cleaned) continue;
		if (cleaned.length > MAX_PATH_LENGTH) return { error: `${field} entry too long (max ${MAX_PATH_LENGTH} chars)` };
		if (cleaned.startsWith("/") || cleaned.includes("\\") || cleaned.split("/").includes("..")) {
			return { error: `${field} entries must be repository-relative paths without traversal` };
		}
		out.push(cleaned);
	}

	return out.length ? { value: Array.from(new Set(out)) } : {};
}

function normalizeTimestamp(value: unknown, field: string): { value?: string } | { error: string } {
	if (value === undefined) return {};
	if (typeof value !== "string") return { error: `${field} must be a string` };
	const cleaned = cleanText(value);
	if (!cleaned) return {};
	const timestamp = new Date(cleaned);
	if (Number.isNaN(timestamp.getTime())) return { error: `${field} must be a valid timestamp` };
	return { value: timestamp.toISOString() };
}

function buildReceiptContext(kind: string, fields: Record<string, string | undefined>): string {
	return [
		kind,
		...Object.entries(fields)
			.filter((entry): entry is [string, string] => Boolean(entry[1]))
			.map(([key, value]) => `${key}=${value}`)
	].join(" ");
}

function buildReceiptTags(kind: string, ...values: Array<string | undefined>): string[] {
	return [
		"receipt",
		kind,
		...values
			.map(value => cleanText(value))
			.filter((value): value is string => Boolean(value))
	];
}

function compactLines(lines: Array<string | undefined>): string[] {
	return lines.filter((line): line is string => Boolean(line));
}

function appendCommandLines(lines: string[], label: string, commands?: string[]): void {
	if (!commands?.length) return;
	for (const command of commands) {
		lines.push(`${label}: ${command}`);
	}
}
