import { describe, expect, it, vi } from 'vitest';
import { handleTool as handleTaskTool } from '../src/tools-v2/tasks';
import { handleTool as handleCommsTool } from '../src/tools-v2/comms';
import { runTaskSchedulingTask } from '../src/daemon/tasks/task-scheduling';
import type { Task, Entity, ProjectDossier } from '../src/types';

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: overrides.id ?? 'task_test',
		tenant_id: overrides.tenant_id ?? 'rainer',
		assigned_tenant: overrides.assigned_tenant,
		title: overrides.title ?? 'Test task',
		description: overrides.description,
		status: overrides.status ?? 'open',
		priority: overrides.priority ?? 'normal',
		estimated_effort: overrides.estimated_effort,
		scheduled_wake: overrides.scheduled_wake,
		source: overrides.source,
		linked_observation_ids: overrides.linked_observation_ids ?? [],
		linked_entity_ids: overrides.linked_entity_ids ?? [],
		depends_on: overrides.depends_on,
		completion_note: overrides.completion_note,
		created_at: overrides.created_at ?? '2026-03-26T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-03-26T00:00:00.000Z',
		completed_at: overrides.completed_at
	};
}

function makeProjectEntity(overrides: Partial<Entity> = {}): Entity {
	return {
		id: overrides.id ?? 'ent_project',
		tenant_id: overrides.tenant_id ?? 'rainer',
		name: overrides.name ?? 'Brain Surgery',
		entity_type: overrides.entity_type ?? 'project',
		tags: overrides.tags ?? ['brain'],
		salience: overrides.salience ?? 'active',
		primary_context: overrides.primary_context,
		created_at: overrides.created_at ?? '2026-03-26T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-03-26T00:00:00.000Z'
	};
}

function makeProjectDossier(overrides: Partial<ProjectDossier> = {}): ProjectDossier {
	return {
		id: overrides.id ?? 'dossier_project',
		tenant_id: overrides.tenant_id ?? 'rainer',
		project_entity_id: overrides.project_entity_id ?? 'ent_project',
		lifecycle_status: overrides.lifecycle_status ?? 'active',
		summary: overrides.summary ?? 'Make the brain less forgetful.',
		goals: overrides.goals ?? ['ship receipts'],
		constraints: overrides.constraints ?? [],
		decisions: overrides.decisions ?? [],
		open_questions: overrides.open_questions ?? [],
		next_actions: overrides.next_actions ?? [],
		metadata: overrides.metadata ?? {},
		last_active_at: overrides.last_active_at ?? '2026-03-26T00:00:00.000Z',
		created_at: overrides.created_at ?? '2026-03-26T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-03-26T00:00:00.000Z'
	};
}

