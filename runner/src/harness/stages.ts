export const STAGE_NAMES = ["plan", "execute", "verify", "repair"] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export const DEFAULT_STAGE_FLOW: StageName[] = ["plan", "execute", "verify", "repair"];

export type StageStatus = "completed" | "failed";

export interface StageArtifact<TOutput = Record<string, unknown>> {
  run_id: string;
  stage: StageName;
  attempt: number;
  started_at: string;
  completed_at: string;
  status: StageStatus;
  failure_code?: string;
  input: Record<string, unknown>;
  output: TOutput;
}

export function isStageName(value: unknown): value is StageName {
  return typeof value === "string" && STAGE_NAMES.includes(value as StageName);
}

export function normalizeStageFlow(rawFlow: unknown): StageName[] {
  if (!Array.isArray(rawFlow) || rawFlow.length === 0) {
    return [...DEFAULT_STAGE_FLOW];
  }

  const normalized: StageName[] = [];
  for (const item of rawFlow) {
    if (isStageName(item) && !normalized.includes(item)) {
      normalized.push(item);
    }
  }

  if (!normalized.includes("plan")) normalized.unshift("plan");
  if (!normalized.includes("execute")) normalized.push("execute");
  if (!normalized.includes("verify")) normalized.push("verify");

  return normalized;
}

export function buildPlanPrompt(
  wakeState: string,
  requiredOutputs: string[],
  harnessBody: string
): string {
  const outputs = requiredOutputs.join(", ");
  return `Stage: plan

You are in the PLAN stage of a harnessed autonomous run.
Use the wake payload to decide one concrete work target.

Wake payload:
${wakeState}

Harness guidance:
${harnessBody}

Return compact JSON only:
{
  "focus": "<single task or loop to advance>",
  "why_now": "<priority reason>",
  "success_criteria": ["<check 1>", "<check 2>"],
  "required_outputs": [${outputs ? `"${outputs.split(", ").join('", "')}"` : ""}]
}`;
}

export function buildExecutePrompt(
  wakeState: string,
  planText: string,
  requiredOutputs: string[],
  harnessBody: string
): string {
  const outputTemplate = requiredOutputs
    .map((key) => `  "${key}": "<value>"`)
    .join(",\n");

  return `Stage: execute

You are in the EXECUTE stage.
Advance the plan by calling tools as needed.

Wake payload:
${wakeState}

Plan artifact:
${planText}

Harness guidance:
${harnessBody}

Rules:
- Use tools when needed; do not hallucinate tool outcomes.
- Be concise and action-oriented.
- Final response MUST be valid JSON object only.

Required JSON keys:
${requiredOutputs.map((k) => `- ${k}`).join("\n")}

Return:
{
${outputTemplate}
}`;
}

export function buildRepairPrompt(
  wakeState: string,
  planText: string,
  previousOutput: string,
  failureReasons: string[],
  requiredOutputs: string[],
  harnessBody: string
): string {
  const outputTemplate = requiredOutputs
    .map((key) => `  "${key}": "<value>"`)
    .join(",\n");

  return `Stage: repair

You are in the REPAIR stage.
The previous execute output failed validation.

Failure reasons:
${failureReasons.map((r) => `- ${r}`).join("\n")}

Wake payload:
${wakeState}

Plan artifact:
${planText}

Previous output (failed):
${previousOutput}

Harness guidance:
${harnessBody}

Produce corrected JSON only with all required keys.
{
${outputTemplate}
}`;
}

