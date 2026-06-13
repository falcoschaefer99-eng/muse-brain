import { adaptLoCoMo } from "./locomo";
import { adaptLongMemEval } from "./longmemeval";
import { adaptCognitiveAdvantage } from "./cognitive-advantage";
import type { BenchmarkCase } from "../types";

export type SupportedBenchmarkDataset = "longmemeval" | "locomo" | "cognitive_advantage";

export function adaptBenchmarkDataset(dataset: SupportedBenchmarkDataset, raw: unknown): BenchmarkCase[] {
	if (!Array.isArray(raw)) {
		throw new Error(`Expected ${dataset} input to be a JSON array`);
	}
	if (!raw.every(item => typeof item === "object" && item !== null)) {
		throw new Error(`Expected ${dataset} input to contain objects`);
	}

	switch (dataset) {
		case "longmemeval":
			return adaptLongMemEval(raw as Parameters<typeof adaptLongMemEval>[0]);
		case "locomo":
			return adaptLoCoMo(raw as Parameters<typeof adaptLoCoMo>[0]);
		case "cognitive_advantage":
			return adaptCognitiveAdvantage(raw as Parameters<typeof adaptCognitiveAdvantage>[0]);
		default:
			throw new Error(`Unsupported benchmark dataset: ${String(dataset)}`);
	}
}
