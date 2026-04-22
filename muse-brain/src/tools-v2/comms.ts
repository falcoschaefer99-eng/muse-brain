// ============ COMMS TOOLS (v2) ============
// mind_letter (action: write/read), mind_context (action: set/get)

import type { Letter, Observation } from "../types";
import { ALLOWED_TENANTS } from "../constants";
import { getTimestamp, generateId, toStringArray } from "../helpers";
import type { ToolContext } from "./context";
import { cleanText, normalizeLookupText } from "./utils";
import { parseOptionalPositiveInt } from "./confidence-utils";

const MAX_LETTER_CONTENT_LENGTH = 4000;
const MAX_CONTEXT_OPEN_THREAD_TASKS = 20;
const MAX_FACT_CANDIDATES = 10;
const MAX_SUMMARY_LENGTH = 10_000;
const MAX_ARRAY_ITEM_LENGTH = 2_000;
const MAX_ARRAY_ITEMS = 50;
const MAX_FACT_CONTENT_LENGTH = 2_000;
const MAX_RECALL_CONTRACTS = 25;
const MIN_RECALL_AFTER_HOURS = 1;
const MAX_RECALL_AFTER_HOURS = 24 * 30;
const MAX_LETTER_LIST_LIMIT = 50;
const DEFAULT_LETTER_LIST_LIMIT = 20;
const DEFAULT_LETTER_PREVIEW_CHARS = 180;
const MAX_LETTER_PREVIEW_CHARS = 1000;

const TASK_PRIORITIES = ["burning", "high", "normal", "low", "someday"] as const;
const RECALL_SCOPES = ["task", "proposal"] as const;

const RE_DECISION = /(decided|decision|we will|we're going to|chosen)/i;
const RE_DEADLINE = /(deadline|due|by\s+\d{4}-\d{2}-\d{2}|tomorrow|next week|next sprint)/i;
const RE_GOAL = /(goal|target|objective|aim)/i;
const RE_PREFERENCE = /(prefer|preference|likes|dislikes)/i;
const RE_ASSIGNMENT = /(assigned|owner|responsible|take care of|will handle)/i;

type ExtractedFactType = "decision" | "deadline" | "goal" | "preference" | "assignment";

interface ExtractedFact {
	fact: string;
	fact_type: ExtractedFactType;
	confidence: number;
	source: "summary" | "key_point" | "open_thread";
}

type TaskPriority = typeof TASK_PRIORITIES[number];
type RecallScope = typeof RECALL_SCOPES[number];

interface RecallContract {
	id: string;
	title: string;
	note?: string;
	recall_after_hours: number;
	scope: RecallScope;
	priority: TaskPriority;
	linked_entity_ids: string[];
	metadata: Record<string, unknown>;
}

function splitSentences(text: string): string[] {
	return text
		.split(/[\n.!?]+/)
		.map(s => s.trim())
		.filter(Boolean);
}

function classifyProductivityFact(line: string): { type: ExtractedFactType; confidence: number } | null {
	const text = line.trim();
	if (!text) return null;
	if (RE_DECISION.test(text)) return { type: "decision", confidence: 0.86 };
	if (RE_DEADLINE.test(text)) return { type: "deadline", confidence: 0.82 };
	if (RE_GOAL.test(text)) return { type: "goal", confidence: 0.78 };
	if (RE_PREFERENCE.test(text)) return { type: "preference", confidence: 0.76 };
	if (RE_ASSIGNMENT.test(text)) return { type: "assignment", confidence: 0.8 };
	return null;
}

function extractProductivityFacts(
	summary: string,
	keyPoints: string[],
	openThreads: string[],
	maxFacts: number
): ExtractedFact[] {
	const collected: ExtractedFact[] = [];
	const dedupe = new Set<string>();

	const addLine = (line: string, source: ExtractedFact["source"]) => {
		if (collected.length >= maxFacts) return;
		const clean = line.trim();
		if (!clean) return;
		const classification = classifyProductivityFact(clean);
		if (!classification) return;
		const key = `${classification.type}:${clean.toLowerCase()}`;
		if (dedupe.has(key)) return;
		dedupe.add(key);
		collected.push({
			fact: clean,
			fact_type: classification.type,
			confidence: classification.confidence,
			source
		});
	};

	for (const sentence of splitSentences(summary)) addLine(sentence, "summary");
	for (const kp of keyPoints) addLine(kp, "key_point");
	for (const thread of openThreads) addLine(thread, "open_thread");

	return collected.slice(0, maxFacts);
}


function toSafeToken(input: string, fallback: string): string {
	const sanitized = input
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 64);
	return sanitized || fallback;
}

