import { describe, expect, it, vi } from 'vitest';
import { handleTool as handleMemoryTool } from '../src/tools-v2/memory';
import { handleTool as handleSearchTool } from '../src/tools-v2/search';
import { handleTool as handleCommsTool } from '../src/tools-v2/comms';
import type { Observation } from '../src/types';

function makeObservation(id: string, created: string): Observation {
	return {
		id,
		content: `obs ${id}`,
		territory: 'craft',
		created,
		texture: {
			salience: 'active',
			vividness: 'vivid',
			charge: [],
			grip: 'present',
			charge_phase: 'fresh'
		},
		access_count: 0
	};
}

describe('context confidence gating', () => {
	it('applies confidence threshold + hard cap in mind_query hybrid path', async () => {
		const now = Date.now();
		const storage = {
			hybridSearch: vi.fn(async () => ([
				{
					observation: makeObservation('obs_high_old', new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.72,
					match_sources: ['vector']
				},
				{
					observation: makeObservation('obs_recent_high', new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.65,
					match_sources: ['vector', 'keyword']
				},
				{
					observation: makeObservation('obs_recent_low', new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.52,
					match_sources: ['keyword']
				}
			])),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleMemoryTool('mind_query', {
			query: 'autonomous skill confidence',
			confidence_threshold: 0.7,
			recency_boost_days: 3,
			recency_boost: 0.15,
			max_context_items: 1
		}, { storage: storage as any });

		expect(result.count).toBe(1);
		expect(result.observations[0].id).toBe('obs_high_old');
		expect(result.confidence.below_threshold).toBe(1);
		expect(result.confidence.pre_cap_count).toBe(2);
		expect(result.confidence.max_context_items).toBe(1);
	});

	it('supports shadow_mode in mind_search without dropping below-threshold rows', async () => {
		const now = Date.now();
		const storage = {
			hybridSearch: vi.fn(async () => ([
				{
					observation: makeObservation('obs1', new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.76,
					match_sources: ['vector']
				},
				{
					observation: makeObservation('obs2', new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.55,
					match_sources: ['keyword']
				}
			])),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleSearchTool('mind_search', {
			query: 'task context',
			confidence_threshold: 0.8,
			shadow_mode: true,
			recency_boost: 0.15
		}, { storage: storage as any });

		expect(result.total_matches).toBe(2);
		expect(result.confidence.shadow_mode).toBe(true);
		expect(result.confidence.below_threshold).toBeGreaterThan(0);
	});
});

describe('productivity fact extraction on mind_context', () => {
	it('extracts fact candidates in shadow mode without writes', async () => {
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			writeConversationContext: vi.fn(async () => undefined),
			appendToTerritory
		};

		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'We decided to ship confidence gating next sprint.',
			key_points: ['Deadline: next sprint', 'Falco prefers lower prompt noise'],
			open_threads: ['Rainer will handle threshold calibration'],
			extract_facts: true,
			extraction_mode: 'shadow'
		}, { storage: storage as any });

		expect(result.saved).toBe(true);
		expect(result.fact_extraction.mode).toBe('shadow');
		expect(result.fact_extraction.candidate_count).toBeGreaterThan(0);
		expect(appendToTerritory).not.toHaveBeenCalled();
	});

	it('writes capped fact candidates in write mode', async () => {
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			writeConversationContext: vi.fn(async () => undefined),
			appendToTerritory
		};

		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'Decision: add confidence threshold. Goal: reduce context noise.',
			key_points: [
				'Deadline: tomorrow',
				'Owner: Rainer',
				'Falco prefers concise productivity memory'
			],
			extract_facts: true,
			extraction_mode: 'write',
			max_fact_candidates: 2
		}, { storage: storage as any });

		expect(result.fact_extraction.mode).toBe('write');
		expect(result.fact_extraction.candidate_count).toBe(2);
		expect(result.fact_extraction.stored_count).toBe(2);
		expect(appendToTerritory).toHaveBeenCalledTimes(2);
	});
});
