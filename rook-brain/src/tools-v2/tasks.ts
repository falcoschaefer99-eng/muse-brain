// ============ TASKS TOOL (v2) ============
// mind_task — create, list, get, update, and complete tasks.
// Cross-tenant delegation and scheduled wake support.

import type { Task, Letter } from "../types";
import { ALLOWED_TENANTS } from "../constants";
import { getTimestamp, generateId, toStringArray } from "../helpers";
import type { ToolContext } from "./context";

const TASK_STATUSES = ["open", "scheduled", "in_progress", "done", "deferred", "cancelled"] as const;
const TASK_PRIORITIES = ["burning", "high", "normal", "low", "someday"] as const;

const MAX_TASK_TITLE_LENGTH = 200;
const MAX_TASK_DESCRIPTION_LENGTH = 4000;
const MAX_TASK_SOURCE_LENGTH = 120;
const MAX_TASK_ESTIMATED_EFFORT_LENGTH = 120;
const MAX_TASK_COMPLETION_NOTE_LENGTH = 2000;

export const TOOL_DEFS = [
	{
		name: "mind_task",
		description: "Manage tasks. action=create creates a task. action=list lists tasks with optional filters. action=get fetches a single task. action=update modifies a task. action=complete marks a task done.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["create", "list", "get", "update", "complete"],
					description: "create: new task. list: list tasks. get: single task by id. update: modify task fields. complete: mark done."
				},
				// create params
				title: { type: "string", description: "[create/update] Task title" },
				description: { type: "string", description: "[create/update] Task description" },
				priority: {
					type: "string",
					enum: ["burning", "high", "normal", "low", "someday"],
					description: "[create/update] Task priority (default: normal)"
				},
				assigned_tenant: { type: "string", description: "[create] Cross-tenant delegation — assign this task to another tenant" },
				scheduled_wake: { type: "string", description: "[create/update] ISO timestamp for self-scheduling" },
				source: { type: "string", description: "[create] Where this task came from" },
				linked_observation_ids: { type: "array", items: { type: "string" }, description: "[create] Observation IDs to link" },
				linked_entity_ids: { type: "array", items: { type: "string" }, description: "[create] Entity IDs to link" },
				depends_on: { type: "array", items: { type: "string" }, description: "[create] Task IDs this task depends on" },
				estimated_effort: { type: "string", description: "[create/update] Effort estimate (e.g., '2h', '1d')" },
				// list params
				status: {
					type: "string",
					enum: ["open", "scheduled", "in_progress", "done", "deferred", "cancelled"],
					description: "[list] Filter by status"
				},
				assigned: { type: "boolean", description: "[list] If true, show tasks assigned TO this tenant from others" },
				limit: { type: "number", description: "[list] Max results (default 20)" },
				// get/update/complete params
				id: { type: "string", description: "[get/update/complete] Task ID" },
				// update params
				completion_note: { type: "string", description: "[update/complete] Note on how or why the task was completed" }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_task": {
			const action = args.action;
			const storage = context.storage;

			switch (action) {
				case "create": {
					if (!args.title?.trim()) return { error: "title is required for action=create" };
					const title = args.title.trim();
					if (title.length > MAX_TASK_TITLE_LENGTH) {
						return { error: `title too long (max ${MAX_TASK_TITLE_LENGTH} chars)` };
					}
					const scheduledWakeResult = normalizeScheduledWake(args.scheduled_wake);
					if (scheduledWakeResult.error) return { error: scheduledWakeResult.error };
					const scheduledWake = scheduledWakeResult.value;
					if (args.priority !== undefined && !normalizeTaskPriority(args.priority)) {
						return { error: `priority must be one of: ${TASK_PRIORITIES.join(", ")}` };
					}

					const descriptionLengthError = validateTextLength("description", args.description, MAX_TASK_DESCRIPTION_LENGTH);
					if (descriptionLengthError) return { error: descriptionLengthError };
					const sourceLengthError = validateTextLength("source", args.source, MAX_TASK_SOURCE_LENGTH);
					if (sourceLengthError) return { error: sourceLengthError };
					const effortLengthError = validateTextLength("estimated_effort", args.estimated_effort, MAX_TASK_ESTIMATED_EFFORT_LENGTH);
					if (effortLengthError) return { error: effortLengthError };

					if (args.assigned_tenant && !ALLOWED_TENANTS.includes(args.assigned_tenant as any)) {
						return { error: `Unknown tenant: ${args.assigned_tenant}. Known: ${ALLOWED_TENANTS.join(", ")}` };
					}

					const currentTenant = typeof storage.getTenant === "function" ? storage.getTenant() : undefined;
					if (args.assigned_tenant && currentTenant && args.assigned_tenant === currentTenant) {
						return { error: "assigned_tenant cannot be the current tenant" };
					}

					const task = await storage.createTask({
						title,
						description: args.description,
						status: scheduledWake ? "scheduled" : "open",
						priority: normalizeTaskPriority(args.priority) ?? "normal",
						assigned_tenant: args.assigned_tenant,
						scheduled_wake: scheduledWake,
						source: args.source,
						linked_observation_ids: toStringArray(args.linked_observation_ids),
						linked_entity_ids: toStringArray(args.linked_entity_ids),
						depends_on: args.depends_on ? toStringArray(args.depends_on) : undefined,
						estimated_effort: args.estimated_effort
					});

					return { created: true, task };
				}

				case "list": {
					if (args.status !== undefined && !normalizeTaskStatus(args.status)) {
						return { error: `status must be one of: ${TASK_STATUSES.join(", ")}` };
					}
					if (args.priority !== undefined && !normalizeTaskPriority(args.priority)) {
						return { error: `priority must be one of: ${TASK_PRIORITIES.join(", ")}` };
					}

					const tasks = await storage.listTasks(
						normalizeTaskStatus(args.status),
						normalizeTaskPriority(args.priority),
						args.limit ?? 20,
						args.assigned === true
					);
					return { tasks, count: tasks.length };
				}

				case "get": {
					if (!args.id) return { error: "id is required for action=get" };

					const task = await storage.getTask(args.id, true);
					if (!task) return { error: `Task not found: ${args.id}` };

					return { task };
				}

				case "update": {
					if (!args.id) return { error: "id is required for action=update" };
					const existing = await storage.getTask(args.id, true);
					if (!existing) return { error: `Task not found: ${args.id}` };
					const isAssignedTask = isAssignedTaskForCurrentTenant(existing, storage.getTenant());
					if (args.title !== undefined && !args.title.trim()) {
						return { error: "title cannot be empty" };
					}
					if (args.title !== undefined && args.title.trim().length > MAX_TASK_TITLE_LENGTH) {
						return { error: `title too long (max ${MAX_TASK_TITLE_LENGTH} chars)` };
					}
					if (args.status !== undefined && !normalizeTaskStatus(args.status)) {
						return { error: `status must be one of: ${TASK_STATUSES.join(", ")}` };
					}
					if (args.priority !== undefined && !normalizeTaskPriority(args.priority)) {
						return { error: `priority must be one of: ${TASK_PRIORITIES.join(", ")}` };
					}
					const descriptionLengthError = validateTextLength("description", args.description, MAX_TASK_DESCRIPTION_LENGTH);
					if (descriptionLengthError) return { error: descriptionLengthError };
					const effortLengthError = validateTextLength("estimated_effort", args.estimated_effort, MAX_TASK_ESTIMATED_EFFORT_LENGTH);
					if (effortLengthError) return { error: effortLengthError };
					const completionNoteLengthError = validateTextLength("completion_note", args.completion_note, MAX_TASK_COMPLETION_NOTE_LENGTH);
					if (completionNoteLengthError) return { error: completionNoteLengthError };

					const scheduledWakeResult = normalizeScheduledWake(args.scheduled_wake);
					if (scheduledWakeResult.error) return { error: scheduledWakeResult.error };
					const scheduledWake = args.scheduled_wake !== undefined ? scheduledWakeResult.value : undefined;
					const effectiveScheduledWake = args.scheduled_wake !== undefined
						? scheduledWake
						: existing.scheduled_wake;
					if (args.status === "scheduled" && !isValidScheduledWake(effectiveScheduledWake)) {
						return { error: "scheduled_wake is required and must be a valid timestamp when status is scheduled" };
					}

					if (isAssignedTask) {
						const forbiddenFields = [
							"title",
							"description",
							"priority",
							"estimated_effort",
							"scheduled_wake"
						].filter(field => args[field] !== undefined);

						if (forbiddenFields.length > 0) {
							return { error: `Delegated task assignees cannot update ${forbiddenFields.join(", ")}.` };
						}

						if (args.completion_note !== undefined || args.status === "done") {
							return { error: "Use action=complete to finish a delegated task and notify the assigning tenant." };
						}
					}

					const updates: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "estimated_effort" | "scheduled_wake" | "completion_note" | "completed_at">> = {};
					if (args.title !== undefined) updates.title = args.title.trim();
					if (args.description !== undefined) updates.description = args.description;
					if (args.status !== undefined) updates.status = normalizeTaskStatus(args.status);
					if (args.priority !== undefined) updates.priority = normalizeTaskPriority(args.priority);
					if (args.estimated_effort !== undefined) updates.estimated_effort = args.estimated_effort;
					if (args.scheduled_wake !== undefined) updates.scheduled_wake = scheduledWake;
					if (args.completion_note !== undefined) updates.completion_note = args.completion_note;

					if (Object.keys(updates).length === 0) return { error: "No fields to update" };

					try {
						const updated = await storage.updateTask(args.id, updates, isAssignedTask);
						return { updated: true, task: updated };
					} catch (err) {
						return { error: err instanceof Error ? err.message : "Failed to update task" };
					}
				}

				case "complete": {
					if (!args.id) return { error: "id is required for action=complete" };
					const completionNoteLengthError = validateTextLength("completion_note", args.completion_note, MAX_TASK_COMPLETION_NOTE_LENGTH);
					if (completionNoteLengthError) return { error: completionNoteLengthError };

					const existing = await storage.getTask(args.id, true);
					if (!existing) return { error: `Task not found: ${args.id}` };
					const isAssignedTask = isAssignedTaskForCurrentTenant(existing, storage.getTenant());

					const updated = await storage.updateTask(args.id, {
						status: "done",
						completion_note: args.completion_note,
						completed_at: getTimestamp()
					}, isAssignedTask);

					// If we're the assignee completing a cross-tenant task, notify the assigner
					if (isAssignedTask) {
						const recipientStorage = storage.forTenant(existing.tenant_id);
						const letter: Letter = {
							id: generateId("letter"),
							from_context: storage.getTenant(),
							to_context: "chat",
							content: `Task completed: "${existing.title}"${args.completion_note ? ` — ${args.completion_note}` : ""}`,
							timestamp: getTimestamp(),
							read: false,
							charges: [],
							letter_type: "handoff"
						};
						try {
							await recipientStorage.appendLetter(letter);
							return { completed: true, task: updated, notified: existing.tenant_id };
						} catch (err) {
							return {
								completed: true,
								task: updated,
								notification_target: existing.tenant_id,
								notification_error: err instanceof Error ? err.message : "Failed to send completion notification"
							};
						}
					}

					return { completed: true, task: updated };
				}

				default:
					return { error: `Unknown action: ${action}. Must be create, list, get, update, or complete.` };
			}
		}

		default:
			throw new Error(`Unknown tasks tool: ${name}`);
	}
}

