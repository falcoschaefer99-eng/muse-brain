import { mkdirSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import type { StageArtifact } from "./stages.js";

export interface ArtifactWriteResult {
  path: string;
}

export interface LedgerEntry {
  timestamp: string;
  run_id: string;
  stage: string;
  attempt: number;
  status: string;
  failure_code?: string;
  artifact_path: string;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function writeStageArtifact(artifactDir: string, artifact: StageArtifact): ArtifactWriteResult {
  ensureDir(artifactDir);
  const fileName = `${sanitizeSegment(artifact.run_id)}.${artifact.attempt}.${artifact.stage}.json`;
  const outPath = join(artifactDir, fileName);
  writeFileSync(outPath, JSON.stringify(artifact, null, 2), "utf-8");
  return { path: outPath };
}

export function appendArtifactLedger(artifactDir: string, entry: LedgerEntry): void {
  ensureDir(artifactDir);
  const ledgerPath = join(artifactDir, "artifact-ledger.jsonl");
  appendFileSync(ledgerPath, JSON.stringify(entry) + "\n", "utf-8");
}

