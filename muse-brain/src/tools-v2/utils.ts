// ============ TOOL UTILITIES (v2) ============
// Shared sanitization / normalization helpers for tool modules.

const DEFAULT_METADATA_MAX_BYTES = 64 * 1024;

export function cleanText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = value.trim().replace(/[\x00-\x1f]/g, "");
	return cleaned || undefined;
}

export function normalizeStringList(value: unknown, fallback: string[] = []): string[] {
	if (!Array.isArray(value)) return fallback;
	const list = value
		.filter((item): item is string => typeof item === "string")
		.map(item => item.trim())
		.filter(Boolean);
	return list.length ? list : fallback;
}

export function normalizeMetadata(
	value: unknown,
	maxBytes: number = DEFAULT_METADATA_MAX_BYTES
): { value: Record<string, unknown>; error?: string } {
	const normalized = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};

	try {
		const bytes = new TextEncoder().encode(JSON.stringify(normalized)).length;
		if (bytes > maxBytes) {
			return { value: {}, error: `metadata too large (max ${maxBytes} bytes)` };
		}
		return { value: normalized };
	} catch {
		return { value: {}, error: "metadata must be JSON-serializable" };
	}
}

export function normalizeLookupText(value: string): string {
	return value
		.toLowerCase()
		.replace(/['’]/g, "")
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function normalizeOptionalTimestamp(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") return undefined;
	const parsed = new Date(value.trim());
	if (Number.isNaN(parsed.getTime())) return undefined;
	return parsed.toISOString();
}
