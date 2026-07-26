#!/usr/bin/env node

/**
 * Git repo -> MUSE Brain repo_receipt sync bridge.
 *
 * Why: project routing truth needs proven repo/branch/commit/path evidence from
 * actual checkouts and cloud-repo automation, not prose handoffs.
 *
 * This local bridge reads one git checkout, normalizes HEAD into a
 * `mind_receipt action=repo` payload, and writes it through the authenticated
 * MCP endpoint. It is intentionally small: webhook/CI integrations can reuse
 * the same receipt shape later.
 *
 * Usage:
 *   MUSE_BRAIN_API_KEY=... node scripts/repo-receipt-sync.mjs --repo . --project-name "MUSE Brain"
 *   node scripts/repo-receipt-sync.mjs --repo /path/to/project --project-id ent_... --dry-run
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_STATE_NAME = ".repo-receipt-sync-state.json";
const MAX_CHANGED_PATHS = 200;
const MAX_STDOUT = 1024 * 1024;

function parseArgs(argv) {
	const options = {
		repo: process.cwd(),
		endpoint: process.env.MUSE_BRAIN_BASE_URL || "http://127.0.0.1:8787",
		tenant: process.env.MUSE_BRAIN_TENANT || "rainer",
		apiKey: process.env.MUSE_BRAIN_API_KEY || process.env.ROOK_BRAIN_API_KEY || process.env.BRAIN_API_KEY || "",
		projectEntityId: undefined,
		projectName: undefined,
		statePath: undefined,
		platform: "local-git",
		source: "repo-receipt-sync",
		status: "success",
		failureReason: undefined,
		summary: undefined,
		actor: process.env.USER || process.env.LOGNAME || undefined,
		dryRun: false,
		force: false,
		maxChangedPaths: MAX_CHANGED_PATHS
	};

	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token === "--repo" && argv[i + 1]) options.repo = argv[++i];
		else if (token === "--endpoint" && argv[i + 1]) options.endpoint = argv[++i];
		else if (token === "--tenant" && argv[i + 1]) options.tenant = argv[++i];
		else if (token === "--api-key" && argv[i + 1]) options.apiKey = argv[++i];
		else if (token === "--project-id" && argv[i + 1]) options.projectEntityId = argv[++i];
		else if (token === "--project-name" && argv[i + 1]) options.projectName = argv[++i];
		else if (token === "--state" && argv[i + 1]) options.statePath = argv[++i];
		else if (token === "--platform" && argv[i + 1]) options.platform = argv[++i];
		else if (token === "--source" && argv[i + 1]) options.source = argv[++i];
		else if (token === "--status" && argv[i + 1]) options.status = argv[++i];
		else if (token === "--failure-reason" && argv[i + 1]) options.failureReason = argv[++i];
		else if (token === "--summary" && argv[i + 1]) options.summary = argv[++i];
		else if (token === "--actor" && argv[i + 1]) options.actor = argv[++i];
		else if (token === "--max-changed-paths" && argv[i + 1]) {
			const parsed = Number(argv[++i]);
			if (Number.isFinite(parsed) && parsed > 0) {
				options.maxChangedPaths = Math.min(Math.floor(parsed), MAX_CHANGED_PATHS);
			}
		} else if (token === "--dry-run") options.dryRun = true;
		else if (token === "--force") options.force = true;
		else if (token === "--help" || token === "-h") {
			console.log(`Usage: node scripts/repo-receipt-sync.mjs [options]

Options:
  --repo <path>              Git checkout to read (default: cwd)
  --endpoint <url>           Brain base URL or /mcp URL
  --tenant <name>            Tenant header value (default: rainer)
  --api-key <key>            Brain API key (or env MUSE_BRAIN_API_KEY)
  --project-id <id>          Project entity id to link receipt to
  --project-name <name>      Project name lookup if id omitted
  --state <path>             State file (default: <repo>/${DEFAULT_STATE_NAME})
  --platform <name>          Receipt platform (default: local-git)
  --source <name>            Receipt source (default: repo-receipt-sync)
  --status <success|failed>  Receipt status (default: success)
  --failure-reason <text>    Failure reason when status=failed
  --summary <text>           Override summary
  --actor <name>             Actor/agent/user (default: USER/LOGNAME)
  --max-changed-paths <n>    Cap changed paths sent (max ${MAX_CHANGED_PATHS})
  --force                    Send even if HEAD was already synced
  --dry-run                  Print payload only, no MCP write or state update
  -h, --help                 Show this help
`);
			process.exit(0);
		} else {
			throw new Error(`Unknown or incomplete argument: ${token}`);
		}
	}

	if (!options.projectEntityId && !options.projectName) {
		throw new Error("Need --project-id or --project-name so the receipt links to a canonical project.");
	}
	if (options.status !== "success" && options.status !== "failed") {
		throw new Error("--status must be success or failed.");
	}

	return options;
}

function normalizeMcpUrl(endpoint) {
	const trimmed = endpoint.trim().replace(/\/+$/, "");
	if (trimmed.endsWith("/mcp")) return trimmed;
	return `${trimmed}/mcp`;
}

function hashKey(input) {
	return crypto.createHash("sha1").update(input).digest("hex");
}

async function git(repo, args) {
	const { stdout } = await execFileAsync("git", ["-C", repo, ...args], {
		encoding: "utf8",
		maxBuffer: MAX_STDOUT
	});
	return stdout.trim();
}

function firstLine(value) {
	return value.split(/\r?\n/).find(Boolean)?.trim();
}

function normalizeGitRemote(remote) {
	const trimmed = remote.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("git@github.com:")) {
		const repo = trimmed.slice("git@github.com:".length).replace(/\.git$/, "");
		return {
			url: trimmed,
			slug: repo
		};
	}
	const githubHttps = /^https:\/\/github\.com\/(.+?)(?:\.git)?$/i.exec(trimmed);
	if (githubHttps) {
		return {
			url: trimmed,
			slug: githubHttps[1]
		};
	}
	return {
		url: trimmed,
		slug: path.basename(trimmed).replace(/\.git$/, "") || undefined
	};
}

function normalizeRepoPathList(paths, maxChangedPaths) {
	const out = [];
	for (const raw of paths) {
		const value = raw.trim();
		if (!value) continue;
		if (value.includes("\0") || value.startsWith("/") || value.includes("\\") || value.split("/").includes("..")) {
			continue;
		}
		out.push(value);
		if (out.length >= maxChangedPaths) break;
	}
	return Array.from(new Set(out));
}

async function loadState(statePath) {
	try {
		const raw = await fs.readFile(statePath, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return { version: 1, repos: {} };
		return {
			version: 1,
			repos: parsed.repos && typeof parsed.repos === "object" ? parsed.repos : {}
		};
	} catch {
		return { version: 1, repos: {} };
	}
}

async function saveState(statePath, state) {
	await fs.mkdir(path.dirname(statePath), { recursive: true });
	await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function collectRepoReceipt(options) {
	const inputRepo = path.resolve(options.repo);
	const root = await git(inputRepo, ["rev-parse", "--show-toplevel"]);
	const repoRoot = path.resolve(root);
	if (repoRoot === path.parse(repoRoot).root || repoRoot === os.homedir()) {
		throw new Error(`Refusing suspicious repo root: ${repoRoot}`);
	}

	const statePath = path.resolve(options.statePath || path.join(repoRoot, DEFAULT_STATE_NAME));
	const [commitSha, branchRaw, defaultBranchRaw, remoteRaw, subjectRaw] = await Promise.all([
		git(repoRoot, ["rev-parse", "HEAD"]),
		git(repoRoot, ["branch", "--show-current"]),
		git(repoRoot, ["symbolic-ref", "refs/remotes/origin/HEAD"]).catch(() => ""),
		git(repoRoot, ["remote", "get-url", "origin"]).catch(() => ""),
		git(repoRoot, ["log", "-1", "--pretty=%s"])
	]);

	const remote = normalizeGitRemote(remoteRaw);
	const defaultBranch = defaultBranchRaw.replace(/^refs\/remotes\/origin\//, "") || undefined;
	const branch = branchRaw || undefined;
	const state = await loadState(statePath);
	const repoKey = hashKey(remote?.url || repoRoot);
	const previousCommit = state.repos[repoKey]?.last_commit_sha;
	const alreadySynced = previousCommit === commitSha;
	const changedRange = previousCommit && previousCommit !== commitSha
		? `${previousCommit}..${commitSha}`
		: commitSha;
	const changedRaw = previousCommit && previousCommit !== commitSha
		? await git(repoRoot, ["diff", "--name-only", changedRange]).catch(() => "")
		: await git(repoRoot, ["show", "--name-only", "--format=", commitSha]).catch(() => "");
	const changedPaths = normalizeRepoPathList(changedRaw.split(/\r?\n/), options.maxChangedPaths);
	const summary = options.summary || firstLine(subjectRaw) || `Repo sync for ${remote?.slug || path.basename(repoRoot)}`;

	const payload = {
		action: "repo",
		status: options.status,
		...(options.projectEntityId ? { project_entity_id: options.projectEntityId } : { project_name: options.projectName }),
		...(remote?.slug ? { repo_slug: remote.slug } : {}),
		...(remote?.url ? { repo_url: remote.url } : {}),
		...(branch ? { branch } : {}),
		...(defaultBranch ? { default_branch: defaultBranch } : {}),
		commit_sha: commitSha,
		local_path: repoRoot,
		changed_paths: changedPaths,
		...(options.actor ? { actor: options.actor } : {}),
		platform: options.platform,
		source: options.source,
		summary,
		completed_at: new Date().toISOString(),
		...(options.failureReason ? { failure_reason: options.failureReason } : {})
	};

	return {
		repoRoot,
		statePath,
		state,
		repoKey,
		previousCommit,
		alreadySynced,
		payload
	};
}

async function callMindReceipt(mcpUrl, apiKey, tenant, payload) {
	const request = {
		jsonrpc: "2.0",
		id: "repo-receipt-sync-1",
		method: "tools/call",
		params: {
			name: "mind_receipt",
			arguments: payload
		}
	};

	const response = await fetch(mcpUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${apiKey}`,
			"X-Brain-Tenant": tenant
		},
		body: JSON.stringify(request)
	});

	const raw = await response.text();
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`Non-JSON response (${response.status}): ${raw.slice(0, 280)}`);
	}

	if (!response.ok) {
		const message = parsed?.error || parsed?.message || raw;
		throw new Error(`HTTP ${response.status}: ${typeof message === "string" ? message : JSON.stringify(message)}`);
	}
	if (parsed?.error) {
		const message = parsed.error?.message || JSON.stringify(parsed.error);
		throw new Error(`MCP error: ${message}`);
	}

	const contentText = parsed?.result?.content?.[0]?.text;
	if (!contentText || typeof contentText !== "string") {
		throw new Error(`Unexpected MCP payload shape: ${JSON.stringify(parsed).slice(0, 300)}`);
	}

	let toolResult;
	try {
		toolResult = JSON.parse(contentText);
	} catch {
		throw new Error(`Tool result not JSON: ${contentText.slice(0, 280)}`);
	}
	if (toolResult?.error) {
		throw new Error(`mind_receipt error: ${toolResult.error}`);
	}
	return toolResult;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const collected = await collectRepoReceipt(options);

	console.log(`Repo: ${collected.repoRoot}`);
	console.log(`Commit: ${collected.payload.commit_sha}`);
	console.log(`Project: ${collected.payload.project_entity_id || collected.payload.project_name}`);
	console.log(`Changed paths: ${collected.payload.changed_paths.length}`);

	if (collected.alreadySynced && !options.force) {
		console.log(`Already synced HEAD; use --force to emit another receipt. state=${collected.statePath}`);
		return;
	}

	if (options.dryRun) {
		console.log("=== repo receipt payload ===");
		console.log(JSON.stringify(collected.payload, null, 2));
		console.log(`=== state path ===\n${collected.statePath}`);
		return;
	}

	if (!options.apiKey) {
		throw new Error("Missing API key. Set MUSE_BRAIN_API_KEY (or use --api-key).");
	}

	const result = await callMindReceipt(normalizeMcpUrl(options.endpoint), options.apiKey, options.tenant, collected.payload);
	collected.state.repos[collected.repoKey] = {
		synced_at: new Date().toISOString(),
		last_commit_sha: collected.payload.commit_sha,
		repo_slug: collected.payload.repo_slug,
		repo_url: collected.payload.repo_url,
		project_entity_id: collected.payload.project_entity_id,
		project_name: collected.payload.project_name,
		receipt_id: result?.receipt?.id || result?.id || null
	};
	await saveState(collected.statePath, collected.state);
	console.log(`✓ repo receipt written. state=${collected.statePath}`);
}

main().catch(err => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
