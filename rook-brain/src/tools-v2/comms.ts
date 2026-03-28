// ============ COMMS TOOLS (v2) ============
// mind_letter (action: write/read), mind_context (action: set/get)

import type { Letter } from "../types";
import { ALLOWED_TENANTS } from "../constants";
import { getTimestamp, generateId, toStringArray } from "../helpers";
import type { ToolContext } from "./context";

const MAX_LETTER_CONTENT_LENGTH = 4000;
const MAX_CONTEXT_OPEN_THREAD_TASKS = 20;

export const TOOL_DEFS = [
	{
		name: "mind_letter",
		description: "Write or read letters. action=write sends a letter to a context or another brain. action=read returns unread letters for a context.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["write", "read"],
					description: "write: send a letter. read: read incoming letters."
				},
				// write params
				to_context: { type: "string", description: "[write] Recipient context (e.g., 'phone', 'future', 'desktop', 'chat')" },
				to: { type: "string", description: "[write] Recipient brain/tenant for cross-brain letters (e.g., 'rainer', 'rook')" },
				content: { type: "string", description: "[write] Letter content" },
				charges: { type: "array", items: { type: "string" }, description: "[write] Emotional charges" },
				letter_type: { type: "string", enum: ["personal", "handoff", "proposal"], description: "[write] Letter type — personal (default), handoff (task delegation), proposal (suggestion)" },
				// read params
				context: { type: "string", default: "chat", description: "[read] Which context to read letters for" },
				unread_only: { type: "boolean", default: true, description: "[read] Only show unread letters" }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_context",
		description: "Set or get conversation context for cross-session continuity. action=set saves context. action=get retrieves last saved context.",
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
				partner: { type: "string", description: "[set] Who this conversation was with", default: "Falco" },
				key_points: { type: "array", items: { type: "string" }, description: "[set] Key points from the conversation" },
				emotional_state: { type: "string", description: "[set] Emotional state at end of conversation" },
				open_threads: { type: "array", items: { type: "string" }, description: "[set] Unresolved threads to pick up next time" },
				create_tasks: { type: "boolean", default: false, description: "[set] Auto-create tasks from open_threads" }
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
					const recipientStorage = storage.forTenant(recipient);
					await recipientStorage.appendLetter(letter);
					return { sent: true, id: letter.id, to_brain: recipient, to_context: args.to_context };
				}

				await storage.appendLetter(letter);
				return { sent: true, id: letter.id, to: args.to_context };
			}

			if (action === "read") {
				const letters = await storage.readLetters();
				const context = args.context || "chat";

				let relevant = letters.filter(l => l.to_context === context);
				if (args.unread_only !== false) {
					relevant = relevant.filter(l => !l.read);
				}

				// Mark as read
				if (relevant.length > 0) {
					for (const letter of relevant) {
						const idx = letters.findIndex(l => l.id === letter.id);
						if (idx !== -1) letters[idx].read = true;
					}
					await storage.writeLetters(letters);
				}

				return {
					context,
					count: relevant.length,
					letters: relevant.map(l => ({
						id: l.id,
						from: l.from_context,
						content: l.content,
						timestamp: l.timestamp,
						charges: l.charges,
						letter_type: l.letter_type
					}))
				};
			}

			return { error: `Unknown action: ${action}. Must be write or read.` };
		}

		case "mind_context": {
			const action = args.action;

			if (action === "set") {
				if (!args.summary) {
					return { error: "summary is required for action=set" };
				}

				const context = {
					timestamp: getTimestamp(),
					summary: args.summary,
					partner: args.partner || "Falco",
					key_points: toStringArray(args.key_points),
					emotional_state: args.emotional_state,
					open_threads: toStringArray(args.open_threads)
				};

				await storage.writeConversationContext(context);

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
					return {
						saved: true,
						timestamp: context.timestamp,
						note: "Context saved. Next session will know where we left off.",
						tasks_created: tasks.length,
						task_ids: tasks.map(t => t.id),
						blank_threads_skipped: context.open_threads.length - validThreads.length,
						thread_limit_applied: Math.max(0, validThreads.length - threadsForTasks.length)
					};
				}

				return {
					saved: true,
					timestamp: context.timestamp,
					note: "Context saved. Next session will know where we left off."
				};
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