function isAssignedTaskForCurrentTenant(task: Task, tenant: string): boolean {
	return task.assigned_tenant === tenant && task.tenant_id !== tenant;
}

function validateTextLength(field: string, value: unknown, maxLength: number): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") return `${field} must be a string`;
	if (value.length > maxLength) return `${field} too long (max ${maxLength} chars)`;
	return undefined;
}

function normalizeScheduledWake(value: unknown): { value?: string; error?: string } {
	if (value === undefined) return {};
	if (typeof value !== "string") return { error: "scheduled_wake must be a string" };

	const trimmed = value.trim();
	if (!trimmed) return { error: "scheduled_wake cannot be blank" };

	const timestamp = new Date(trimmed);
	if (Number.isNaN(timestamp.getTime())) {
		return { error: "scheduled_wake must be a valid timestamp" };
	}

	return { value: timestamp.toISOString() };
}

function isValidScheduledWake(value?: string): boolean {
	if (!value) return false;
	return !Number.isNaN(new Date(value).getTime());
}

function normalizeTaskStatus(value: unknown): Task["status"] | undefined {
	if (typeof value !== "string") return undefined;
	return TASK_STATUSES.includes(value as Task["status"]) ? value as Task["status"] : undefined;
}

function normalizeTaskPriority(value: unknown): Task["priority"] | undefined {
	if (typeof value !== "string") return undefined;
	return TASK_PRIORITIES.includes(value as Task["priority"]) ? value as Task["priority"] : undefined;
}
