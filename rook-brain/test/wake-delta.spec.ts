import { describe, expect, it, vi } from 'vitest';
import { handleTool as handleWakeTool } from '../src/tools-v2/wake';
import type { BrainState, OpenLoop, ProjectDossier, Task } from '../src/types';

function makeState(): BrainState {
	return {
		current_mood: 'focused',
		energy_level: 0.8,
		last_updated: '2026-03-27T00:00:00.000Z',
		momentum: {
			current_charges: ['build'],
			intensity: 0.7,
			last_updated: '2026-03-27T00:00:00.000Z'
		},
		afterglow: {
			residue_charges: []
		}
	};
}

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: overrides.id ?? 'task_1',
		tenant_id: overrides.tenant_id ?? 'rainer',
		assigned_tenant: overrides.assigned_tenant,
		title: overrides.title ?? 'Ship dossiers',
		description: overrides.description,
		status: overrides.status ?? 'open',
		priority: overrides.priority ?? 'high',
		estimated_effort: overrides.estimated_effort,
		scheduled_wake: overrides.scheduled_wake,
		source: overrides.source,
		linked_observation_ids: overrides.linked_observation_ids ?? [],
		linked_entity_ids: overrides.linked_entity_ids ?? [],
		depends_on: overrides.depends_on,
		completion_note: overrides.completion_note,
		created_at: overrides.created_at ?? '2026-03-27T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-03-27T00:05:00.000Z',
		completed_at: overrides.completed_at
	};
}

function makeLoop(overrides: Partial<OpenLoop> = {}): OpenLoop {
	return {
		id: overrides.id ?? 'loop_1',
		content: overrides.content ?? 'Decide how wake delta should behave.',
		status: overrides.status ?? 'burning',
		territory: overrides.territory ?? 'craft',
		created: overrides.created ?? '2026-03-27T00:00:00.000Z',
		resolved: overrides.resolved,
		resolution_note: overrides.resolution_note,
		mode: overrides.mode,
		linked_entity_ids: overrides.linked_entity_ids
	};
}

function makeDossier(overrides: Partial<ProjectDossier> = {}): ProjectDossier {
	return {
		id: overrides.id ?? 'dossier_1',
		tenant_id: overrides.tenant_id ?? 'rainer',
		project_entity_id: overrides.project_entity_id ?? 'ent_project',
		lifecycle_status: overrides.lifecycle_status ?? 'active',
		summary: overrides.summary ?? 'Wake delta slice',
		goals: overrides.goals ?? [],
		constraints: overrides.constraints ?? [],
		decisions: overrides.decisions ?? [],
		open_questions: overrides.open_questions ?? [],
		next_actions: overrides.next_actions ?? [],
		metadata: overrides.metadata ?? {},
		last_active_at: overrides.last_active_at ?? '2026-03-27T00:04:00.000Z',
		created_at: overrides.created_at ?? '2026-03-27T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-03-27T00:06:00.000Z'
	};
}

