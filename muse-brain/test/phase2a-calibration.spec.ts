import { describe, expect, it, vi } from 'vitest';
import { handleTool as handleAgentTool } from '../src/tools-v2/agents';
import { handleTool as handleHealthTool } from '../src/tools-v2/health';
import type { AgentCapabilityManifest, DispatchStat, Entity } from '../src/types';

function makeAgentEntity(overrides: Partial<Entity> = {}): Entity {
	return {
		id: overrides.id ?? 'ent_agent',
		tenant_id: overrides.tenant_id ?? 'rainer',
		name: overrides.name ?? 'Michael',
		entity_type: overrides.entity_type ?? 'agent',
		tags: overrides.tags ?? ['security'],
		salience: overrides.salience ?? 'active',
		primary_context: overrides.primary_context,
		created_at: overrides.created_at ?? '2026-03-27T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-03-27T00:00:00.000Z'
	};
}

function makeManifest(overrides: Partial<AgentCapabilityManifest> = {}): AgentCapabilityManifest {
	return {
		id: overrides.id ?? 'agentcard_1',
		tenant_id: overrides.tenant_id ?? 'rainer',
		agent_entity_id: overrides.agent_entity_id ?? 'ent_agent',
		version: overrides.version ?? '1.0.0',
		delegation_mode: overrides.delegation_mode ?? 'explicit',
		router_agent_entity_id: overrides.router_agent_entity_id,
		supports_streaming: overrides.supports_streaming ?? false,
		accepted_output_modes: overrides.accepted_output_modes ?? ['text'],
		protocols: overrides.protocols ?? ['internal'],
		skills: overrides.skills ?? [{ name: 'security-audit', description: 'Audit for vulnerabilities', tags: ['security'] }],
		metadata: overrides.metadata ?? {},
		created_at: overrides.created_at ?? '2026-03-27T00:00:00.000Z',
		updated_at: overrides.updated_at ?? '2026-03-27T00:00:00.000Z'
	};
}

