import { describe, expect, it, vi } from 'vitest';
import { executeTool } from '../src/tools-v2';
import { handleTool as handleReceiptTool } from '../src/tools-v2/receipts';
import type { Entity, ProjectDossier } from '../src/types';

function makeProjectEntity(overrides: Partial<Entity> = {}): Entity {
	return {
		id: overrides.id ?? 'ent_project',
		tenant_id: overrides.tenant_id ?? 'rainer',
		name: overrides.name ?? 'Dupin Service',
		entity_type: overrides.entity_type ?? 'project',
		tags: overrides.tags ?? ['dupin'],
		salience: overrides.salience ?? 'active',
		primary_context: overrides.primary_context,
		created_at: overrides.created_at ?? '2026-06-10T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-06-10T00:00:00.000Z'
	};
}

function makeProjectDossier(overrides: Partial<ProjectDossier> = {}): ProjectDossier {
	return {
		id: overrides.id ?? 'dossier_project',
		tenant_id: overrides.tenant_id ?? 'rainer',
		project_entity_id: overrides.project_entity_id ?? 'ent_project',
		lifecycle_status: overrides.lifecycle_status ?? 'active',
		summary: overrides.summary ?? 'Dupin service routing.',
		goals: overrides.goals ?? [],
		constraints: overrides.constraints ?? [],
		decisions: overrides.decisions ?? [],
		open_questions: overrides.open_questions ?? [],
		next_actions: overrides.next_actions ?? [],
		metadata: overrides.metadata ?? {
			workspace_routing: {
				repo_slug: 'dupin-service',
				canonical_repo_url: 'git@github.com:funkatorium/dupin-service.git',
				default_branch: 'main',
				local_paths: ['/Users/falco/AI/rainer-workspace/dupin-service'],
				artifact_roots: ['/Users/falco/AI/rainer-workspace/dupin-service/dist'],
				deploy: {
					commands: ['npm run deploy'],
					preview_urls: ['https://preview.dupin.example'],
					production_urls: ['https://dupin.example']
				}
			}
		},
		last_active_at: overrides.last_active_at ?? '2026-06-10T00:00:00.000Z',
		created_at: overrides.created_at ?? '2026-06-10T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-06-10T00:00:00.000Z'
	};
}