describe('tasks v2 tool', () => {
	it('creates scheduled tasks when scheduled_wake is provided', async () => {
		const createTask = vi.fn(async (task: Omit<Task, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => makeTask(task));
		const storage = {
			createTask
		};

		const result = await handleTaskTool('mind_task', {
			action: 'create',
			title: '  Follow up with Companion  ',
			scheduled_wake: '2026-03-27T10:00:00.000Z'
		}, { storage: storage as any });

		expect(result.created).toBe(true);
		expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Follow up with Companion',
			status: 'scheduled',
			scheduled_wake: '2026-03-27T10:00:00.000Z'
		}));
	});

	it('blocks self-delegation on create', async () => {
		const createTask = vi.fn();
		const storage = {
			getTenant: () => 'rainer',
			createTask
		};

		const result = await handleTaskTool('mind_task', {
			action: 'create',
			title: 'Delegate to self',
			assigned_tenant: 'rainer'
		}, { storage: storage as any });

		expect(result.error).toMatch(/assigned_tenant cannot be the current tenant/i);
		expect(createTask).not.toHaveBeenCalled();
	});

	it('rejects overlong task titles on create', async () => {
		const createTask = vi.fn();
		const storage = { createTask };

		const result = await handleTaskTool('mind_task', {
			action: 'create',
			title: 'x'.repeat(201)
		}, { storage: storage as any });

		expect(result.error).toMatch(/title too long/i);
		expect(createTask).not.toHaveBeenCalled();
	});

	it('rejects invalid scheduled wake timestamps on create', async () => {
		const createTask = vi.fn();
		const storage = {
			createTask
		};

		const result = await handleTaskTool('mind_task', {
			action: 'create',
			title: 'Bad schedule',
			scheduled_wake: 'not-a-date'
		}, { storage: storage as any });

		expect(result.error).toMatch(/scheduled_wake must be a valid timestamp/);
		expect(createTask).not.toHaveBeenCalled();
	});

	it('rejects invalid priority values before hitting storage', async () => {
		const createTask = vi.fn();
		const storage = {
			createTask
		};

		const result = await handleTaskTool('mind_task', {
			action: 'create',
			title: 'Bad priority',
			priority: 'urgent'
		}, { storage: storage as any });

		expect(result.error).toMatch(/priority must be one of/);
		expect(createTask).not.toHaveBeenCalled();
	});

	it('allows an assignee to complete a delegated task and notifies the assigner', async () => {
		const appendLetter = vi.fn(async () => undefined);
		const getTask = vi.fn(async () => makeTask({
			id: 'task_cross_tenant',
			tenant_id: 'companion',
			assigned_tenant: 'rainer',
			title: 'Audit the daemon'
		}));
		const updateTask = vi.fn(async (id: string, updates: Partial<Task>, includeAssigned?: boolean) => makeTask({
			id,
			tenant_id: 'companion',
			assigned_tenant: 'rainer',
			title: 'Audit the daemon',
			status: (updates.status as Task['status']) ?? 'done',
			completion_note: updates.completion_note,
			completed_at: updates.completed_at
		}));
		const storage = {
			getTenant: () => 'rainer',
			getTask,
			updateTask,
			forTenant: () => ({ appendLetter })
		};

		const result = await handleTaskTool('mind_task', {
			action: 'complete',
			id: 'task_cross_tenant',
			completion_note: 'Done and dusted.'
		}, { storage: storage as any });

		expect(getTask).toHaveBeenCalledWith('task_cross_tenant', true);
		expect(updateTask).toHaveBeenCalledWith(
			'task_cross_tenant',
			expect.objectContaining({ status: 'done', completion_note: 'Done and dusted.' }),
			true
		);
		expect(appendLetter).toHaveBeenCalledTimes(1);
		expect(result.completed).toBe(true);
		expect(result.notified).toBe('companion');
	});

	it('blocks assignees from editing delegated task metadata directly', async () => {
		const updateTask = vi.fn();
		const storage = {
			getTenant: () => 'rainer',
			getTask: vi.fn(async () => makeTask({
				id: 'task_cross_tenant',
				tenant_id: 'companion',
				assigned_tenant: 'rainer'
			})),
			updateTask
		};

		const result = await handleTaskTool('mind_task', {
			action: 'update',
			id: 'task_cross_tenant',
			title: 'New title'
		}, { storage: storage as any });

		expect(result.error).toMatch(/Delegated task assignees cannot update title/);
		expect(updateTask).not.toHaveBeenCalled();
	});

	it('requires a scheduled wake when moving a task into scheduled status', async () => {
		const storage = {
			getTenant: () => 'rainer',
			getTask: vi.fn(async () => makeTask({
				id: 'task_scheduled',
				tenant_id: 'rainer',
				scheduled_wake: undefined
			})),
			updateTask: vi.fn()
		};

		const result = await handleTaskTool('mind_task', {
			action: 'update',
			id: 'task_scheduled',
			status: 'scheduled'
		}, { storage: storage as any });

		expect(result.error).toMatch(/scheduled_wake is required/);
		expect(storage.updateTask).not.toHaveBeenCalled();
	});

	it('rejects invalid status values on update before hitting storage', async () => {
		const storage = {
			getTenant: () => 'rainer',
			getTask: vi.fn(async () => makeTask()),
			updateTask: vi.fn()
		};

		const result = await handleTaskTool('mind_task', {
			action: 'update',
			id: 'task_test',
			status: 'blocked'
		}, { storage: storage as any });

		expect(result.error).toMatch(/status must be one of/);
		expect(storage.updateTask).not.toHaveBeenCalled();
	});

	it('rejects empty titles on update', async () => {
		const storage = {
			getTenant: () => 'rainer',
			getTask: vi.fn(async () => makeTask()),
			updateTask: vi.fn()
		};

		const result = await handleTaskTool('mind_task', {
			action: 'update',
			id: 'task_test',
			title: '   '
		}, { storage: storage as any });

		expect(result.error).toMatch(/title cannot be empty/);
		expect(storage.updateTask).not.toHaveBeenCalled();
	});

	it('rejects overlong completion notes before complete', async () => {
		const storage = {
			getTenant: () => 'rainer',
			getTask: vi.fn(),
			updateTask: vi.fn()
		};

		const result = await handleTaskTool('mind_task', {
			action: 'complete',
			id: 'task_test',
			completion_note: 'x'.repeat(2001)
		}, { storage: storage as any });

		expect(result.error).toMatch(/completion_note too long/i);
		expect(storage.getTask).not.toHaveBeenCalled();
		expect(storage.updateTask).not.toHaveBeenCalled();
	});

	it('treats delegated completion notifications as best-effort', async () => {
		const getTask = vi.fn(async () => makeTask({
			id: 'task_cross_tenant',
			tenant_id: 'companion',
			assigned_tenant: 'rainer',
			title: 'Audit the daemon'
		}));
		const updateTask = vi.fn(async (id: string, updates: Partial<Task>) => makeTask({
			id,
			tenant_id: 'companion',
			assigned_tenant: 'rainer',
			title: 'Audit the daemon',
			status: (updates.status as Task['status']) ?? 'done',
			completion_note: updates.completion_note,
			completed_at: updates.completed_at
		}));
		const storage = {
			getTenant: () => 'rainer',
			getTask,
			updateTask,
			forTenant: () => ({
				appendLetter: vi.fn(async () => {
					throw new Error('letter delivery failed');
				})
			})
		};

		const result = await handleTaskTool('mind_task', {
			action: 'complete',
			id: 'task_cross_tenant',
			completion_note: 'Done and dusted.'
		}, { storage: storage as any });

		expect(result.completed).toBe(true);
		expect(result.notification_target).toBe('companion');
		expect(result.notification_error).toMatch(/letter delivery failed/);
	});

	it('creates dual tasks with executor and reviewer wiring', async () => {
		let counter = 0;
		const createTask = vi.fn(async (task: Omit<Task, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => {
			counter += 1;
			return makeTask({ id: `task_${counter}`, ...task });
		});
		const storage = {
			getTenant: () => 'rainer',
			createTask
		};

		const result = await handleTaskTool('mind_task', {
			action: 'create_dual',
			title: 'Draft the business proposition',
			description: 'Write the first pass, then have Companion review it.',
			assigned_tenant: 'companion',
			priority: 'high'
		}, { storage: storage as any });

		expect(result.created).toBe(true);
		expect(result.dual).toBe(true);
		expect(createTask).toHaveBeenCalledTimes(2);
		expect(createTask.mock.calls[0][0]).toEqual(expect.objectContaining({
			title: 'Draft the business proposition',
			status: 'open',
			priority: 'high'
		}));
		expect(createTask.mock.calls[0][0]).not.toHaveProperty('assigned_tenant');
		expect(createTask.mock.calls[1][0]).toEqual(expect.objectContaining({
			title: 'Review: Draft the business proposition',
			assigned_tenant: 'companion',
			depends_on: ['task_1']
		}));
		expect(result.executor_task.id).toBe('task_1');
		expect(result.reviewer_task.id).toBe('task_2');
	});

	it('appends artifact paths to delegated completion notes and handoff letters', async () => {
		const appendLetter = vi.fn(async () => undefined);
		const getTask = vi.fn(async () => makeTask({
			id: 'task_cross_tenant',
			tenant_id: 'companion',
			assigned_tenant: 'rainer',
			title: 'Draft the proposition'
		}));
		const updateTask = vi.fn(async (id: string, updates: Partial<Task>, includeAssigned?: boolean) => makeTask({
			id,
			tenant_id: 'companion',
			assigned_tenant: 'rainer',
			title: 'Draft the proposition',
			status: (updates.status as Task['status']) ?? 'done',
			completion_note: updates.completion_note,
			completed_at: updates.completed_at
		}));
		const storage = {
			getTenant: () => 'rainer',
			getTask,
			updateTask,
			forTenant: () => ({ appendLetter })
		};

		const result = await handleTaskTool('mind_task', {
			action: 'complete',
			id: 'task_cross_tenant',
			completion_note: 'Draft complete.',
			artifact_path: '/tmp/shared/proposition.md'
		}, { storage: storage as any });

		expect(updateTask).toHaveBeenCalledWith(
			'task_cross_tenant',
			expect.objectContaining({
				status: 'done',
				completion_note: 'Draft complete.\nArtifact path: /tmp/shared/proposition.md'
			}),
			true
		);
		expect(appendLetter).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringContaining('Artifact path: /tmp/shared/proposition.md')
		}));
		expect(result.completed).toBe(true);
	});

	it('emits a structured artifact receipt for project-linked task completions', async () => {
		const project = makeProjectEntity({ id: 'ent_project', name: 'Dupin Service' });
		const dossier = makeProjectDossier({
			project_entity_id: project.id,
			metadata: {
				workspace_routing: {
					repo_slug: 'dupin-service',
					canonical_repo_url: 'git@github.com:funkatorium/dupin-service.git',
					default_branch: 'main',
					local_paths: ['/Users/falco/AI/rainer-workspace/dupin-service'],
					artifact_roots: ['/Users/falco/AI/rainer-workspace/dupin-service/dist'],
					deploy: {
						commands: ['npm run deploy']
					},
					test_commands: ['npm test']
				}
			}
		});
		const appendToTerritory = vi.fn(async () => undefined);
		const getTask = vi.fn(async () => makeTask({
			id: 'task_project_receipt',
			title: 'Ship the worker bundle',
			tenant_id: 'rainer',
			linked_entity_ids: [project.id]
		}));
		const updateTask = vi.fn(async (id: string, updates: Partial<Task>) => makeTask({
			id,
			title: 'Ship the worker bundle',
			tenant_id: 'rainer',
			linked_entity_ids: [project.id],
			status: (updates.status as Task['status']) ?? 'done',
			completion_note: updates.completion_note,
			completed_at: updates.completed_at
		}));
		const storage = {
			getTenant: () => 'rainer',
			getTask,
			updateTask,
			findEntityById: vi.fn(async (id: string) => id === project.id ? project : null),
			getProjectDossier: vi.fn(async (id: string) => id === project.id ? dossier : null),
			appendToTerritory,
			listTasks: vi.fn(async () => [])
		};

		const result = await handleTaskTool('mind_task', {
			action: 'complete',
			id: 'task_project_receipt',
			completion_note: 'Bundle shipped.',
			artifact_path: '/Users/falco/AI/rainer-workspace/dupin-service/dist/index.js'
		}, { storage: storage as any });

		expect(result.completed).toBe(true);
		expect(result.artifact_receipt).toEqual(expect.objectContaining({
			type: 'artifact_receipt',
			entity_id: project.id,
			tags: expect.arrayContaining(['receipt', 'artifact-receipt', 'dupin-service']),
			context: expect.stringContaining('artifact_path=/Users/falco/AI/rainer-workspace/dupin-service/dist/index.js'),
			content: expect.stringContaining('repo_slug: dupin-service')
		}));
		expect(result.artifact_receipt.content).toContain('artifact_path: /Users/falco/AI/rainer-workspace/dupin-service/dist/index.js');
		expect(result.artifact_receipt.content).toContain('deploy_command: npm run deploy');
		expect(result.artifact_receipt.content).toContain('test_command: npm test');
		expect(appendToTerritory).toHaveBeenCalledWith('craft', expect.objectContaining({
			type: 'artifact_receipt',
			entity_id: project.id
		}));
	});

	it('skips artifact receipt emission when no artifact_path is provided', async () => {
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			getTenant: () => 'rainer',
			getTask: vi.fn(async () => makeTask({
				id: 'task_without_artifact',
				linked_entity_ids: ['ent_project']
			})),
			updateTask: vi.fn(async (id: string, updates: Partial<Task>) => makeTask({
				id,
				linked_entity_ids: ['ent_project'],
				status: (updates.status as Task['status']) ?? 'done',
				completion_note: updates.completion_note,
				completed_at: updates.completed_at
			})),
			findEntityById: vi.fn(async () => makeProjectEntity()),
			getProjectDossier: vi.fn(async () => makeProjectDossier()),
			appendToTerritory,
			listTasks: vi.fn(async () => [])
		};

		const result = await handleTaskTool('mind_task', {
			action: 'complete',
			id: 'task_without_artifact',
			completion_note: 'Done.'
		}, { storage: storage as any });

		expect(result.completed).toBe(true);
		expect(result).not.toHaveProperty('artifact_receipt');
		expect(appendToTerritory).not.toHaveBeenCalled();
	});

	it('returns unblocked downstream delegated tasks when a dependency completes', async () => {
		const completedTask = makeTask({
			id: 'task_executor',
			tenant_id: 'companion',
			title: 'Draft the proposition'
		});
		const downstreamTask = makeTask({
			id: 'task_review',
			tenant_id: 'companion',
			assigned_tenant: 'rainer',
			title: 'Review: Draft the proposition',
			status: 'open',
			depends_on: ['task_executor']
		});
		const storage = {
			getTenant: () => 'companion',
			getTask: vi.fn(async (id: string) => {
				if (id === 'task_executor') return completedTask;
				if (id === 'task_review') return downstreamTask;
				return null;
			}),
			updateTask: vi.fn(async (id: string, updates: Partial<Task>) => makeTask({
				id,
				tenant_id: 'companion',
				title: 'Draft the proposition',
				status: (updates.status as Task['status']) ?? 'done',
				completion_note: updates.completion_note,
				completed_at: updates.completed_at
			})),
			listTasks: vi.fn(async () => [downstreamTask])
		};

		const result = await handleTaskTool('mind_task', {
			action: 'complete',
			id: 'task_executor',
			completion_note: 'Draft complete.'
		}, { storage: storage as any });

		expect(result.completed).toBe(true);
		expect(result.unblocked_tasks).toEqual([
			expect.objectContaining({
				id: 'task_review',
				assigned_tenant: 'rainer'
			})
		]);
		expect(result.unblocked_assigned_tenants).toEqual(['rainer']);
	});

});

