import { adaptLoCoMo } from "./locomo";
import { adaptLongMemEval } from "./longmemeval";
import type { BenchmarkCase } from "../types";

export type SupportedBenchmarkDataset = "longmemeval" | "locomo";

export function adaptBenchmarkDataset(dataset: SupportedBenchmarkDataset, raw: unknown): BenchmarkCase[] {
	if (!Array.isArray(raw)) {
		throw new Error(`Expected ${dataset} input to be a JSON array`);
	}

	switch (dataset) {
		case "longmemeval":
			return adaptLongMemEval(raw as any);
		case "locomo":
			return adaptLoCoMo(raw as any);
		default:
			throw new Error(`Unsupported benchmark dataset: ${String(dataset)}`);
	}
}