describe('wake delta', () => {
	it('includes task, loop, and project deltas and appends an auto wake log', async () => {
		const currentLoop = makeLoop({ status: 'burning' });
		const changedTask = makeTask({ id: 'task_changed', title: 'Finish wake delta' });
		const changedProject = makeDossier();
		const appendWakeLog = vi.fn(async () => undefined);

		const storage = {
			readOverviews: vi.fn(async () => []),
			readIronGripIndex: vi.fn(async () => []),
			readLetters: vi.fn(async () => []),
			readOpenLoops: vi.fn(async () => [currentLoop]),
			readBrainState: vi.fn(async () => makeState()),
			readSubconscious: vi.fn(async () => null),
			listTasks: vi.fn(async (status: string) => status === 'open' ? [changedTask] : []),
			readAllTerritories: vi.fn(async () => []),
			readLatestWakeLog: vi.fn(async () => ({
				id: 'wake_prev',
				timestamp: '2026-03-27T00:01:00.000Z',
				snapshot: {
					loops: [{ id: currentLoop.id, status: 'nagging' }]
				}
			})),
			listTaskChangesSince: vi.fn(async () => [changedTask]),
			listProjectDossiers: vi.fn(async () => [changedProject]),
			findEntityById: vi.fn(async () => ({
				id: 'ent_project',
				tenant_id: 'rainer',
				name: 'Brain Surgery',
				entity_type: 'project',
				tags: [],
				salience: 'active',
				created_at: '2026-03-27T00:00:00.000Z',
				updated_at: '2026-03-27T00:00:00.000Z'
			})),
			appendWakeLog
		};

		const result = await handleWakeTool('mind_wake', {
			depth: 'quick'
		}, { storage: storage as any });

		expect(storage.listTaskChangesSince).toHaveBeenCalledWith('2026-03-27T00:01:00.000Z', 20, true);
		expect(result.delta.since).toBe('2026-03-27T00:01:00.000Z');
		expect(result.delta.tasks.changed).toBe(1);
		expect(result.delta.loops.changed).toBe(1);
		expect(result.delta.projects.changed).toBe(1);
		expect(result.delta.projects.items[0].name).toBe('Brain Surgery');
		expect(appendWakeLog).toHaveBeenCalledWith(expect.objectContaining({
			kind: 'auto',
			depth: 'quick',
			snapshot: expect.objectContaining({
				loops: [expect.objectContaining({ id: currentLoop.id, status: 'burning' })]
			})
		}));
	});

	it('returns an empty delta on first wake when no previous wake log exists', async () => {
		const appendWakeLog = vi.fn(async () => undefined);
		const storage = {
			readOverviews: vi.fn(async () => []),
			readIronGripIndex: vi.fn(async () => []),
			readLetters: vi.fn(async () => []),
			readOpenLoops: vi.fn(async () => []),
			readBrainState: vi.fn(async () => makeState()),
			readSubconscious: vi.fn(async () => null),
			listTasks: vi.fn(async () => []),
			readAllTerritories: vi.fn(async () => []),
			readLatestWakeLog: vi.fn(async () => null),
			listTaskChangesSince: vi.fn(async () => []),
			listProjectDossiers: vi.fn(async () => []),
			appendWakeLog
		};

		const result = await handleWakeTool('mind_wake', {
			depth: 'quick'
		}, { storage: storage as any });

		expect(result.delta).toEqual({
			since: null,
			tasks: { changed: 0, items: [] },
			loops: { changed: 0, items: [] },
			projects: { changed: 0, items: [] }
		});
		expect(storage.listTaskChangesSince).not.toHaveBeenCalled();
		expect(storage.listProjectDossiers).not.toHaveBeenCalled();
		expect(appendWakeLog).toHaveBeenCalledTimes(1);
	});

	it('returns an empty delta when nothing changed since the previous wake', async () => {
		const appendWakeLog = vi.fn(async () => undefined);
		const storage = {
			readOverviews: vi.fn(async () => []),
			readIronGripIndex: vi.fn(async () => []),
			readLetters: vi.fn(async () => []),
			readOpenLoops: vi.fn(async () => []),
			readBrainState: vi.fn(async () => makeState()),
			readSubconscious: vi.fn(async () => null),
			listTasks: vi.fn(async () => []),
			readAllTerritories: vi.fn(async () => []),
			readLatestWakeLog: vi.fn(async () => ({
				id: 'wake_prev',
				timestamp: '2026-03-27T00:01:00.000Z',
				snapshot: { loops: [] }
			})),
			listTaskChangesSince: vi.fn(async () => []),
			listProjectDossiers: vi.fn(async () => []),
			appendWakeLog
		};

		const result = await handleWakeTool('mind_wake', {
			depth: 'quick'
		}, { storage: storage as any });

		expect(result.delta).toEqual({
			since: '2026-03-27T00:01:00.000Z',
			tasks: { changed: 0, items: [] },
			loops: { changed: 0, items: [] },
			projects: { changed: 0, items: [] }
		});
		expect(storage.listTaskChangesSince).toHaveBeenCalledWith('2026-03-27T00:01:00.000Z', 20, true);
		expect(storage.listProjectDossiers).toHaveBeenCalledWith({ updated_after: '2026-03-27T00:01:00.000Z', limit: 20 });
		expect(appendWakeLog).toHaveBeenCalledTimes(1);
	});
});
