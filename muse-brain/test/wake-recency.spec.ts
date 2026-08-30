import { describe, expect, it, vi } from 'vitest';
import { handleTool as handleWakeTool } from '../src/tools-v2/wake';
import type { BrainState, Letter, Observation, TerritoryOverview, IronGripEntry } from '../src/types';

function hoursAgo(h: number): string {
	return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function daysAgo(d: number): string {
	return hoursAgo(d * 24);
}

function makeState(): BrainState {
	return {
		current_mood: 'focused',
		energy_level: 0.8,
		last_updated: hoursAgo(1),
		momentum: {
			current_charges: ['build'],
			intensity: 0.7,
			last_updated: hoursAgo(1)
		},
		afterglow: {
			residue_charges: []
		}
	};
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
	return {
		id: overrides.id ?? 'obs_1',
		content: overrides.content ?? 'A generic observation about the craft.',
		territory: overrides.territory ?? 'craft',
		created: overrides.created ?? hoursAgo(1),
		texture: overrides.texture ?? { salience: 'active', vividness: 'vivid', charge: [], grip: 'present' },
		access_count: overrides.access_count ?? 1,
		summary: overrides.summary,
		last_accessed: overrides.last_accessed
	};
}

function makeOverview(overrides: Partial<TerritoryOverview> = {}): TerritoryOverview {
	return {
		territory: overrides.territory ?? 'craft',
		observation_count: overrides.observation_count ?? 1,
		top_charges: overrides.top_charges ?? [],
		top_grip: overrides.top_grip ?? 'present',
		recent_count: overrides.recent_count ?? 0,
		iron_count: overrides.iron_count ?? 0,
		iron_ids: overrides.iron_ids ?? [],
		last_activity: overrides.last_activity ?? hoursAgo(1),
		theme_summary: overrides.theme_summary ?? '',
		generated_at: overrides.generated_at ?? hoursAgo(0)
	};
}

function makeIronEntry(overrides: Partial<IronGripEntry> = {}): IronGripEntry {
	return {
		id: overrides.id ?? 'obs_iron',
		territory: overrides.territory ?? 'archive',
		summary: overrides.summary ?? 'An old anchor.',
		charges: overrides.charges ?? [],
		pull: overrides.pull ?? 0.8,
		updated: overrides.updated ?? hoursAgo(0)
	};
}

function makeLetter(overrides: Partial<Letter> = {}): Letter {
	return {
		id: overrides.id ?? 'letter_1',
		from_context: overrides.from_context ?? 'rook',
		to_context: overrides.to_context ?? 'chat',
		content: overrides.content ?? 'A short note.',
		timestamp: overrides.timestamp ?? hoursAgo(1),
		read: overrides.read ?? false,
		charges: overrides.charges,
		letter_type: overrides.letter_type
	};
}

function baseStorage(overrides: Record<string, any>) {
	return {
		readOverviews: vi.fn(async () => []),
		readIronGripIndex: vi.fn(async () => []),
		readLetters: vi.fn(async () => []),
		readOpenLoops: vi.fn(async () => []),
		readBrainState: vi.fn(async () => makeState()),
		readSubconscious: vi.fn(async () => null),
		listTasks: vi.fn(async () => []),
		readAllTerritories: vi.fn(async () => []),
		readTerritory: vi.fn(async () => []),
		readLatestWakeLog: vi.fn(async () => null),
		listTaskChangesSince: vi.fn(async () => []),
		listProjectDossiers: vi.fn(async () => []),
		getLimbicConfig: vi.fn(async () => null),
		appendWakeLog: vi.fn(async () => undefined),
		...overrides
	};
}

describe('wake — recent-iron lane (Defect 1)', () => {
	it('surfaces fresh iron/strong grip from the last 7 days, unreachable by pull-ranking, and dedupes against pulling', async () => {
		// 5 old high-pull anchors permanently occupy the 5 pulling slots — this is intentional
		// and must not change. One of them ("obs_dup_iron") also happens to still be within the
		// 7-day window; it must NOT be duplicated into recent_grip.
		const ironIndex = [
			makeIronEntry({ id: 'obs_dup_iron', pull: 0.95, territory: 'fresh' }),
			makeIronEntry({ id: 'obs_old_2', pull: 0.89 }),
			makeIronEntry({ id: 'obs_old_3', pull: 0.85 }),
			makeIronEntry({ id: 'obs_old_4', pull: 0.81 }),
			makeIronEntry({ id: 'obs_old_5', pull: 0.78 })
		];

		const overviews = [
			makeOverview({ territory: 'craft', observation_count: 5, recent_count: 5, last_activity: hoursAgo(2) }),
			makeOverview({ territory: 'fresh', observation_count: 4, recent_count: 0, iron_count: 1, top_grip: 'iron', last_activity: daysAgo(2) }),
			makeOverview({ territory: 'archive', observation_count: 2, recent_count: 0, iron_count: 2, top_grip: 'iron', last_activity: daysAgo(60) })
		];

		// Enough 48h rows in "craft" alone that the adaptive window (Defect 2) does not trigger —
		// keeps this test isolated to Defect 1's behavior.
		const craftObs = Array.from({ length: 5 }, (_, i) => makeObservation({
			id: `obs_craft_${i}`,
			territory: 'craft',
			created: hoursAgo(1)
		}));

		const freshObs = [
			makeObservation({
				id: 'obs_fresh_iron', territory: 'fresh', created: daysAgo(5),
				texture: { salience: 'active', vividness: 'vivid', charge: [], grip: 'iron' }
			}),
			makeObservation({
				id: 'obs_fresh_strong', territory: 'fresh', created: daysAgo(6),
				texture: { salience: 'active', vividness: 'vivid', charge: [], grip: 'strong' }
			}),
			// Same id as a pulling-slot entry — must be excluded from recent_grip.
			makeObservation({
				id: 'obs_dup_iron', territory: 'fresh', created: daysAgo(2),
				texture: { salience: 'active', vividness: 'vivid', charge: [], grip: 'iron' }
			}),
			// Iron, but outside the 7-day window — must be excluded.
			makeObservation({
				id: 'obs_fresh_old', territory: 'fresh', created: daysAgo(10),
				texture: { salience: 'active', vividness: 'vivid', charge: [], grip: 'iron' }
			})
		];

		const readTerritory = vi.fn(async (t: string) => {
			if (t === 'craft') return craftObs;
			if (t === 'fresh') return freshObs;
			throw new Error(`should not read dormant territory: ${t}`);
		});

		const storage = baseStorage({
			readOverviews: vi.fn(async () => overviews),
			readIronGripIndex: vi.fn(async () => ironIndex),
			readTerritory
		});

		const result = await handleWakeTool('mind_wake', { depth: 'quick' }, { storage: storage as any });

		// Existing pull ranking is untouched: the 5 old anchors still occupy pulling, in pull order.
		expect(result.pulling.map((p: any) => p.id)).toEqual([
			'obs_dup_iron', 'obs_old_2', 'obs_old_3', 'obs_old_4', 'obs_old_5'
		]);

		// The dormant "archive" territory (last_activity 60 days ago) is never read.
		expect(readTerritory).not.toHaveBeenCalledWith('archive');

		// Fresh iron/strong within 7 days surfaces in the dedicated lane...
		const recentGripIds = result.recent_grip.map((r: any) => r.id).sort();
		expect(recentGripIds).toEqual(['obs_fresh_iron', 'obs_fresh_strong']);

		// ...but never duplicates a pulling-slot id, and never includes stale iron outside the window.
		expect(recentGripIds).not.toContain('obs_dup_iron');
		expect(recentGripIds).not.toContain('obs_fresh_old');
		expect(result.recent_grip.length).toBeLessThanOrEqual(3);
	});

	it('returns fewer than 3 entries gracefully when fewer than 3 exist', async () => {
		const overviews = [
			makeOverview({ territory: 'fresh', observation_count: 1, recent_count: 0, iron_count: 1, top_grip: 'iron', last_activity: daysAgo(3) }),
			makeOverview({ territory: 'quiet', observation_count: 1, recent_count: 0, last_activity: daysAgo(60) })
		];

		const readTerritory = vi.fn(async (t: string) => {
			if (t === 'fresh') return [makeObservation({
				id: 'obs_only_iron', territory: 'fresh', created: daysAgo(3),
				texture: { salience: 'active', vividness: 'vivid', charge: [], grip: 'iron' }
			})];
			return [];
		});

		const storage = baseStorage({
			readOverviews: vi.fn(async () => overviews),
			readIronGripIndex: vi.fn(async () => []),
			readTerritory
		});

		const result = await handleWakeTool('mind_wake', { depth: 'quick' }, { storage: storage as any });

		expect(result.recent_grip).toHaveLength(1);
		expect(result.recent_grip[0].id).toBe('obs_only_iron');
	});
});

describe('wake — adaptive recent window (Defect 2)', () => {
	it('widens to 7d and flags recent_window when 48h yields fewer than 5 rows', async () => {
		const solo48h = Array.from({ length: 3 }, (_, i) => makeObservation({
			id: `obs_48h_${i}`, territory: 'solo', created: hoursAgo(5)
		}));
		const solo7d = Array.from({ length: 2 }, (_, i) => makeObservation({
			id: `obs_7d_${i}`, territory: 'solo', created: daysAgo(4)
		}));

		const overviews = [
			makeOverview({ territory: 'solo', observation_count: 5, recent_count: 3, last_activity: hoursAgo(5) }),
			makeOverview({ territory: 'quiet', observation_count: 1, recent_count: 0, last_activity: daysAgo(60) })
		];

		const storage = baseStorage({
			readOverviews: vi.fn(async () => overviews),
			readIronGripIndex: vi.fn(async () => []),
			readTerritory: vi.fn(async (t: string) => t === 'solo' ? [...solo48h, ...solo7d] : [])
		});

		const result = await handleWakeTool('mind_wake', { depth: 'quick' }, { storage: storage as any });

		expect(result.recent_window).toBe('7d');
		expect(result.recent.count).toBe(5);
	});

	it('stays at 48h when the 48h window already yields 5 or more rows', async () => {
		const solo48h = Array.from({ length: 6 }, (_, i) => makeObservation({
			id: `obs_48h_${i}`, territory: 'solo', created: hoursAgo(5)
		}));
		const solo7dOnly = makeObservation({ id: 'obs_7d_only', territory: 'solo', created: daysAgo(4) });

		const overviews = [
			makeOverview({ territory: 'solo', observation_count: 7, recent_count: 6, last_activity: hoursAgo(5) }),
			makeOverview({ territory: 'quiet', observation_count: 1, recent_count: 0, last_activity: daysAgo(60) })
		];

		const storage = baseStorage({
			readOverviews: vi.fn(async () => overviews),
			readIronGripIndex: vi.fn(async () => []),
			readTerritory: vi.fn(async (t: string) => t === 'solo' ? [...solo48h, solo7dOnly] : [])
		});

		const result = await handleWakeTool('mind_wake', { depth: 'quick' }, { storage: storage as any });

		expect(result.recent_window).toBe('48h');
		expect(result.recent.count).toBe(6);
		expect(result.recent.observations.map((o: any) => o.id)).not.toContain('obs_7d_only');
	});
});

describe('wake — unread letter preview (Defect 3)', () => {
	it('surfaces sender + a ~100 char preview of the oldest unread letter, without marking it read', async () => {
		const older = makeLetter({
			id: 'letter_old', from_context: 'rook', to_context: 'chat',
			content: 'A'.repeat(150), timestamp: daysAgo(20), read: false
		});
		const newer = makeLetter({
			id: 'letter_new', from_context: 'eli', to_context: 'chat',
			content: 'A shorter, more recent note.', timestamp: hoursAgo(1), read: false
		});
		const alreadyRead = makeLetter({ id: 'letter_read', to_context: 'chat', read: true, timestamp: hoursAgo(2) });
		const wrongContext = makeLetter({ id: 'letter_other', to_context: 'not_chat', read: false, timestamp: hoursAgo(3) });

		const storage = baseStorage({
			readLetters: vi.fn(async () => [newer, older, alreadyRead, wrongContext])
		});

		const result = await handleWakeTool('mind_wake', { depth: 'quick' }, { storage: storage as any });

		expect(result.unread_letters).toBe(2);
		expect(result.unread_letter_preview).toEqual({
			from: 'rook',
			preview: 'A'.repeat(100) + '...',
			timestamp: older.timestamp
		});
		expect(older.read).toBe(false); // read-only — never mutated
	});

	it('is absent when there are no unread letters', async () => {
		const storage = baseStorage({
			readLetters: vi.fn(async () => [makeLetter({ read: true })])
		});

		const result = await handleWakeTool('mind_wake', { depth: 'quick' }, { storage: storage as any });

		expect(result.unread_letters).toBe(0);
		expect(result.unread_letter_preview).toBeNull();
	});
});
