import { readFileSync } from "fs";
import { normalizeStageFlow, type StageName } from "./stages.js";
import { FAILURE_CODES, isFailureCode, HarnessFailure, type FailureCode } from "./failures.js";

export type ValidationGateType =
  | "required_output_keys"
  | "must_call_tools"
  | "non_empty_summary"
  | "max_iterations";

export interface ValidationGate {
  id: string;
  type: ValidationGateType;
  keys?: string[];
  tools?: string[];
  max?: number;
}

export interface StopConditions {
  max_repairs: number;
}

export interface HarnessContract {
  version: number;
  stage_flow: StageName[];
  required_outputs: string[];
  validation_gates: ValidationGate[];
  failure_codes: FailureCode[];
  stop_conditions: StopConditions;
}

export interface HarnessDefinition {
  name: string;
  model?: string;
  source_path: string;
  prompt_body: string;
  contract: HarnessContract;
}

interface FrontmatterData {
  [key: string]: string;
}

function extractFrontmatter(raw: string): { frontmatter: string; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new HarnessFailure("contract_fail", "Agent file missing frontmatter block");
  }

  const closingIdx = normalized.indexOf("\n---\n", 4);
  if (closingIdx < 0) {
    throw new HarnessFailure("contract_fail", "Agent file has unclosed frontmatter");
  }

  const frontmatter = normalized.slice(4, closingIdx);
  const body = normalized.slice(closingIdx + 5);
  return { frontmatter, body: body.trim() };
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(frontmatter: string): FrontmatterData {
  const lines = frontmatter.split("\n");
  const data: FrontmatterData = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim() || line.trim().startsWith("#")) continue;

    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    if (!key) continue;
    const value = match[2] ?? "";

    if (value === "|" || value === ">") {
      const blockLines: string[] = [];
      i += 1;
      while (i < lines.length) {
        const nextLine = lines[i] ?? "";
        if (nextLine.trim() === "") {
          blockLines.push("");
          i += 1;
          continue;
        }
        if (/^\s/.test(nextLine)) {
          blockLines.push(nextLine.replace(/^\s{2}/, ""));
          i += 1;
          continue;
        }
        i -= 1;
        break;
      }
      data[key] = blockLines.join("\n").trim();
      continue;
    }

    data[key] = stripQuotes(value);
  }

  return data;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) {
    throw new HarnessFailure("contract_fail", `Contract field "${field}" must be a non-empty string array`);
  }
  return value as string[];
}

function asOptionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HarnessFailure("contract_fail", `Contract field "${field}" must be a string array`);
  }
  return value as string[];
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HarnessFailure("contract_fail", `Contract field "${field}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseValidationGates(raw: unknown, requiredOutputs: string[]): ValidationGate[] {
  if (raw === undefined) {
    return [
      { id: "required_output_keys", type: "required_output_keys", keys: requiredOutputs },
      { id: "non_empty_summary", type: "non_empty_summary" },
    ];
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HarnessFailure("contract_fail", "Contract field \"validation_gates\" must be a non-empty array");
  }

  const gates: ValidationGate[] = [];
  for (let idx = 0; idx < raw.length; idx++) {
    const item = raw[idx];
    const row = asRecord(item, `validation_gates[${idx}]`);
    const type = row["type"];
    if (
      type !== "required_output_keys" &&
      type !== "must_call_tools" &&
      type !== "non_empty_summary" &&
      type !== "max_iterations"
    ) {
      throw new HarnessFailure("contract_fail", `Unsupported validation gate type: ${String(type)}`);
    }

    const gate: ValidationGate = {
      id: typeof row["id"] === "string" ? row["id"] : `${type}_${idx + 1}`,
      type,
    };

    if (type === "required_output_keys") {
      gate.keys = asOptionalStringArray(row["keys"], "validation_gates.keys") ?? requiredOutputs;
    } else if (type === "must_call_tools") {
      gate.tools = asStringArray(row["tools"], "validation_gates.tools");
    } else if (type === "max_iterations") {
      const max = row["max"];
      if (typeof max !== "number" || !Number.isFinite(max) || max < 1) {
        throw new HarnessFailure("contract_fail", "validation_gates.max_iterations requires numeric max >= 1");
      }
      gate.max = Math.floor(max);
    }

    gates.push(gate);
  }

  return gates;
}

function parseStopConditions(raw: unknown): StopConditions {
  if (raw === undefined) return { max_repairs: 1 };
  const parsed = asRecord(raw, "stop_conditions");
  const maxRepairsRaw = parsed["max_repairs"];
  if (maxRepairsRaw === undefined) return { max_repairs: 1 };
  if (typeof maxRepairsRaw !== "number" || !Number.isFinite(maxRepairsRaw) || maxRepairsRaw < 0) {
    throw new HarnessFailure("contract_fail", "stop_conditions.max_repairs must be number >= 0");
  }
  return { max_repairs: Math.min(Math.floor(maxRepairsRaw), 5) };
}

function parseFailureCodes(raw: unknown): FailureCode[] {
  if (raw === undefined) return [...FAILURE_CODES];
  if (!Array.isArray(raw) || raw.some((item) => !isFailureCode(item))) {
    throw new HarnessFailure(
      "contract_fail",
      `failure_codes must be array of known codes: ${FAILURE_CODES.join(", ")}`
    );
  }
  return raw as FailureCode[];
}

function parseContract(rawContract: string): HarnessContract {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContract);
  } catch (err: unknown) {
    throw new HarnessFailure(
      "contract_fail",
      `Invalid harness_contract JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const obj = asRecord(parsed, "harness_contract");

  const version = obj["version"];
  if (typeof version !== "number" || !Number.isFinite(version) || version < 1) {
    throw new HarnessFailure("contract_fail", "Contract field \"version\" must be numeric >= 1");
  }

  const requiredOutputs = asStringArray(obj["required_outputs"], "required_outputs");
  const stageFlow = normalizeStageFlow(obj["stage_flow"]);
  const validationGates = parseValidationGates(obj["validation_gates"], requiredOutputs);

  return {
    version: Math.floor(version),
    stage_flow: stageFlow,
    required_outputs: requiredOutputs,
    validation_gates: validationGates,
    failure_codes: parseFailureCodes(obj["failure_codes"]),
    stop_conditions: parseStopConditions(obj["stop_conditions"]),
  };
}

export function loadHarnessDefinition(agentFilePath: string): HarnessDefinition {
  const raw = readFileSync(agentFilePath, "utf-8");
  const { frontmatter, body } = extractFrontmatter(raw);
  const parsedFrontmatter = parseFrontmatter(frontmatter);

  const name = parsedFrontmatter["name"];
  if (!name) {
    throw new HarnessFailure("contract_fail", `Agent frontmatter missing "name" (${agentFilePath})`);
  }

  const contractRaw = parsedFrontmatter["harness_contract"];
  if (!contractRaw) {
    throw new HarnessFailure("contract_fail", `Agent frontmatter missing "harness_contract" (${agentFilePath})`);
  }

  const model = parsedFrontmatter["api_model"] || parsedFrontmatter["model"];

  return {
    name,
    model,
    source_path: agentFilePath,
    prompt_body: body || "(no harness body provided)",
    contract: parseContract(contractRaw),
  };
}
