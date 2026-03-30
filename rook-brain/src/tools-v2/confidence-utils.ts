// ============ CONFIDENCE UTILITIES (v2) ============
// Shared confidence scoring helpers used by search.ts and memory.ts.

import { CONFIDENCE_DEFAULTS } from "../constants";
import type { ToolContext } from "./context";

export function parseConfidenceThreshold(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	if (value < 0 || value > 1) return undefined;
	return value;
}

export function parseOptionalPositiveInt(value: unknown, min: number, max: number): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	if (!Number.isInteger(value)) return undefined;
	if (value < min || value > max) return undefined;
	return value;
}

export interface HybridResultBase {
	observation: { id: string; created: string };
	score: number;
}

export function applyConfidenceScoring<T extends HybridResultBase>(
	results: T[],
	recencyBoostDays: number,
	recencyBoost: number
): (T & { confidence: number; recency_boost_applied: number })[] {
	const nowMs = Date.now();
	const recencyWindowMs = recencyBoostDays * 24 * 60 * 60 * 1000;
	return results.map(r => {
		const createdMs = new Date(r.observation.created).getTime();
		const isRecent = !Number.isNaN(createdMs) && (nowMs - createdMs) <= recencyWindowMs;
		const appliedBoost = isRecent ? recencyBoost : 0;
		const confidence = Math.min(1, Math.max(0, r.score + appliedBoost));
		return { ...r, confidence, recency_boost_applied: appliedBoost };
	});
}

export function filterAndCapByConfidence<T extends { confidence: number }>(
	scored: T[],
	confidenceThreshold: number | undefined,
	shadowMode: boolean,
	maxContextItems: number
): { filtered: T[]; belowThresholdCount: number; preCapCount: number } {
	const belowThresholdCount = confidenceThreshold !== undefined
		? scored.filter(r => r.confidence < confidenceThreshold).length
		: 0;
	const afterThreshold = (confidenceThreshold !== undefined && !shadowMode)
		? scored.filter(r => r.confidence >= confidenceThreshold)
		: scored;
	return {
		filtered: afterThreshold.slice(0, maxContextItems),
		belowThresholdCount,
		preCapCount: afterThreshold.length
	};
}

export function fireAndForgetSideEffects(
	context: ToolContext,
	ids: string[],
	label: string
): void {
	if (context.waitUntil) {
		context.waitUntil(
			Promise.all([
				context.storage.recordMemoryCascade(ids),
				context.storage.updateSurfacingEffects(ids)
			]).catch(err => console.error(`${label} side effects failed:`, err instanceof Error ? err.message : "unknown error"))
		);
	}
}

export { CONFIDENCE_DEFAULTS };