describe('phase 2A agent manifest tool', () => {
	it('creates an agent capability manifest for an existing agent entity', async () => {
		const agent = makeAgentEntity();
		const manifest = makeManifest({ agent_entity_id: agent.id, supports_streaming: true });

		const storage = {
			findEntityByName: vi.fn(async () => agent),
			getAgentCapabilityManifest: vi.fn(async () => null),
			createAgentCapabilityManifest: vi.fn(async () => manifest)
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'create',
			name: agent.name,
			supports_streaming: true,
			accepted_output_modes: ['text', 'json'],
			protocols: ['internal', 'a2a'],
			skills: [{ name: 'security-audit', description: 'Audit for vulnerabilities', tags: ['security'] }]
		}, { storage: storage as any });

		expect(storage.createAgentCapabilityManifest).toHaveBeenCalledWith(expect.objectContaining({
			agent_entity_id: agent.id,
			supports_streaming: true,
			accepted_output_modes: ['text', 'json'],
			protocols: ['internal', 'a2a']
		}));
		expect(result.created).toBe(true);
		expect(result.agent.manifest).toEqual(manifest);
	});

	it('gets a single manifest for an existing agent entity', async () => {
		const agent = makeAgentEntity();
		const manifest = makeManifest({ agent_entity_id: agent.id });
		const storage = {
			findEntityByName: vi.fn(async () => agent),
			getAgentCapabilityManifest: vi.fn(async () => manifest)
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'get',
			name: agent.name
		}, { storage: storage as any });

		expect(storage.getAgentCapabilityManifest).toHaveBeenCalledWith(agent.id);
		expect(result.agent).toEqual({ entity: agent, manifest });
	});

	it('returns the existing agent id instead of duplicate-creating', async () => {
		const agent = makeAgentEntity();
		const manifest = makeManifest({ agent_entity_id: agent.id });
		const storage = {
			findEntityByName: vi.fn(async () => agent),
			getAgentCapabilityManifest: vi.fn(async () => manifest),
			createAgentCapabilityManifest: vi.fn()
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'create',
			name: agent.name
		}, { storage: storage as any });

		expect(result).toEqual({
			error: 'Agent capability manifest already exists',
			agent_entity_id: agent.id
		});
		expect(storage.createAgentCapabilityManifest).not.toHaveBeenCalled();
	});

	it('rejects manifests for non-agent entities', async () => {
		const storage = {
			findEntityByName: vi.fn(async () => makeAgentEntity({ entity_type: 'project', name: 'Not Michael' }))
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'create',
			name: 'Not Michael'
		}, { storage: storage as any });

		expect(result.error).toMatch(/is not an agent/);
	});

	it('lists hydrated manifests and filters missing agent entities', async () => {
		const manifest = makeManifest();
		const storage = {
			listAgentCapabilityManifests: vi.fn(async () => [manifest]),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'list'
		}, { storage: storage as any });

		expect(result.count).toBe(0);
		expect(result.agents).toEqual([]);
	});

	it('requires a router agent id when delegation_mode=router', async () => {
		const agent = makeAgentEntity();
		const storage = {
			findEntityByName: vi.fn(async () => agent),
			getAgentCapabilityManifest: vi.fn(async () => makeManifest({ agent_entity_id: agent.id, delegation_mode: 'explicit' }))
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'update',
			name: agent.name,
			delegation_mode: 'router'
		}, { storage: storage as any });

		expect(result.error).toMatch(/router_agent_entity_id is required/);
	});

	it('rejects router ids when the effective delegation mode is not router', async () => {
		const agent = makeAgentEntity();
		const manifest = makeManifest({ agent_entity_id: agent.id, delegation_mode: 'explicit' });
		const storage = {
			findEntityByName: vi.fn(async () => agent),
			getAgentCapabilityManifest: vi.fn(async () => manifest)
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'update',
			name: agent.name,
			router_agent_entity_id: 'ent_router'
		}, { storage: storage as any });

		expect(result.error).toMatch(/can only be set when delegation_mode=router/);
	});

	it('rejects oversized manifest metadata', async () => {
		const agent = makeAgentEntity();
		const storage = {
			findEntityByName: vi.fn(async () => agent)
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'create',
			name: agent.name,
			metadata: { blob: 'x'.repeat(70_000) }
		}, { storage: storage as any });

		expect(result.error).toMatch(/metadata too large/);
	});

	it('dry-runs canonical agent residency repairs without writing', async () => {
		const conceptMichael = makeAgentEntity({
			id: 'ent_michael_concept',
			name: 'michael',
			entity_type: 'concept',
			tags: ['security-old']
		});
		const storage = {
			getTenant: () => 'rainer',
			findEntityByName: vi.fn(async (name: string) => name === 'Michael' || name === 'michael' ? conceptMichael : null),
			updateEntity: vi.fn(),
			createEntity: vi.fn(),
			getAgentCapabilityManifest: vi.fn(async () => null),
			createAgentCapabilityManifest: vi.fn(),
			updateAgentCapabilityManifest: vi.fn()
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'normalize',
			dry_run: true,
			agents: [{
				name: 'Michael',
				aliases: ['michael'],
				tags: ['security'],
				primary_context: 'Security reviewer',
				manifest: {
					version: '1.0.0',
					protocols: ['internal'],
					skills: [{ name: 'security-audit', tags: ['security'] }]
				}
			}]
		}, { storage: storage as any });

		expect(result.dry_run).toBe(true);
		expect(result.results[0]).toEqual(expect.objectContaining({
			name: 'Michael',
			entity_id: 'ent_michael_concept',
			actions: ['repair_agent_entity', 'create_agent_manifest'],
			status: 'would_change'
		}));
		expect(storage.updateEntity).not.toHaveBeenCalled();
		expect(storage.createAgentCapabilityManifest).not.toHaveBeenCalled();
	});

	it('repairs concept entities into canonical agents and creates missing manifests', async () => {
		const conceptMichael = makeAgentEntity({
			id: 'ent_michael_concept',
			name: 'michael',
			entity_type: 'concept',
			tags: ['security-old']
		});
		const repairedMichael = makeAgentEntity({
			id: conceptMichael.id,
			name: 'Michael',
			entity_type: 'agent',
			tags: ['security-old', 'security'],
			primary_context: 'Security reviewer'
		});
		const manifest = makeManifest({ agent_entity_id: conceptMichael.id });
		const storage = {
			getTenant: () => 'rainer',
			findEntityByName: vi.fn(async (name: string) => name === 'Michael' || name === 'michael' ? conceptMichael : null),
			updateEntity: vi.fn(async () => repairedMichael),
			createEntity: vi.fn(),
			getAgentCapabilityManifest: vi.fn(async () => null),
			createAgentCapabilityManifest: vi.fn(async () => manifest)
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'normalize',
			dry_run: false,
			update_existing: true,
			agents: [{
				name: 'Michael',
				aliases: ['michael'],
				tags: ['security'],
				primary_context: 'Security reviewer',
				manifest: {
					version: '1.0.0',
					protocols: ['internal'],
					accepted_output_modes: ['text'],
					skills: [{ name: 'security-audit', description: 'Audit for vulnerabilities', tags: ['security'] }]
				}
			}]
		}, { storage: storage as any });

		expect(storage.updateEntity).toHaveBeenCalledWith(conceptMichael.id, expect.objectContaining({
			name: 'Michael',
			entity_type: 'agent',
			tags: ['security-old', 'security'],
			primary_context: 'Security reviewer'
		}));
		expect(storage.createAgentCapabilityManifest).toHaveBeenCalledWith(expect.objectContaining({
			agent_entity_id: conceptMichael.id,
			version: '1.0.0',
			delegation_mode: 'explicit',
			protocols: ['internal'],
			skills: [expect.objectContaining({ name: 'security-audit' })]
		}));
		expect(result.normalized).toBe(true);
		expect(result.results[0].status).toBe('changed');
	});

	it('creates missing canonical agent entities from a roster', async () => {
		const june = makeAgentEntity({
			id: 'ent_june',
			name: 'June',
			entity_type: 'agent',
			tags: ['engineering']
		});
		const manifest = makeManifest({ agent_entity_id: june.id });
		const storage = {
			getTenant: () => 'rainer',
			findEntityByName: vi.fn(async () => null),
			createEntity: vi.fn(async () => june),
			updateEntity: vi.fn(),
			getAgentCapabilityManifest: vi.fn(async () => null),
			createAgentCapabilityManifest: vi.fn(async () => manifest)
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'normalize',
			dry_run: false,
			agents: [{
				name: 'June',
				tags: ['engineering'],
				primary_context: 'Implementation engineer',
				manifest: {
					skills: [{ name: 'implementation', tags: ['code'] }]
				}
			}]
		}, { storage: storage as any });

		expect(storage.createEntity).toHaveBeenCalledWith(expect.objectContaining({
			tenant_id: 'rainer',
			name: 'June',
			entity_type: 'agent',
			tags: ['engineering'],
			primary_context: 'Implementation engineer'
		}));
		expect(storage.createAgentCapabilityManifest).toHaveBeenCalledWith(expect.objectContaining({
			agent_entity_id: june.id,
			version: '1.0.0',
			delegation_mode: 'explicit'
		}));
		expect(result.results[0].actions).toEqual(['create_agent_entity', 'create_agent_manifest']);
	});

	it('dry-runs the built-in builder squad roster when no custom agents are supplied', async () => {
		const storage = {
			getTenant: () => 'rainer',
			findEntityByName: vi.fn(async () => null),
			createEntity: vi.fn(),
			updateEntity: vi.fn(),
			getAgentCapabilityManifest: vi.fn(),
			createAgentCapabilityManifest: vi.fn()
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'normalize',
			roster: 'builder'
		}, { storage: storage as any });

		expect(result.dry_run).toBe(true);
		expect(result.roster).toBe('builder');
		expect(result.count).toBe(12);
		expect(result.results.map((row: any) => row.name)).toEqual(expect.arrayContaining([
			'Eli',
			'June',
			'Reeve',
			'Michael',
			'Kit'
		]));
		expect(result.results.every((row: any) => row.actions.includes('create_agent_entity'))).toBe(true);
		expect(storage.createEntity).not.toHaveBeenCalled();
		expect(storage.createAgentCapabilityManifest).not.toHaveBeenCalled();
	});

	it('normalizes the built-in creative squad roster and creates manifests', async () => {
		let nextId = 0;
		const storage = {
			getTenant: () => 'rainer',
			findEntityByName: vi.fn(async () => null),
			createEntity: vi.fn(async (payload: any) => makeAgentEntity({
				id: `ent_${++nextId}`,
				name: payload.name,
				entity_type: payload.entity_type,
				tags: payload.tags,
				primary_context: payload.primary_context
			})),
			updateEntity: vi.fn(),
			getAgentCapabilityManifest: vi.fn(async () => null),
			createAgentCapabilityManifest: vi.fn(async (payload: any) => makeManifest({
				agent_entity_id: payload.agent_entity_id,
				skills: payload.skills,
				protocols: payload.protocols,
				metadata: payload.metadata
			}))
		};

		const result = await handleAgentTool('mind_agent', {
			action: 'normalize',
			roster: 'creative',
			dry_run: false
		}, { storage: storage as any });

		expect(result.normalized).toBe(true);
		expect(result.roster).toBe('creative');
		expect(result.count).toBe(9);
		expect(storage.createEntity).toHaveBeenCalledWith(expect.objectContaining({
			name: 'Dante',
			entity_type: 'agent',
			tags: expect.arrayContaining(['dialogue'])
		}));
		expect(storage.createAgentCapabilityManifest).toHaveBeenCalledWith(expect.objectContaining({
			protocols: ['internal'],
			skills: [expect.objectContaining({ name: 'dialogue-editing' })],
			metadata: expect.objectContaining({
				source: 'built_in_agent_house_roster',
				roster_version: '2026-06-15'
			})
		}));
	});

	it('rejects unknown built-in roster names', async () => {
		const result = await handleAgentTool('mind_agent', {
			action: 'normalize',
			roster: 'goblins'
		}, { storage: {} as any });

		expect(result.error).toMatch(/roster must be one of/i);
	});

	it('updates existing manifests only when requested during normalization', async () => {
		const agent = makeAgentEntity();
		const existing = makeManifest({ agent_entity_id: agent.id, version: '1.0.0' });
		const updated = makeManifest({ agent_entity_id: agent.id, version: '1.1.0' });
		const storage = {
			findEntityByName: vi.fn(async () => agent),
			getAgentCapabilityManifest: vi.fn(async () => existing),
			updateAgentCapabilityManifest: vi.fn(async () => updated),
			updateEntity: vi.fn()
		};

		const unchanged = await handleAgentTool('mind_agent', {
			action: 'normalize',
			dry_run: false,
			update_existing: false,
			agents: [{ name: agent.name, manifest: { version: '1.1.0' } }]
		}, { storage: storage as any });

		expect(unchanged.results[0].status).toBe('already_canonical');
		expect(storage.updateAgentCapabilityManifest).not.toHaveBeenCalled();

		const changed = await handleAgentTool('mind_agent', {
			action: 'normalize',
			dry_run: false,
			update_existing: true,
			agents: [{ name: agent.name, manifest: { version: '1.1.0' } }]
		}, { storage: storage as any });

		expect(storage.updateAgentCapabilityManifest).toHaveBeenCalledWith(agent.id, expect.objectContaining({
			version: '1.1.0'
		}));
		expect(changed.results[0].actions).toContain('update_agent_manifest');
	});
});

describe('phase 2A dispatch health', () => {
	it('surfaces dispatch calibration stats through mind_health', async () => {
		const stats: DispatchStat[] = [{
			task_type: 'security-audit',
			total: 3,
			effective: 2,
			partial: 1,
			ineffective: 0,
			redirected: 0,
			avg_confidence: 0.8,
			avg_predicted_confidence: 0.84,
			avg_outcome_score: 0.76,
			avg_revision_cost: 0.2,
			rescue_rate: 0.33
		}];

		const storage = {
			getDispatchStats: vi.fn(async () => stats),
			getTenant: () => 'rainer'
		};

		const result = await handleHealthTool('mind_health', {
			section: 'dispatch'
		}, { storage: storage as any });

		expect(result.tenant).toBe('rainer');
		expect(result.dispatch.by_task_type).toEqual(stats);
	});
});
