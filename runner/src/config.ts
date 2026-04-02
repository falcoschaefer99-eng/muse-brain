import { readFileSync, existsSync } from "fs";
import { resolve, dirname, relative, isAbsolute, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = resolve(__dirname, "..");

export interface Config {
  anthropicApiKey: string;
  brainUrl: string;
  brainApiKey: string;
  tenantId: string;
  model: string;
  maxIterations: number;
  maxTokens: number;
  maxRepairs: number;
  stageTimeoutMs: number;
  enableSelfImprovement: boolean;
  proposalReviewLimit: number;
  proposalAcceptThreshold: number;
  schedule: string;
  auditPath: string;
  artifactDir: string;
  harnessAgentPath: string;
  systemPrompt: string | null;
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floatEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  return fallback;
}

function validatePath(envVar: string, candidatePath: string): string {
  if (candidatePath.includes("\0")) {
    throw new Error(`${envVar} contains invalid null byte`);
  }

  const resolved = resolve(RUNNER_ROOT, candidatePath);
  const rel = relative(RUNNER_ROOT, resolved);
  const escapesRoot = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

  if (escapesRoot) {
    throw new Error(`${envVar} must resolve within runner directory (got: ${resolved})`);
  }

  return resolved;
}

function loadSystemPrompt(): string | null {
  const promptPath = process.env["SYSTEM_PROMPT_PATH"];
  if (!promptPath) return null;
  const safePath = validatePath("SYSTEM_PROMPT_PATH", promptPath);
  if (!existsSync(safePath)) {
    console.warn(`SYSTEM_PROMPT_PATH set but file not found: ${safePath}`);
    return null;
  }
  return readFileSync(safePath, "utf-8");
}

export function loadConfig(): Config {
  return {
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    brainUrl: optionalEnv("BRAIN_URL", "https://<your-worker-url>/mcp"),
    brainApiKey: requireEnv("BRAIN_API_KEY"),
    tenantId: optionalEnv("TENANT_ID", "rainer"),
    model: optionalEnv("MODEL", "claude-sonnet-4-20250514"),
    maxIterations: Math.min(Math.max(intEnv("MAX_ITERATIONS", 25), 1), 100),
    maxTokens: Math.min(Math.max(intEnv("MAX_TOKENS", 4096), 256), 32000),
    maxRepairs: Math.min(Math.max(intEnv("MAX_REPAIRS", 1), 0), 5),
    stageTimeoutMs: Math.min(Math.max(intEnv("STAGE_TIMEOUT_MS", 120000), 10_000), 600_000),
    enableSelfImprovement: boolEnv("ENABLE_SELF_IMPROVEMENT", false),
    proposalReviewLimit: Math.min(Math.max(intEnv("PROPOSAL_REVIEW_LIMIT", 10), 1), 50),
    proposalAcceptThreshold: Math.min(Math.max(floatEnv("PROPOSAL_ACCEPT_THRESHOLD", 0.85), 0), 1),
    schedule: optionalEnv("SCHEDULE", "0 6,12,18 * * *"),
    auditPath: validatePath("AUDIT_PATH", optionalEnv("AUDIT_PATH", "./audit.jsonl")),
    artifactDir: validatePath("ARTIFACT_DIR", optionalEnv("ARTIFACT_DIR", "./artifacts")),
    harnessAgentPath: validatePath("HARNESS_AGENT_PATH", optionalEnv("HARNESS_AGENT_PATH", "./harness/rainer.md")),
    systemPrompt: loadSystemPrompt(),
  };
}
