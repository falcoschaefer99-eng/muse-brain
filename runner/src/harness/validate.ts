import type { HarnessContract, ValidationGate } from "./contracts.js";

export interface ValidationContext {
  parsed_output: Record<string, unknown> | null;
  raw_output: string;
  tool_calls: string[];
  iterations: number;
  max_iterations: number;
}

export interface ValidationGateResult {
  gate_id: string;
  passed: boolean;
  reason?: string;
}

export interface ValidationResult {
  passed: boolean;
  results: ValidationGateResult[];
  failure_reasons: string[];
}

function includesAll(haystack: string[], needles: string[]): string[] {
  const missing: string[] = [];
  for (const needle of needles) {
    if (!haystack.includes(needle)) missing.push(needle);
  }
  return missing;
}

function runGate(gate: ValidationGate, contract: HarnessContract, ctx: ValidationContext): ValidationGateResult {
  if (gate.type === "required_output_keys") {
    const keys = gate.keys ?? contract.required_outputs;
    if (!ctx.parsed_output) {
      return {
        gate_id: gate.id,
        passed: false,
        reason: "output is not valid JSON",
      };
    }

    const missing = keys.filter((key) => !(key in ctx.parsed_output!));
    if (missing.length > 0) {
      return {
        gate_id: gate.id,
        passed: false,
        reason: `missing required output keys: ${missing.join(", ")}`,
      };
    }

    return { gate_id: gate.id, passed: true };
  }

  if (gate.type === "must_call_tools") {
    const requiredTools = gate.tools ?? [];
    const missingTools = includesAll(ctx.tool_calls, requiredTools);
    if (missingTools.length > 0) {
      return {
        gate_id: gate.id,
        passed: false,
        reason: `required tools not called: ${missingTools.join(", ")}`,
      };
    }
    return { gate_id: gate.id, passed: true };
  }

  if (gate.type === "non_empty_summary") {
    const raw = ctx.raw_output.trim();
    if (!raw || raw === "(no final text)") {
      return {
        gate_id: gate.id,
        passed: false,
        reason: "output summary is empty",
      };
    }
    return { gate_id: gate.id, passed: true };
  }

  if (gate.type === "max_iterations") {
    const max = gate.max ?? ctx.max_iterations;
    if (ctx.iterations > max) {
      return {
        gate_id: gate.id,
        passed: false,
        reason: `iteration budget exceeded (${ctx.iterations}/${max})`,
      };
    }
    return { gate_id: gate.id, passed: true };
  }

  return {
    gate_id: gate.id,
    passed: false,
    reason: `unknown gate type: ${gate.type}`,
  };
}

export function runValidationGates(contract: HarnessContract, ctx: ValidationContext): ValidationResult {
  const results: ValidationGateResult[] = contract.validation_gates.map((gate) => runGate(gate, contract, ctx));
  const failure_reasons = results.filter((item) => !item.passed).map((item) => item.reason ?? item.gate_id);
  return {
    passed: failure_reasons.length === 0,
    results,
    failure_reasons,
  };
}

