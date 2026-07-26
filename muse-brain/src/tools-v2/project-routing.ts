import type { ProjectWorkspaceRouting, WorkspaceRouting } from "../types";
import { cleanText, normalizeStringList } from "./utils";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasProjectRoutingContent(value: ProjectWorkspaceRouting): boolean {
	return Boolean(
		value.repo_slug
		|| value.canonical_repo_url
		|| value.default_branch
		|| value.local_paths.length
		|| value.artifact_roots.length
		|| value.test_commands.length
		|| value.path_aliases.length
		|| value.handoff_docs.length
		|| value.related_projects.length
		|| value.deploy?.kind
		|| value.deploy?.commands.length
		|| value.deploy?.preview_urls.length
		|| value.deploy?.production_urls.length
	);
}

export function normalizeProjectWorkspaceRouting(
	value: unknown
): { value?: ProjectWorkspaceRouting; error?: string } {
	if (value === undefined) return {};
	if (!isRecord(value)) return { error: "workspace_routing must be an object" };

	const deployRaw = isRecord(value.deploy) ? value.deploy : undefined;
	if (value.deploy !== undefined && !deployRaw) {
		return { error: "workspace_routing.deploy must be an object" };
	}

	const normalized: ProjectWorkspaceRouting = {
		repo_slug: cleanText(value.repo_slug),
		canonical_repo_url: cleanText(value.canonical_repo_url),
		default_branch: cleanText(value.default_branch),
		local_paths: normalizeStringList(value.local_paths),
		artifact_roots: normalizeStringList(value.artifact_roots),
		test_commands: normalizeStringList(value.test_commands),
		path_aliases: normalizeStringList(value.path_aliases),
		handoff_docs: normalizeStringList(value.handoff_docs),
		related_projects: normalizeStringList(value.related_projects),
		...(deployRaw
			? {
				deploy: {
					kind: cleanText(deployRaw.kind),
					commands: normalizeStringList(deployRaw.commands),
					preview_urls: normalizeStringList(deployRaw.preview_urls),
					production_urls: normalizeStringList(deployRaw.production_urls)
				}
			}
			: {})
	};
	if (normalized.canonical_repo_url && !isAllowedRepoUrl(normalized.canonical_repo_url)) {
		return { error: "workspace_routing.canonical_repo_url must use https://, ssh://, git+https://, or git@host:path.git form" };
	}

	return hasProjectRoutingContent(normalized)
		? { value: normalized }
		: {};
}

function isAllowedRepoUrl(value: string): boolean {
	if (value.startsWith("https://") || value.startsWith("ssh://") || value.startsWith("git+https://")) return true;
	return /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+(?:\.git)?$/.test(value);
}

export function extractProjectWorkspaceRoutingFromMetadata(
	metadata: Record<string, unknown> | undefined
): ProjectWorkspaceRouting | undefined {
	if (!metadata || !isRecord(metadata.workspace_routing)) return undefined;
	return normalizeProjectWorkspaceRouting(metadata.workspace_routing).value;
}

export function setProjectWorkspaceRoutingMetadata(
	metadata: Record<string, unknown>,
	routing?: ProjectWorkspaceRouting
): Record<string, unknown> {
	if (!routing) {
		if (!("workspace_routing" in metadata)) return metadata;
		const next = { ...metadata };
		delete next.workspace_routing;
		return next;
	}
	return {
		...metadata,
		workspace_routing: routing
	};
}

export function projectWorkspaceRoutingToRuntimeRouting(
	routing?: ProjectWorkspaceRouting
): WorkspaceRouting | undefined {
	if (!routing) return undefined;
	const runtimeRouting: WorkspaceRouting = {
		local_workspace: routing.local_paths[0],
		artifact_workspace: routing.artifact_roots[0],
		repo_slug: routing.repo_slug,
		canonical_repo_url: routing.canonical_repo_url,
		default_branch: routing.default_branch,
		deploy_commands: routing.deploy?.commands.length ? routing.deploy.commands : undefined,
		test_commands: routing.test_commands.length ? routing.test_commands : undefined,
		path_aliases: routing.path_aliases.length ? routing.path_aliases : undefined,
		handoff_docs: routing.handoff_docs.length ? routing.handoff_docs : undefined,
		related_projects: routing.related_projects.length ? routing.related_projects : undefined,
		preview_urls: routing.deploy?.preview_urls.length ? routing.deploy.preview_urls : undefined,
		production_urls: routing.deploy?.production_urls.length ? routing.deploy.production_urls : undefined
	};

	return Object.values(runtimeRouting).some(value => {
		if (Array.isArray(value)) return value.length > 0;
		return Boolean(value);
	})
		? runtimeRouting
		: undefined;
}

export function mergeWorkspaceRouting(
	base?: WorkspaceRouting,
	overlay?: WorkspaceRouting
): WorkspaceRouting | undefined {
	if (!base && !overlay) return undefined;
	if (!base) return overlay;
	if (!overlay) return base;

	const merged: WorkspaceRouting = {
		local_workspace: overlay.local_workspace ?? base.local_workspace,
		shared_workspace: overlay.shared_workspace ?? base.shared_workspace,
		peer_workspace: overlay.peer_workspace ?? base.peer_workspace,
		artifact_workspace: overlay.artifact_workspace ?? base.artifact_workspace,
		repo_slug: overlay.repo_slug ?? base.repo_slug,
		canonical_repo_url: overlay.canonical_repo_url ?? base.canonical_repo_url,
		default_branch: overlay.default_branch ?? base.default_branch,
		deploy_commands: overlay.deploy_commands?.length ? overlay.deploy_commands : base.deploy_commands,
		test_commands: overlay.test_commands?.length ? overlay.test_commands : base.test_commands,
		path_aliases: overlay.path_aliases?.length ? overlay.path_aliases : base.path_aliases,
		handoff_docs: overlay.handoff_docs?.length ? overlay.handoff_docs : base.handoff_docs,
		related_projects: overlay.related_projects?.length ? overlay.related_projects : base.related_projects,
		preview_urls: overlay.preview_urls?.length ? overlay.preview_urls : base.preview_urls,
		production_urls: overlay.production_urls?.length ? overlay.production_urls : base.production_urls
	};

	return Object.values(merged).some(value => {
		if (Array.isArray(value)) return value.length > 0;
		return Boolean(value);
	})
		? merged
		: undefined;
}
