export const FAILURE_CODES = [
  "timeout",
  "tool_fail",
  "contract_fail",
  "empty_output",
  "budget_exceeded",
  "validation_fail",
  "stage_error",
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

export function isFailureCode(value: unknown): value is FailureCode {
  return typeof value === "string" && FAILURE_CODES.includes(value as FailureCode);
}

export class HarnessFailure extends Error {
  public readonly code: FailureCode;
  public readonly stage?: string;

  constructor(code: FailureCode, message: string, stage?: string) {
    super(message);
    this.name = "HarnessFailure";
    this.code = code;
    this.stage = stage;
  }
}