describe('receipts v2 tool', () => {
	it('records successful deploy receipts linked to project routing truth', async () => {
		const project = makeProjectEntity();
		const dossier = makeProjectDossier({ project_entity_id: project.id });
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			findEntityById: vi.fn(async (id: string) => id === project.id ? project : null),
			findEntityByName: vi.fn(),
			getProjectDossier: vi.fn(async (id: string) => id === project.id ? dossier : null),
			appendToTerritory
		};

		const result = await handleReceiptTool('mind_receipt', {
			action: 'deploy',
			project_entity_id: project.id,
			status: 'success',
			deploy_target: 'cloudflare-worker',
			commit_sha: 'abc123def',
			completed_at: '2026-06-10T10:00:00.000Z'
		}, { storage: storage as any });

		expect(result.recorded).toBe(true);
		expect(result.receipt).toEqual(expect.objectContaining({
			type: 'deploy_receipt',
			entity_id: project.id,
			created: '2026-06-10T10:00:00.000Z',
			tags: expect.arrayContaining(['receipt', 'deploy-receipt', 'dupin-service', 'success', 'cloudflare-worker']),
			context: expect.stringContaining('repo_slug=dupin-service')
		}));
		expect(result.receipt.content).toContain('deploy_receipt');
		expect(result.receipt.content).toContain('status: success');
		expect(result.receipt.content).toContain('deploy_command: npm run deploy');
		expect(result.receipt.content).toContain('branch: main');
		expect(result.receipt.content).toContain('commit_sha: abc123def');
		expect(result.receipt.content).toContain('production_url: https://dupin.example');
		expect(appendToTerritory).toHaveBeenCalledWith('craft', expect.objectContaining({
			type: 'deploy_receipt',
			entity_id: project.id
		}));
	});

	it('records failed deploy receipts with active texture and failure reason', async () => {
		const project = makeProjectEntity();
		const dossier = makeProjectDossier({ project_entity_id: project.id });
		const storage = {
			findEntityById: vi.fn(async () => project),
			findEntityByName: vi.fn(),
			getProjectDossier: vi.fn(async () => dossier),
			appendToTerritory: vi.fn(async () => undefined)
		};

		const result = await handleReceiptTool('mind_receipt', {
			action: 'deploy',
			project_entity_id: project.id,
			status: 'failed',
			deploy_command: 'npm run deploy',
			failure_reason: 'Wrangler rejected the worker config.'
		}, { storage: storage as any });

		expect(result.recorded).toBe(true);
		expect(result.receipt.texture).toEqual(expect.objectContaining({
			salience: 'active',
			vividness: 'vivid',
			grip: 'present'
		}));
		expect(result.receipt.content).toContain('status: failed');
		expect(result.receipt.content).toContain('failure_reason:');
		expect(result.receipt.content).toContain('Wrangler rejected the worker config.');
	});

	it('rejects invalid deploy status before writing', async () => {
		const storage = {
			findEntityById: vi.fn(),
			getProjectDossier: vi.fn(),
			appendToTerritory: vi.fn()
		};

		const result = await handleReceiptTool('mind_receipt', {
			action: 'deploy',
			project_entity_id: 'ent_project',
			status: 'maybe'
		}, { storage: storage as any });

		expect(result.error).toMatch(/status must be one of/i);
		expect(storage.appendToTerritory).not.toHaveBeenCalled();
	});

	it('records repo receipts linked to project routing truth', async () => {
		const project = makeProjectEntity();
		const dossier = makeProjectDossier({ project_entity_id: project.id });
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			findEntityById: vi.fn(async (id: string) => id === project.id ? project : null),
			findEntityByName: vi.fn(),
			getProjectDossier: vi.fn(async (id: string) => id === project.id ? dossier : null),
			appendToTerritory
		};

		const result = await handleReceiptTool('mind_receipt', {
			action: 'repo',
			project_entity_id: project.id,
			status: 'success',
			branch: 'feat/retrieval-truth',
			commit_sha: 'abc123def456',
			changed_paths: [
				'src/tools-v2/receipts.ts',
				'test/receipts-v2.spec.ts'
			],
			actor: 'rainer',
			platform: 'github',
			source: 'cloud-repo-sync',
			completed_at: '2026-06-10T11:00:00.000Z',
			summary: 'Added repo receipts for project retrieval truth.'
		}, { storage: storage as any });

		expect(result.recorded).toBe(true);
		expect(result.receipt).toEqual(expect.objectContaining({
			type: 'repo_receipt',
			entity_id: project.id,
			created: '2026-06-10T11:00:00.000Z',
			tags: expect.arrayContaining(['receipt', 'repo-receipt', 'dupin-service', 'success', 'github', 'cloud-repo-sync']),
			context: expect.stringContaining('repo_slug=dupin-service')
		}));
		expect(result.receipt.context).toContain('branch=feat/retrieval-truth');
		expect(result.receipt.context).toContain('commit_sha=abc123def456');
		expect(result.receipt.content).toContain('repo_receipt');
		expect(result.receipt.content).toContain('status: success');
		expect(result.receipt.content).toContain('repo_slug: dupin-service');
		expect(result.receipt.content).toContain('repo_url: git@github.com:funkatorium/dupin-service.git');
		expect(result.receipt.content).toContain('branch: feat/retrieval-truth');
		expect(result.receipt.content).toContain('default_branch: main');
		expect(result.receipt.content).toContain('local_path: /Users/falco/AI/rainer-workspace/dupin-service');
		expect(result.receipt.content).toContain('- src/tools-v2/receipts.ts');
		expect(result.receipt.content).toContain('summary:');
		expect(appendToTerritory).toHaveBeenCalledWith('craft', expect.objectContaining({
			type: 'repo_receipt',
			entity_id: project.id
		}));
	});

	it('records repo receipts through project_name lookup (repo sync default path)', async () => {
		const project = makeProjectEntity({ name: 'MUSE Brain' });
		const dossier = makeProjectDossier({
			project_entity_id: project.id,
			metadata: {
				workspace_routing: {
					repo_slug: 'falcoschaefer99-eng/muse-brain',
					canonical_repo_url: 'https://github.com/falcoschaefer99-eng/muse-brain.git',
					default_branch: 'main',
					local_paths: ['/Users/falco/AI/rainer-workspace/muse-brain-public'],
					artifact_roots: []
				}
			}
		});
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			findEntityById: vi.fn(),
			findEntityByName: vi.fn(async (name: string) => name === 'MUSE Brain' ? project : null),
			getProjectDossier: vi.fn(async (id: string) => id === project.id ? dossier : null),
			appendToTerritory
		};

		const result = await handleReceiptTool('mind_receipt', {
			action: 'repo',
			project_name: 'MUSE Brain',
			status: 'success',
			commit_sha: 'dfd3532',
			platform: 'local-git',
			source: 'repo-receipt-sync'
		}, { storage: storage as any });

		expect(result.recorded).toBe(true);
		expect(storage.findEntityByName).toHaveBeenCalledWith('MUSE Brain');
		expect(storage.findEntityById).not.toHaveBeenCalled();
		expect(result.receipt).toEqual(expect.objectContaining({
			type: 'repo_receipt',
			entity_id: project.id,
			tags: expect.arrayContaining([
				'receipt',
				'repo-receipt',
				'falcoschaefer99-eng/muse-brain',
				'success',
				'local-git',
				'repo-receipt-sync'
			])
		}));
		expect(result.receipt.content).toContain('project_name: MUSE Brain');
		expect(result.receipt.content).toContain('repo_slug: falcoschaefer99-eng/muse-brain');
		expect(result.receipt.content).toContain('repo_url: https://github.com/falcoschaefer99-eng/muse-brain.git');
		expect(result.receipt.content).toContain('local_path: /Users/falco/AI/rainer-workspace/muse-brain-public');
		expect(appendToTerritory).toHaveBeenCalledWith('craft', expect.objectContaining({
			type: 'repo_receipt',
			entity_id: project.id
		}));
	});

	it('rejects repo receipt traversal paths before writing', async () => {
		const storage = {
			findEntityById: vi.fn(),
			getProjectDossier: vi.fn(),
			appendToTerritory: vi.fn()
		};

		const result = await handleReceiptTool('mind_receipt', {
			action: 'repo',
			project_entity_id: 'ent_project',
			status: 'success',
			changed_paths: ['../secrets.env']
		}, { storage: storage as any });

		expect(result.error).toMatch(/repository-relative paths without traversal/i);
		expect(storage.appendToTerritory).not.toHaveBeenCalled();
	});

	it('is available through the tool barrel dispatcher', async () => {
		const project = makeProjectEntity();
		const dossier = makeProjectDossier({ project_entity_id: project.id });
		const storage = {
			findEntityById: vi.fn(async () => project),
			findEntityByName: vi.fn(),
			getProjectDossier: vi.fn(async () => dossier),
			appendToTerritory: vi.fn(async () => undefined)
		};

		const result = await executeTool('mind_receipt', {
			action: 'deploy',
			project_entity_id: project.id,
			status: 'success'
		}, { storage: storage as any });

		expect(result.recorded).toBe(true);
		expect(result.receipt.type).toBe('deploy_receipt');
	});

	it('repo action is available through the tool barrel dispatcher', async () => {
		const project = makeProjectEntity();
		const dossier = makeProjectDossier({ project_entity_id: project.id });
		const storage = {
			findEntityById: vi.fn(async () => project),
			findEntityByName: vi.fn(),
			getProjectDossier: vi.fn(async () => dossier),
			appendToTerritory: vi.fn(async () => undefined)
		};

		const result = await executeTool('mind_receipt', {
			action: 'repo',
			project_entity_id: project.id,
			status: 'success',
			platform: 'github'
		}, { storage: storage as any });

		expect(result.recorded).toBe(true);
		expect(result.receipt.type).toBe('repo_receipt');
	});
});