function normalizeTaskPriority(value: unknown): TaskPriority | undefined {
	if (typeof value !== "string") return undefined;
	return TASK_PRIORITIES.includes(value as TaskPriority)
		? value as TaskPriority
		: undefined;
}

function normalizeRecallScope(value: unknown): RecallScope | undefined {
	if (typeof value !== "string") return undefined;
	return RECALL_SCOPES.includes(value as RecallScope)
		? value as RecallScope
		: undefined;
}

function parseRecallContracts(value: unknown): { contracts: RecallContract[]; error?: string } {
	if (value === undefined) return { contracts: [] };
	if (!Array.isArray(value)) return { contracts: [], error: "recall_contracts must be an array" };
	if (value.length > MAX_RECALL_CONTRACTS) {
		return { contracts: [], error: `recall_contracts too many items (max ${MAX_RECALL_CONTRACTS})` };
	}

	const contracts: RecallContract[] = [];
	for (let i = 0; i < value.length; i++) {
		const raw = value[i];
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return { contracts: [], error: `recall_contracts[${i}] must be an object` };
		}
		const obj = raw as Record<string, unknown>;
		const title = cleanText(obj.title);
		if (!title) return { contracts: [], error: `recall_contracts[${i}].title is required` };
		const recallAfter = parseOptionalPositiveInt(obj.recall_after_hours, MIN_RECALL_AFTER_HOURS, MAX_RECALL_AFTER_HOURS);
		if (recallAfter === undefined) {
			return { contracts: [], error: `recall_contracts[${i}].recall_after_hours must be an integer between ${MIN_RECALL_AFTER_HOURS} and ${MAX_RECALL_AFTER_HOURS}` };
		}
		const scope = normalizeRecallScope(obj.scope) ?? "task";
		const priority = normalizeTaskPriority(obj.priority) ?? "normal";
		const metadata = (obj.metadata && typeof obj.metadata === "object" && !Array.isArray(obj.metadata))
			? obj.metadata as Record<string, unknown>
			: {};
		const rawId = cleanText(obj.id) ?? `${title}-${i + 1}`;
		contracts.push({
			id: toSafeToken(rawId, `recall_${i + 1}`),
			title,
			note: cleanText(obj.note),
			recall_after_hours: recallAfter,
			scope,
			priority,
			linked_entity_ids: toStringArray(obj.linked_entity_ids),
			metadata
		});
	}

	return { contracts };
}

