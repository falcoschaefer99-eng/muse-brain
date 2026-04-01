import cron from "node-cron";
import type { Config } from "./config.js";
import { BrainClient } from "./brain.js";
import { runAgent } from "./agent.js";
import { logRun } from "./audit.js";

export function startDaemon(config: Config): void {
  if (!cron.validate(config.schedule)) {
    throw new Error(`Invalid cron schedule: "${config.schedule}"`);
  }

  console.log(`[runner] Daemon started. Schedule: ${config.schedule}`);

  cron.schedule(config.schedule, async () => {
    console.log(`[runner] Cron triggered at ${new Date().toISOString()}`);
    await executeRun(config);
  });
}

export async function executeRun(config: Config): Promise<void> {
  const start = Date.now();
  const brain = new BrainClient(config.brainUrl, config.brainApiKey, config.tenantId);

  try {
    const result = await runAgent(config, brain);

    logRun(config.auditPath, {
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - start,
      iterations: result.iterations,
      tool_calls: result.toolCallsMade,
      model: config.model,
      tenant: config.tenantId,
      status: result.status,
      failure_code: result.failureCode,
      stage_artifacts: result.artifactPaths,
      self_improvement: result.selfImprovement
        ? {
            enabled: result.selfImprovement.enabled,
            pending: result.selfImprovement.pending,
            reviewed: result.selfImprovement.reviewed,
            accepted: result.selfImprovement.accepted,
            rejected: result.selfImprovement.rejected,
            reviewed_ids: result.selfImprovement.reviewedIds,
            error: result.selfImprovement.error,
          }
        : undefined,
      error: result.error,
      summary: result.summary,
    });

    console.log(
      `[runner] Run complete. Status: ${result.status}, iterations: ${result.iterations}, tools: ${result.toolCallsMade.length}`
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[runner] Run failed:`, errorMsg);

    logRun(config.auditPath, {
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - start,
      iterations: 0,
      tool_calls: [],
      model: config.model,
      tenant: config.tenantId,
      status: "error",
      error: errorMsg,
    });
  }
}
