import { describe, expect, it, vi } from 'vitest';
import { handleTool as handleProjectTool } from '../src/tools-v2/projects';
import type { Entity, ProjectDossier } from '../src/types';

function makeEntity(overrides: Partial<Entity> = {}): Entity {
	return {
		id: overrides.id ?? 'ent_project',
		tenant_id: overrides.tenant_id ?? 'rainer',
		name: overrides.name ?? 'Brain Surgery',
		entity_type: overrides.entity_type ?? 'project',
		tags: overrides.tags ?? ['brain'],
		salience: overrides.salience ?? 'active',
		primary_context: overrides.primary_context,
		created_at: overrides.created_at ?? '2026-03-27T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-03-27T00:00:00.000Z'
	};
}

function makeDossier(overrides: Partial<ProjectDossier> = {}): ProjectDossier {
	return {
		id: overrides.id ?? 'dossier_project',
		tenant_id: overrides.tenant_id ?? 'rainer',
		project_entity_id: overrides.project_entity_id ?? 'ent_project',
		lifecycle_status: overrides.lifecycle_status ?? 'active',
		summary: overrides.summary ?? 'Make the shared brain more dangerous.',
		goals: overrides.goals ?? ['ship dossiers'],
		constraints: overrides.constraints ?? ['stay additive'],
		decisions: overrides.decisions ?? ['entity is canonical'],
		open_questions: overrides.open_questions ?? ['how rich should metadata get?'],
		next_actions: overrides.next_actions ?? ['wire wake delta'],
		metadata: overrides.metadata ?? { owner: 'Rainer' },
		last_active_at: overrides.last_active_at ?? '2026-03-27T00:00:00.000Z',
		created_at: overrides.created_at ?? '2026-03-27T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-03-27T00:00:00.000Z'
	};
}

describe('project dossiers v2 tool', () => {
	it('creates a project entity and dossier together', async () => {
		const entity = makeEntity();
		const dossier = makeDossier({ project_entity_id: entity.id });

		const storage = {
			getTenant: () => 'rainer',
			findEntityByName: vi.fn(async () => null),
			createEntity: vi.fn(async () => entity),
			createProjectDossier: vi.fn(async () => dossier)
		};

		const result = await handleProjectTool('mind_project', {
			action: 'create',
			name: '  Brain Surgery  ',
			primary_context: 'Shared brain architecture',
			tags: [' shared ', ' brain '],
			summary: '  Make the brain more coherent. ',
			goals: [' ship dossiers ', ' ', 'wake delta'],
			next_actions: [' write migration ']
		}, { storage: storage as any });

		expect(storage.createEntity).toHaveBeenCalledWith(expect.objectContaining({
			name: 'Brain Surgery',
			entity_type: 'project',
			tags: ['shared', 'brain']
		}));
		expect(storage.createProjectDossier).toHaveBeenCalledWith(expect.objectContaining({
			project_entity_id: entity.id,
			summary: 'Make the brain more coherent.',
			goals: ['ship dossiers', 'wake delta'],
			next_actions: ['write migration']
		}));
		expect(result.created).toBe(true);
		expect(result.project.entity).toEqual(entity);
		expect(result.project.dossier).toEqual(dossier);
	});

	it('gets a single hydrated project dossier', async () => {
		const entity = makeEntity();
		const dossier = makeDossier({ project_entity_id: entity.id });

		const storage = {
			findEntityByName: vi.fn(async () => entity),
			getProjectDossier: vi.fn(async () => dossier)
		};

		const result = await handleProjectTool('mind_project', {
			action: 'get',
			name: entity.name
		}, { storage: storage as any });

		expect(storage.getProjectDossier).toHaveBeenCalledWith(entity.id);
		expect(result.project).toEqual({ entity, dossier });
	});

	it('returns the existing project id instead of duplicate-creating', async () => {
		const entity = makeEntity();
		const storage = {
			findEntityByName: vi.fn(async () => entity),
			createEntity: vi.fn(),
			createProjectDossier: vi.fn()
		};

		const result = await handleProjectTool('mind_project', {
			action: 'create',
			name: entity.name
		}, { storage: storage as any });

		expect(result).toEqual({
			error: 'Project already exists',
			entity_id: entity.id
		});
		expect(storage.createEntity).not.toHaveBeenCalled();
		expect(storage.createProjectDossier).not.toHaveBeenCalled();
	});

	it('lists hydrated project dossiers', async () => {
		const entity = makeEntity();
		const dossier = makeDossier({ project_entity_id: entity.id });

		const storage = {
			listProjectDossiers: vi.fn(async () => [dossier]),
			findEntityById: vi.fn(async () => entity)
		};

		const result = await handleProjectTool('mind_project', {
			action: 'list',
			lifecycle_status: 'active'
		}, { storage: storage as any });

		expect(result.count).toBe(1);
		expect(result.projects[0]).toEqual({ entity, dossier });
	});

	it('filters out dossiers whose project entity is missing during list hydration', async () => {
		const dossier = makeDossier();
		const storage = {
			listProjectDossiers: vi.fn(async () => [dossier]),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleProjectTool('mind_project', {
			action: 'list'
		}, { storage: storage as any });

		expect(result.count).toBe(0);
		expect(result.projects).toEqual([]);
	});

	it('updates dossier fields and project entity metadata', async () => {
		const entity = makeEntity();
		const dossier = makeDossier({ project_entity_id: entity.id });
		const updatedEntity = makeEntity({ tags: ['brain', 'wake'], primary_context: 'Sharper wake intelligence' });
		const updatedDossier = makeDossier({
			project_entity_id: entity.id,
			summary: 'Wake delta is online.',
			next_actions: ['write tests']
		});

		const storage = {
			findEntityByName: vi.fn(async () => entity),
			updateEntity: vi.fn(async () => updatedEntity),
			updateProjectDossier: vi.fn(async () => updatedDossier)
		};

		const result = await handleProjectTool('mind_project', {
			action: 'update',
			name: entity.name,
			tags: ['brain', 'wake'],
			primary_context: 'Sharper wake intelligence',
			summary: 'Wake delta is online.',
			next_actions: ['write tests']
		}, { storage: storage as any });

		expect(storage.updateEntity).toHaveBeenCalledWith(entity.id, expect.objectContaining({
			tags: ['brain', 'wake'],
			primary_context: 'Sharper wake intelligence'
		}));
		expect(storage.updateProjectDossier).toHaveBeenCalledWith(entity.id, expect.objectContaining({
			summary: 'Wake delta is online.',
			next_actions: ['write tests']
		}));
		expect(result.updated).toBe(true);
		expect(result.project.entity).toEqual(updatedEntity);
		expect(result.project.dossier).toEqual(updatedDossier);
	});

	it('rejects oversized metadata before creating a project entity', async () => {
		const storage = {
			findEntityByName: vi.fn(async () => null),
			createEntity: vi.fn(),
			createProjectDossier: vi.fn()
		};

		const result = await handleProjectTool('mind_project', {
			action: 'create',
			name: 'Brain Surgery',
			metadata: { blob: 'x'.repeat(70_000) }
		}, { storage: storage as any });

		expect(result.error).toMatch(/metadata too large/);
		expect(storage.createEntity).not.toHaveBeenCalled();
		expect(storage.createProjectDossier).not.toHaveBeenCalled();
	});
});