function truncateText(input: string, max = 120): string {
	const clean = input.trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max - 1)}…`;
}

function parseLetterLimit(value: unknown, fallback = DEFAULT_LETTER_LIST_LIMIT): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(MAX_LETTER_LIST_LIMIT, Math.max(1, Math.floor(value)));
}

function parsePreviewChars(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LETTER_PREVIEW_CHARS;
	return Math.min(MAX_LETTER_PREVIEW_CHARS, Math.max(40, Math.floor(value)));
}

function isCommitEligibleFact(fact: ExtractedFact, threshold: number): boolean {
	if (fact.confidence < threshold) return false;
	return fact.fact_type === "decision" || fact.fact_type === "deadline";
}

export const TOOL_DEFS = [
	{
		name: "mind_letter",
		description: "Write, list, get, search, or read letters. action=write sends a letter. action=list returns paginated summaries. action=get returns a single full letter by id. action=search runs keyword search across letters. action=read remains as backward-compatible unread fetch.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["write", "list", "get", "search", "read"],
					description: "write: send a letter. list: paginated summaries. get: full letter by id. search: keyword search. read: backward-compatible unread fetch."
				},
				// write params
				to_context: { type: "string", description: "[write] Recipient context (e.g., 'phone', 'future', 'desktop', 'chat')" },
				to: { type: "string", description: "[write] Recipient brain/tenant for cross-brain letters (e.g., 'rainer', 'companion')" },
				content: { type: "string", description: "[write] Letter content" },
				charges: { type: "array", items: { type: "string" }, description: "[write] Emotional charges" },
				letter_type: { type: "string", enum: ["personal", "handoff", "proposal"], description: "[write] Letter type — personal (default), handoff (task delegation), proposal (suggestion)" },
				// list/search/read params
				context: { type: "string", default: "chat", description: "[list/search/read] Which context to inspect" },
				unread_only: { type: "boolean", default: true, description: "[list/read] Only unread letters" },
				from: { type: "string", description: "[list/search] Filter by sender" },
				limit: { type: "number", default: DEFAULT_LETTER_LIST_LIMIT, description: "[list/search/read] Max results (1-50)" },
				cursor: { type: "string", description: "[list/search] Pagination cursor (letter id)" },
				preview_chars: { type: "number", default: DEFAULT_LETTER_PREVIEW_CHARS, description: "[list/search] Preview snippet length" },
				include_full_content: { type: "boolean", default: false, description: "[list/search] Include full content in each row (default false)" },
				// get params
				id: { type: "string", description: "[get] Letter id" },
				// search params
				query: { type: "string", description: "[search] Keyword query string" }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_context",
		description: "Set or get conversation context for cross-session continuity. action=set saves context. action=get retrieves last saved context. Optional productivity fact extraction can emit reviewable fact candidates.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["set", "get"],
					description: "set: save conversation context. get: retrieve last saved context."
				},
				// set params
				summary: { type: "string", description: "[set] Summary of what was discussed" },
				partner: { type: "string", description: "[set] Who this conversation was with", default: "partner" },
				key_points: { type: "array", items: { type: "string" }, description: "[set] Key points from the conversation" },
				emotional_state: { type: "string", description: "[set] Emotional state at end of conversation" },
				open_threads: { type: "array", items: { type: "string" }, description: "[set] Unresolved threads to pick up next time" },
				create_tasks: { type: "boolean", default: false, description: "[set] Auto-create tasks from open_threads" },
				extract_facts: { type: "boolean", default: false, description: "[set] Extract productivity fact candidates from summary/key_points/open_threads" },
				extraction_mode: { type: "string", enum: ["shadow", "write"], default: "shadow", description: "[set+extract_facts] shadow=preview only, write=persist fact_candidate observations in craft" },
				max_fact_candidates: { type: "number", description: "[set+extract_facts] Max extracted fact candidates (default 5, max 10)" },
				recall_contracts: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							title: { type: "string" },
							note: { type: "string" },
							recall_after_hours: { type: "number" },
							scope: { type: "string", enum: ["task", "proposal"] },
							priority: { type: "string", enum: ["burning", "high", "normal", "low", "someday"] },
							linked_entity_ids: { type: "array", items: { type: "string" } },
							metadata: { type: "object" }
						}
					},
					description: "[set] Optional recall contracts to prevent remember-to-remember drift"
				},
				auto_commit: { type: "boolean", default: false, description: "[set+extract_facts] If true, convert eligible fact candidates into reviewable commitment proposals" },
				commitment_mode: { type: "string", enum: ["shadow", "proposal"], default: "proposal", description: "[set+auto_commit] shadow=preview only, proposal=create fact_commitment proposals" },
				commitment_threshold: { type: "number", description: "[set+auto_commit] Minimum confidence for decision/deadline commitment bridge (default 0.82)" },
				commitment_project_entity_id: { type: "string", description: "[set+auto_commit] Optional project entity id to link generated commitments" }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_letter": {
			const action = args.action;

			if (action === "write") {
				if (!args.to_context || !args.content) {
					return { error: "to_context and content are required for action=write" };
				}
				if (typeof args.content !== "string") {
					return { error: "content must be a string" };
				}
				if (!args.content.trim()) {
					return { error: "content cannot be blank" };
				}
				if (args.content.length > MAX_LETTER_CONTENT_LENGTH) {
					return { error: `content too long (max ${MAX_LETTER_CONTENT_LENGTH} chars)` };
				}

				const letter: Letter = {
					id: generateId("letter"),
					from_context: args.to ? storage.getTenant() : "chat",
					to_context: args.to_context,
					content: args.content,
					timestamp: getTimestamp(),
					read: false,
					charges: toStringArray(args.charges),
					letter_type: args.letter_type || undefined
				};

					// Cross-brain delivery
					if (args.to) {
						const recipient = args.to as string;
						if (!ALLOWED_TENANTS.includes(recipient as any)) {
							return { error: `Unknown brain: ${recipient}. Known: ${ALLOWED_TENANTS.join(", ")}` };
						}
						// Rate limit: max 200 cross-tenant letters per day per sender
						const recipientStorage = storage.forTenant(recipient);
						const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
						const recentFromSenderCount = typeof recipientStorage.countLettersFromSince === "function"
							? await recipientStorage.countLettersFromSince(storage.getTenant(), oneDayAgo)
							: (await recipientStorage.readLetters()).filter(l => l.from_context === storage.getTenant() && l.timestamp > oneDayAgo).length;
						if (recentFromSenderCount >= 200) {
							return { error: "Daily cross-tenant letter limit reached (200/day)" };
						}
						await recipientStorage.appendLetter(letter);
					return { sent: true, id: letter.id, to_brain: recipient, to_context: args.to_context };
				}

				await storage.appendLetter(letter);
				return { sent: true, id: letter.id, to: args.to_context };
			}

			const recipientContext = args.context || "chat";
			if (action === "get") {
				if (!args.id || typeof args.id !== "string") return { error: "id is required for action=get" };
				let found = typeof storage.getLetterById === "function"
					? await storage.getLetterById(args.id, recipientContext)
					: null;
				if (!found) {
					const letters = await storage.readLetters();
					found = letters.find(letter => letter.id === args.id && letter.to_context === recipientContext) ?? null;
				}
				if (!found) return { error: "Letter not found", id: args.id };
				let targetLetter: Letter = found;

				// Mark as read when opened directly.
				if (!targetLetter.read) {
					if (typeof storage.markLettersRead === "function") {
						await storage.markLettersRead([targetLetter.id]);
					} else {
						const letters = await storage.readLetters();
						const idx = letters.findIndex(letter => letter.id === targetLetter.id);
						if (idx !== -1) {
							letters[idx].read = true;
							await storage.writeLetters(letters);
						}
					}
					targetLetter = { ...targetLetter, read: true };
				}

				return {
					found: true,
					letter: {
						id: targetLetter.id,
						from: targetLetter.from_context,
						to: targetLetter.to_context,
						content: targetLetter.content,
						timestamp: targetLetter.timestamp,
						read: true,
						charges: targetLetter.charges,
						letter_type: targetLetter.letter_type
					}
				};
			}

			if (action === "list" || action === "search") {
				const limit = parseLetterLimit(args.limit);
				const previewChars = parsePreviewChars(args.preview_chars);
				const includeFull = args.include_full_content === true;
				const from = typeof args.from === "string" && args.from.trim() ? args.from.trim() : undefined;
				const cursor = typeof args.cursor === "string" && args.cursor.trim() ? args.cursor.trim() : undefined;
				let query: string | undefined;
				if (action === "search") {
					if (typeof args.query !== "string" || !args.query.trim()) {
						return { error: "query is required for action=search" };
					}
					if (args.query.length > 2000) {
						return { error: "query too long (max 2000 chars)" };
					}
					query = args.query.trim();
				}

				if (typeof storage.listLettersPaged === "function") {
					const page = await storage.listLettersPaged({
						context: recipientContext,
						limit,
						cursor,
						unread_only: args.unread_only === true,
						from,
						query
					});

					return {
						context: recipientContext,
						action,
						count: page.letters.length,
						has_more: page.has_more,
						next_cursor: page.next_cursor,
						letters: page.letters.map(letter => ({
							id: letter.id,
							from: letter.from_context,
							to: letter.to_context,
							timestamp: letter.timestamp,
							read: letter.read,
							charges: letter.charges,
							letter_type: letter.letter_type,
							preview: truncateText(letter.content, previewChars),
							...(includeFull ? { content: letter.content } : {})
						}))
					};
				}

				const letters = await storage.readLetters();
				let relevant = letters
					.filter(letter => letter.to_context === recipientContext)
					.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
				if (args.unread_only === true) relevant = relevant.filter(letter => !letter.read);
				if (from) {
					const normalizedFrom = from.toLowerCase();
					relevant = relevant.filter(letter => letter.from_context.toLowerCase() === normalizedFrom);
				}
				if (query) {
					const normalizedQuery = normalizeLookupText(query);
					const queryTokens = normalizedQuery.split(" ").filter(Boolean);
					relevant = relevant.filter(letter => {
						const haystack = normalizeLookupText(`${letter.content} ${(letter.charges ?? []).join(" ")}`);
						if (haystack.includes(normalizedQuery)) return true;
						if (queryTokens.length === 0) return false;
						let matched = 0;
						for (const token of queryTokens) if (haystack.includes(token)) matched += 1;
						return matched >= Math.max(1, Math.ceil(queryTokens.length / 2));
					});
				}
				if (cursor) {
					const cursorIndex = relevant.findIndex(letter => letter.id === cursor);
					if (cursorIndex >= 0) relevant = relevant.slice(cursorIndex + 1);
				}

				const paged = relevant.slice(0, limit);
				const nextCursor = relevant.length > limit ? paged[paged.length - 1]?.id : null;

				return {
					context: recipientContext,
					action,
					count: paged.length,
					has_more: relevant.length > limit,
					next_cursor: nextCursor,
					letters: paged.map(letter => ({
						id: letter.id,
						from: letter.from_context,
						to: letter.to_context,
						timestamp: letter.timestamp,
						read: letter.read,
						charges: letter.charges,
						letter_type: letter.letter_type,
						preview: truncateText(letter.content, previewChars),
						...(includeFull ? { content: letter.content } : {})
					}))
				};
			}

			if (action === "read") {
				// Backward-compatible unread fetch, now bounded to avoid payload explosions.
				const limit = parseLetterLimit(args.limit);
				if (typeof storage.listLettersPaged === "function") {
					const page = await storage.listLettersPaged({
						context: recipientContext,
						limit,
						unread_only: args.unread_only !== false,
						from: typeof args.from === "string" && args.from.trim() ? args.from.trim() : undefined
					});
					const relevant = page.letters;

					if (relevant.length > 0) {
						if (typeof storage.markLettersRead === "function") {
							await storage.markLettersRead(relevant.map(letter => letter.id));
						} else {
							const letters = await storage.readLetters();
							for (const letter of relevant) {
								const idx = letters.findIndex(l => l.id === letter.id);
								if (idx !== -1) letters[idx].read = true;
							}
							await storage.writeLetters(letters);
						}
					}

					return {
						context: recipientContext,
						count: relevant.length,
						has_more: page.has_more,
						letters: relevant.map(letter => ({
							id: letter.id,
							from: letter.from_context,
							content: letter.content,
							timestamp: letter.timestamp,
							charges: letter.charges,
							letter_type: letter.letter_type
						}))
					};
				}

				const letters = await storage.readLetters();
				const byContext = letters
					.filter(letter => letter.to_context === recipientContext)
					.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
				let relevant = byContext;
				if (args.unread_only !== false) {
					relevant = relevant.filter(letter => !letter.read);
				}
				relevant = relevant.slice(0, limit);

				// Mark returned rows as read.
				if (relevant.length > 0) {
					for (const letter of relevant) {
						const idx = letters.findIndex(l => l.id === letter.id);
						if (idx !== -1) letters[idx].read = true;
					}
					await storage.writeLetters(letters);
				}

				return {
					context: recipientContext,
					count: relevant.length,
					has_more: byContext.length > relevant.length,
					letters: relevant.map(letter => ({
						id: letter.id,
						from: letter.from_context,
						content: letter.content,
						timestamp: letter.timestamp,
						charges: letter.charges,
						letter_type: letter.letter_type
					}))
				};
			}

			return { error: `Unknown action: ${action}. Must be write, list, get, search, or read.` };
		}

		case "mind_context": {
			const action = args.action;

			if (action === "set") {
				if (typeof args.summary !== "string") {
					return { error: "summary is required for action=set" };
				}
				if (args.summary.length > MAX_SUMMARY_LENGTH) {
					return { error: `summary too long (max ${MAX_SUMMARY_LENGTH} chars)` };
				}
				if (args.key_points !== undefined) {
					const kpArr = toStringArray(args.key_points);
					if (kpArr.length > MAX_ARRAY_ITEMS) {
						return { error: `key_points too many items (max ${MAX_ARRAY_ITEMS})` };
					}
					if (kpArr.some(item => item.length > MAX_ARRAY_ITEM_LENGTH)) {
						return { error: `key_points item too long (max ${MAX_ARRAY_ITEM_LENGTH} chars each)` };
					}
				}
				if (args.open_threads !== undefined) {
					const otArr = toStringArray(args.open_threads);
					if (otArr.length > MAX_ARRAY_ITEMS) {
						return { error: `open_threads too many items (max ${MAX_ARRAY_ITEMS})` };
					}
					if (otArr.some(item => item.length > MAX_ARRAY_ITEM_LENGTH)) {
						return { error: `open_threads item too long (max ${MAX_ARRAY_ITEM_LENGTH} chars each)` };
					}
				}
				if (!args.summary) {
					return { error: "summary is required for action=set" };
				}
				if (args.extract_facts !== undefined && typeof args.extract_facts !== "boolean") {
					return { error: "extract_facts must be a boolean" };
				}
				if (args.extraction_mode !== undefined && !["shadow", "write"].includes(args.extraction_mode)) {
					return { error: "extraction_mode must be shadow or write" };
				}
				const parsedMaxFacts = parseOptionalPositiveInt(args.max_fact_candidates, 1, MAX_FACT_CANDIDATES);
				if (args.max_fact_candidates !== undefined && parsedMaxFacts === undefined) {
					return { error: `max_fact_candidates must be an integer between 1 and ${MAX_FACT_CANDIDATES}` };
				}
				const parsedRecallContracts = parseRecallContracts(args.recall_contracts);
				if (parsedRecallContracts.error) {
					return { error: parsedRecallContracts.error };
				}
				if (args.auto_commit !== undefined && typeof args.auto_commit !== "boolean") {
					return { error: "auto_commit must be a boolean" };
				}
				if (args.auto_commit === true && args.extract_facts !== true) {
					return { error: "auto_commit requires extract_facts=true" };
				}
				if (args.commitment_mode !== undefined && !["shadow", "proposal"].includes(args.commitment_mode)) {
					return { error: "commitment_mode must be shadow or proposal" };
				}
				const commitmentThresholdRaw = args.commitment_threshold;
				const commitmentThreshold = commitmentThresholdRaw === undefined
					? 0.82
					: (typeof commitmentThresholdRaw === "number" && Number.isFinite(commitmentThresholdRaw) ? commitmentThresholdRaw : NaN);
				if (Number.isNaN(commitmentThreshold) || commitmentThreshold < 0 || commitmentThreshold > 1) {
					return { error: "commitment_threshold must be a number between 0 and 1" };
				}

				const context = {
					timestamp: getTimestamp(),
					summary: args.summary,
					partner: args.partner || "partner",
					key_points: toStringArray(args.key_points),
					emotional_state: args.emotional_state,
					open_threads: toStringArray(args.open_threads),
					recall_contracts: parsedRecallContracts.contracts
				};

				await storage.writeConversationContext(context);

				const response: Record<string, unknown> = {
					saved: true,
					timestamp: context.timestamp,
					note: "Context saved. Next session will know where we left off."
				};
				if (context.recall_contracts.length > 0) {
					response.recall_contracts_saved = context.recall_contracts.length;
					response.recall_contract_ids = context.recall_contracts.map(contract => contract.id);
				}

				if (args.create_tasks && context.open_threads.length > 0) {
					const validThreads = context.open_threads
						.map(thread => thread.trim())
						.filter(thread => thread.length > 0);
					const threadsForTasks = validThreads.slice(0, MAX_CONTEXT_OPEN_THREAD_TASKS);

					const tasks = [];
					for (const thread of threadsForTasks) {
						const task = await storage.createTask({
							title: thread,
							status: "open",
							priority: "normal",
							source: "mind_context",
							linked_observation_ids: [],
							linked_entity_ids: []
						});
						tasks.push(task);
					}
					response.tasks_created = tasks.length;
					response.task_ids = tasks.map(t => t.id);
					response.blank_threads_skipped = context.open_threads.length - validThreads.length;
					response.thread_limit_applied = Math.max(0, validThreads.length - threadsForTasks.length);
				}

				if (args.extract_facts === true) {
					const extractionMode = args.extraction_mode ?? "shadow";
					const maxFacts = parsedMaxFacts ?? 5;
					const factCandidates = extractProductivityFacts(
						context.summary,
						context.key_points,
						context.open_threads,
						maxFacts
					);

					const storedIds: string[] = [];
					const storedFacts: Array<{ fact: ExtractedFact; observation: Observation }> = [];
					if (extractionMode === "write" && factCandidates.length > 0) {
						const observations: Observation[] = [];
						for (const fact of factCandidates) {
							const cleanedContent = cleanText(fact.fact);
							if (!cleanedContent || cleanedContent.length > MAX_FACT_CONTENT_LENGTH) continue;
							const observation: Observation = {
								id: generateId("obs"),
								content: cleanedContent,
								territory: "craft",
								created: getTimestamp(),
								texture: {
									salience: "background",
									vividness: "soft",
									charge: [],
									grip: "dormant",
									charge_phase: "fresh"
								},
								context: `Auto-extracted productivity fact candidate (${fact.fact_type}) from ${fact.source}; confidence=${Math.round(fact.confidence * 100) / 100}`,
								access_count: 0,
								type: "fact_candidate",
								tags: ["fact-candidate", "auto-extracted", "productivity"]
							};
							observations.push(observation);
							storedFacts.push({ fact, observation });
							storedIds.push(observation.id);
						}
						await Promise.all(observations.map(obs => storage.appendToTerritory("craft", obs)));
					}

					response.fact_extraction = {
						mode: extractionMode,
						candidates: factCandidates,
						candidate_count: factCandidates.length,
						stored_count: storedIds.length,
						stored_ids: storedIds
					};

					if (args.auto_commit === true) {
						if (extractionMode !== "write") {
							return { error: "auto_commit requires extraction_mode=write for auditable provenance" };
						}
						const commitmentMode = args.commitment_mode ?? "proposal";
						const projectEntityId = cleanText(args.commitment_project_entity_id);
						const targetId = toSafeToken(projectEntityId ?? "fact_commitment_queue", "fact_commitment_queue");
						const eligible = storedFacts.filter(({ fact }) => isCommitEligibleFact(fact, commitmentThreshold));

						const suggestions = eligible.map(({ fact, observation }) => {
							const isDeadline = fact.fact_type === "deadline";
							const title = isDeadline
								? `Honor deadline: ${truncateText(fact.fact, 120)}`
								: `Follow through decision: ${truncateText(fact.fact, 120)}`;
							return {
								title,
								description: `Auto-derived from fact candidate ${observation.id} (${fact.fact_type}, confidence=${Math.round(fact.confidence * 100) / 100}).`,
								priority: isDeadline ? "high" : "normal",
								fact_type: fact.fact_type,
								confidence: fact.confidence,
								source_observation_id: observation.id
							};
						});

						const proposalIds: string[] = [];
						let skippedExisting = 0;

						if (commitmentMode === "proposal") {
							for (const suggestion of suggestions) {
								const exists = await storage.proposalExists("fact_commitment", suggestion.source_observation_id, targetId);
								if (exists) {
									skippedExisting++;
									continue;
								}
								const proposal = await storage.createProposal({
									tenant_id: storage.getTenant(),
									proposal_type: "fact_commitment",
									source_id: suggestion.source_observation_id,
									target_id: targetId,
									confidence: Math.min(0.95, Math.round((Math.min(suggestion.confidence, 0.87) + 0.08) * 100) / 100),
									rationale: `Fact→commitment bridge (${suggestion.fact_type})`,
									metadata: {
										title: suggestion.title,
										description: suggestion.description,
										priority: suggestion.priority,
										source: "fact_commitment_bridge",
										linked_observation_ids: [suggestion.source_observation_id],
										linked_entity_ids: projectEntityId ? [projectEntityId] : [],
										fact_type: suggestion.fact_type,
										confidence: suggestion.confidence
									},
									status: "pending"
								});
								proposalIds.push(proposal.id);
							}
						}

						response.commitment_bridge = {
							enabled: true,
							mode: commitmentMode,
							threshold: commitmentThreshold,
							eligible_count: suggestions.length,
							proposal_count: proposalIds.length,
							skipped_existing: skippedExisting,
							proposal_ids: proposalIds,
							suggestions
						};
					}
				}

				return response;
			}

			if (action === "get") {
				const context = await storage.readConversationContext();

				if (!context) {
					return {
						has_context: false,
						note: "No previous conversation context saved."
					};
				}

				return {
					has_context: true,
					...(context as Record<string, unknown>)
				};
			}

			return { error: `Unknown action: ${action}. Must be set or get.` };
		}

		default:
			throw new Error(`Unknown comms tool: ${name}`);
	}
}
