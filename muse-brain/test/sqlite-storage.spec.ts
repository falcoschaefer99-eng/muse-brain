import { describe, it, expect } from 'vitest';

import { createStorage } from '../src/storage/factory';
import { SQLiteBrainStorage } from '../src/storage/sqlite';

describe('sqlite storage backend', () => {
	it('boots with defaults and persists observations', async () => {
		const dbPath = `/tmp/muse-brain-test-${crypto.randomUUID()}.sqlite`;
		const storage = createStorage({ backend: 'sqlite', sqlitePath: dbPath }, 'companion');

		const state = await storage.readBrainState();
		expect(state.current_mood).toBe('neutral');

		const obsId = `obs_${Date.now()}`;
		await storage.appendToTerritory('craft', {
			id: obsId,
			content: 'sqlite backend smoke memory',
			territory: 'craft',
			created: new Date().toISOString(),
			texture: {
				salience: 'active',
				vividness: 'vivid',
				charge: ['clarity'],
				grip: 'present',
				charge_phase: 'fresh'
			},
			access_count: 0
		});

		const found = await storage.findObservation(obsId);
		expect(found?.observation.content).toContain('sqlite backend smoke memory');

		const queried = await storage.queryObservations({ territory: 'craft', limit: 10 });
		expect(queried.some(row => row.observation.id === obsId)).toBe(true);
	});

	it('supports task and runtime policy flows', async () => {
		const dbPath = `/tmp/muse-brain-test-${crypto.randomUUID()}.sqlite`;
		const storage = createStorage({ backend: 'sqlite', sqlitePath: dbPath }, 'companion');

		const task = await storage.createTask({
			title: 'ship sqlite',
			status: 'open',
			priority: 'high',
			linked_observation_ids: [],
			linked_entity_ids: []
		});
		expect(task.id).toMatch(/^task_/);

		const openTasks = await storage.listTasks('open', undefined, 20, false);
		expect(openTasks.some(t => t.id === task.id)).toBe(true);

		const policy = await storage.upsertAgentRuntimePolicy({
			agent_tenant: 'companion',
			execution_mode: 'balanced',
			daily_wake_budget: 9,
			impulse_wake_budget: 4,
			reserve_wakes: 1,
			min_impulse_interval_minutes: 90,
			max_tool_calls_per_run: 20,
			max_parallel_delegations: 1,
			require_priority_clear_for_impulse: true,
			updated_by: 'test',
			metadata: {}
		});
		expect(policy.execution_mode).toBe('balanced');

		await storage.createAgentRuntimeRun({
			agent_tenant: 'companion',
			trigger_mode: 'manual',
			status: 'succeeded',
			metadata: { wake_kind: 'duty' }
		});

		const usage = await storage.getAgentRuntimeUsage('companion', new Date(Date.now() - 60_000).toISOString());
		expect(usage.total_runs).toBe(1);
		expect(usage.duty_runs).toBe(1);
	});

	it('keeps non-entity matches when entity_id is set and includes entity-only candidates', async () => {
		const dbPath = `/tmp/muse-brain-test-${crypto.randomUUID()}.sqlite`;
		const storage = createStorage({ backend: 'sqlite', sqlitePath: dbPath }, 'companion');

		const now = new Date().toISOString();
		await storage.appendToTerritory('craft', {
			id: 'obs_entity_keyword',
			content: 'alpha project update',
			territory: 'craft',
			created: now,
			entity_id: 'entity_alpha',
			texture: { salience: 'active', vividness: 'vivid', charge: [], grip: 'present', charge_phase: 'fresh' },
			access_count: 0
		});
		await storage.appendToTerritory('craft', {
			id: 'obs_non_entity_keyword',
			content: 'alpha notes without linked entity',
			territory: 'craft',
			created: now,
			texture: { salience: 'active', vividness: 'vivid', charge: [], grip: 'present', charge_phase: 'fresh' },
			access_count: 0
		});
		await storage.appendToTerritory('craft', {
			id: 'obs_entity_only',
			content: 'unrelated text body',
			territory: 'craft',
			created: now,
			entity_id: 'entity_alpha',
			texture: { salience: 'active', vividness: 'vivid', charge: [], grip: 'present', charge_phase: 'fresh' },
			access_count: 0
		});

		const results = await storage.hybridSearch({
			query: 'alpha',
			entity_id: 'entity_alpha',
			limit: 10,
			min_similarity: 0.1
		});

		const ids = results.map(r => r.observation.id);
		expect(ids).toContain('obs_non_entity_keyword');
		expect(ids).toContain('obs_entity_only');
	});

	it('rejects invalid tenant at constructor boundary', () => {
		expect(() => new SQLiteBrainStorage('/tmp/muse-brain-test.sqlite', 'invalid-tenant')).toThrow(/Invalid tenant/);
	});
});
