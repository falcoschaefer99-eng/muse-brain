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
