import { appendFileSync } from "fs";

export interface AuditEntry {
  timestamp: string;
  duration_ms: number;
  iterations: number;
  tool_calls: string[];
  model: string;
  tenant: string;
  status: "completed" | "budget_exceeded" | "error" | "validation_failed";
  failure_code?: string;
  stage_artifacts?: string[];
  self_improvement?: {
    enabled: boolean;
    pending: number;
    reviewed: number;
    accepted: number;
    rejected: number;
    reviewed_ids: string[];
    error?: string;
  };
  error?: string;
  summary?: string;
}

export function logRun(auditPath: string, entry: AuditEntry): void {
  const line = JSON.stringify(entry) + "\n";
  try {
    appendFileSync(auditPath, line, "utf-8");
  } catch (err: unknown) {
    // Don't crash the runner over an audit write failure — just warn
    console.error(`Audit write failed (${auditPath}):`, err);
  }
}