describe('comms v2 context tasks', () => {
	it('trims open threads and skips blank task titles', async () => {
		let counter = 0;
		const createTask = vi.fn(async (task: Omit<Task, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => {
			counter += 1;
			return makeTask({ id: `task_${counter}`, ...task });
		});
		const storage = {
			writeConversationContext: vi.fn(async () => undefined),
			createTask
		};

		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'Wrapped session.',
			open_threads: ['  first thread  ', '   ', 'second thread'],
			create_tasks: true
		}, { storage: storage as any });

		expect(createTask).toHaveBeenCalledTimes(2);
		expect(createTask.mock.calls.map(([task]) => task.title)).toEqual(['first thread', 'second thread']);
		expect(result.tasks_created).toBe(2);
		expect(result.blank_threads_skipped).toBe(1);
		expect(result.thread_limit_applied).toBe(0);
	});

	it('caps context-created tasks at 20 open threads', async () => {
		let counter = 0;
		const createTask = vi.fn(async (task: Omit<Task, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => {
			counter += 1;
			return makeTask({ id: `task_${counter}`, ...task });
		});
		const storage = {
			writeConversationContext: vi.fn(async () => undefined),
			createTask
		};

		const openThreads = Array.from({ length: 25 }, (_, i) => `thread ${i + 1}`);
		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'Wrapped session.',
			open_threads: openThreads,
			create_tasks: true
		}, { storage: storage as any });

		expect(createTask).toHaveBeenCalledTimes(20);
		expect(result.tasks_created).toBe(20);
		expect(result.thread_limit_applied).toBe(5);
	});

	it('rejects overlong letter content before write', async () => {
		const storage = {
			appendLetter: vi.fn()
		};

		const result = await handleCommsTool('mind_letter', {
			action: 'write',
			to_context: 'chat',
			content: 'x'.repeat(4001)
		}, { storage: storage as any });

		expect(result.error).toMatch(/content too long/i);
		expect(storage.appendLetter).not.toHaveBeenCalled();
	});
});

describe('task scheduling daemon', () => {
	it('bulk-opens due scheduled tasks in one storage call', async () => {
		const openDueScheduledTasks = vi.fn(async () => 2);
		const storage = {
			openDueScheduledTasks
		};

		const result = await runTaskSchedulingTask(storage as any);

		expect(openDueScheduledTasks).toHaveBeenCalledTimes(1);
		expect(openDueScheduledTasks.mock.calls[0][1]).toBe(200);
		expect(Number.isNaN(new Date(openDueScheduledTasks.mock.calls[0][0]).getTime())).toBe(false);
		expect(result.changes).toBe(2);
	});
});
