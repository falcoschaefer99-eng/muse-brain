// ============ WAKE TOOLS (v2) ============
// mind_wake (depth: quick/full/orientation), mind_wake_log (action: log/read)

import type { Observation, Letter, OpenLoop, BrainState, SubconsciousState, Task, WakeLogEntry, ProjectDossier } from "../types";
import { TERRITORIES } from "../constants";
import {
	getTimestamp,
	generateId,
	getCurrentCircadianPhase,
	extractEssence,
	toStringArray,
	calculatePullStrength
} from "../helpers";
import type { IBrainStorage } from "../storage/interface";
import type { ToolContext } from "./context";

export const TOOL_DEFS = [
	{
		name: "mind_wake",
		description: "Wake protocol. depth=quick (default): tiered load — iron pulls, recent activity, loops, circadian phase. depth=full: full maintenance cycle (decay + consolidation + wake summary). depth=orientation: identity-first grounding — who am I right now?",
		inputSchema: {
			type: "object",
			properties: {
				depth: {
					type: "string",
					enum: ["quick", "full", "orientation"],
					default: "quick",
					description: "quick: fast tiered wake. full: maintenance + wake. orientation: identity grounding."
				},
				// full depth params
				run_decay: { type: "boolean", default: true, description: "[full] Run decay pass" },
				run_consolidate: { type: "boolean", default: true, description: "[full] Run consolidation" }
			}
		}
	},
	{
		name: "mind_wake_log",
		description: "Log or read autonomous wake history. action=log: record what happened during a wake. action=read: retrieve recent wake history.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["log", "read"],
					default: "read",
					description: "log: record a wake. read: retrieve wake history."
				},
				// log params
				summary: { type: "string", description: "[log] What happened during this wake" },
				actions: { type: "array", items: { type: "string" }, description: "[log] Actions taken" },
				iron_pulls: { type: "array", items: { type: "string" }, description: "[log] IDs of memories that pulled strongest" },
				mood: { type: "string", description: "[log] Mood during this wake" },
				// read params
				limit: { type: "number", default: 10, description: "[read] How many recent entries to return" }
			}
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_wake": {
			const depth = args.depth || "quick";

			if (depth === "orientation") {
				const selfObs = await storage.readTerritory("self");
				const foundational = selfObs.filter(o => o.texture?.salience === "foundational");
				const iron = selfObs.filter(o => o.texture?.grip === "iron");
				const state = await storage.readBrainState();
				const phase = getCurrentCircadianPhase();

				return {
					timestamp: getTimestamp(),
					who_i_am: {
						foundational_count: foundational.length,
						foundational_essences: foundational.slice(0, 5).map(o => extractEssence(o)),
						iron_grip_count: iron.length,
						iron_essences: iron.slice(0, 5).map(o => extractEssence(o))
					},
					current_state: {
						mood: state.current_mood,
						energy: state.energy_level,
						momentum: state.momentum,
						afterglow: state.afterglow
					},
					circadian: phase,
					hint: "Identity grounding complete. Active pulls below."
				};
			}

			if (depth === "full") {
				const runDecay = args.run_decay !== false;
				const runConsolidate = args.run_consolidate !== false;

				const results: any = { timestamp: getTimestamp(), tasks: {} };

				const territoryData = await storage.readAllTerritories();

				if (runDecay) {
					let decayChanges = 0;
					const territoriesToWrite: { territory: string; observations: Observation[] }[] = [];

					for (const { territory, observations: obs } of territoryData) {
						let changed = false;

						for (const o of obs) {
							if (o.texture?.salience === "foundational") continue;

							const lastAccessed = o.last_accessed || o.created;
							if (!lastAccessed) continue;

							const age = (Date.now() - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);

							if (age > 7 && o.texture?.vividness === "crystalline") { o.texture.vividness = "vivid"; changed = true; decayChanges++; }
							else if (age > 30 && o.texture?.vividness === "vivid") { o.texture.vividness = "soft"; changed = true; decayChanges++; }
							else if (age > 90 && o.texture?.vividness === "soft") { o.texture.vividness = "fragmentary"; changed = true; decayChanges++; }

							if (age > 14 && o.texture?.grip === "iron") { o.texture.grip = "strong"; changed = true; decayChanges++; }
							else if (age > 60 && o.texture?.grip === "strong") { o.texture.grip = "present"; changed = true; decayChanges++; }
							else if (age > 120 && o.texture?.grip === "present") { o.texture.grip = "loose"; changed = true; decayChanges++; }
						}

						if (changed) territoriesToWrite.push({ territory, observations: obs });
					}

					await Promise.all(territoriesToWrite.map(({ territory, observations }) =>
						storage.writeTerritory(territory, observations)
					));

					results.tasks.decay = { changes: decayChanges };
				}

				if (runConsolidate) {
					const chargePatterns: Record<string, number> = {};
					for (const { observations: obs } of territoryData) {
						for (const o of obs) {
							for (const c of o.texture?.charge || []) {
								chargePatterns[c] = (chargePatterns[c] || 0) + 1;
							}
						}
					}

					const dominantCharges = Object.entries(chargePatterns)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 10)
						.reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

					results.tasks.consolidate = { dominant_charges: dominantCharges };
				}

				// Include quick wake in results
				const [letters, loops, state, subconscious] = await Promise.all([
					storage.readLetters(),
					storage.readOpenLoops(),
					storage.readBrainState(),
					storage.readSubconscious()
				]);
				results.wake = await finalizeWakePayload(
					storage,
					await runQuickWake(storage, letters, loops, state, subconscious),
					loops,
					"full"
				);

				return results;
			}

			// Default: depth === "quick"
			const [overviews, ironIndex, letters, loops, state, subconscious, openTasks, inProgressTasks, scheduledTasks] = await Promise.all([
				storage.readOverviews(),
				storage.readIronGripIndex(),
				storage.readLetters(),
				storage.readOpenLoops(),
				storage.readBrainState(),
				storage.readSubconscious(),
				storage.listTasks('open', undefined, 200, true),
				storage.listTasks('in_progress', undefined, 200, true),
				storage.listTasks('scheduled', undefined, 200, true)
			]);
			const now = Date.now();
			const pendingTasks = collectPendingTasks(openTasks, inProgressTasks, scheduledTasks, now);

			let quickWake: any;

			// Graceful degradation: fall back to full read if no overviews yet
			if (overviews.length === 0) {
				quickWake = await runQuickWake(storage, letters, loops, state, subconscious, pendingTasks);
			} else {
				const cutoff48h = now - (48 * 60 * 60 * 1000);

				const territories: Record<string, number> = {};
				let totalObs = 0;
				const territoriesWithRecent: string[] = [];

				for (const ov of overviews) {
					territories[ov.territory] = ov.observation_count;
					totalObs += ov.observation_count;
					if (ov.recent_count > 0) territoriesWithRecent.push(ov.territory);
				}

				// All territories active → fall back to full read
				if (territoriesWithRecent.length === overviews.length) {
					quickWake = await runQuickWake(storage, letters, loops, state, subconscious, pendingTasks);
				} else {
					// Load only territories with recent activity
					const recentTerritoryData = await Promise.all(
						territoriesWithRecent.map(async t => ({
							territory: t,
							observations: await storage.readTerritory(t)
						}))
					);

					const recent: any[] = [];
					for (const { territory, observations } of recentTerritoryData) {
						for (const obs of observations) {
							try {
								const created = new Date(obs.created).getTime();
								if (created > cutoff48h) {
									recent.push({
										id: obs.id,
										territory,
										glimpse: obs.content.slice(0, 120) + (obs.content.length > 120 ? "..." : ""),
										charge: obs.texture?.charge || [],
										somatic: obs.texture?.somatic,
										grip: obs.texture?.grip,
										created: obs.created
									});
								}
							} catch { /* skip invalid date */ }
						}
					}
					recent.sort((a, b) => (b.created || "") > (a.created || "") ? 1 : -1);

					// Iron grip from pre-computed index
					const sortedIron = [...ironIndex].sort((a, b) => b.pull - a.pull);
					const topPulls = sortedIron.slice(0, 5).map(entry => ({
						id: entry.id,
						territory: entry.territory,
						summary: entry.summary,
						pull: entry.pull,
						charge: entry.charges
					}));

					const recentCharges: Record<string, number> = {};
					const recentSomatic: Record<string, number> = {};
					for (const r of recent) {
						for (const c of r.charge || []) { recentCharges[c] = (recentCharges[c] || 0) + 1; }
						if (r.somatic) { recentSomatic[r.somatic] = (recentSomatic[r.somatic] || 0) + 1; }
					}

					const activeLoops = loops.filter(l => !["resolved", "abandoned"].includes(l.status));
					const burning = activeLoops.filter(l => l.status === "burning");
					const nagging = activeLoops.filter(l => l.status === "nagging");

					quickWake = {
						timestamp: getTimestamp(),
						state: {
							mood: state.current_mood,
							energy: state.energy_level,
							momentum: state.momentum?.current_charges || [],
							momentum_intensity: state.momentum?.intensity || 0
						},
						circadian: getCurrentCircadianPhase(),
						recent: {
							count: recent.length,
							observations: recent.slice(0, 10),
							patterns: {
								charges: Object.entries(recentCharges).sort((a, b) => b[1] - a[1]).slice(0, 5),
								somatic: Object.entries(recentSomatic).sort((a, b) => b[1] - a[1]).slice(0, 3)
							}
						},
						pulling: topPulls,
						loops: {
							burning: burning.length,
							nagging: nagging.length,
							items: [...burning, ...nagging].slice(0, 5).map(l => ({
								id: l.id,
								status: l.status,
								content: l.content.slice(0, 80)
							}))
						},
						unread_letters: letters.filter(l => !l.read && l.to_context === "chat").length,
						subconscious: subconscious ? {
							hot_entities: subconscious.hot_entities?.slice(0, 3) ?? [],
							mood_inference: subconscious.mood_inference,
							orphan_count: subconscious.orphans?.length || 0
						} : null,
						territories,
						tasks: summarizePendingTasks(pendingTasks),
						summary: {
							total_observations: totalObs,
							iron_grip_total: ironIndex.length,
							hint: "Use mind_pull(id) for full content. mind_link action=chain for cascades.",
							loading: "tiered"
						}
					};
				}
			}

			return finalizeWakePayload(storage, quickWake, loops, "quick");
		}

		case "mind_wake_log": {
			const action = args.action || "read";

			if (action === "log") {
				if (!args.summary) return { error: "summary is required for action=log" };

				const wakeLog = {
					id: generateId("wake"),
					timestamp: getTimestamp(),
					summary: args.summary,
					actions: toStringArray(args.actions),
					iron_pulls: toStringArray(args.iron_pulls),
					mood: args.mood,
					phase: getCurrentCircadianPhase().phase
				};

				await storage.appendWakeLog(wakeLog);

				return { logged: true, id: wakeLog.id, timestamp: wakeLog.timestamp, note: "Wake logged. This builds continuity across sessions." };
			}

			if (action === "read") {
				const logs = await storage.readWakeLog();
				const sorted = logs.sort((a, b) => (b.timestamp || "") > (a.timestamp || "") ? 1 : -1);
				const limited = sorted.slice(0, args.limit || 10);

				return { count: limited.length, total: logs.length, wakes: limited };
			}

			return { error: `Unknown action: ${action}. Must be log or read.` };
		}

		default:
			throw new Error(`Unknown wake tool: ${name}`);
	}
}

// Fallback full-read wake — used when overviews not yet generated, or all territories active.
// Preserves full behavior including novelty pool.
async function runQuickWake(
	storage: IBrainStorage,
	letters: Letter[],
	loops: OpenLoop[],
	state: BrainState,
	subconscious: SubconsciousState | null,
	preloadedPendingTasks?: Task[]
): Promise<any> {
	const pendingTaskPromise = preloadedPendingTasks
		? Promise.resolve(preloadedPendingTasks)
		: Promise.all([
			storage.listTasks('open', undefined, 200, true),
			storage.listTasks('in_progress', undefined, 200, true),
			storage.listTasks('scheduled', undefined, 200, true)
		]).then(([openTasks, inProgressTasks, scheduledTasks]) =>
			collectPendingTasks(openTasks, inProgressTasks, scheduledTasks, Date.now())
		);

	const [territoryData, pendingTasks] = await Promise.all([
		storage.readAllTerritories(),
		pendingTaskPromise
	]);

	const now = Date.now();
	const cutoff48h = now - (48 * 60 * 60 * 1000);

	const territories: Record<string, number> = {};
	const recent: any[] = [];
	const ironGrip: { obs: Observation; territory: string; pull: number }[] = [];
	const noveltyPool: { obs: Observation; territory: string; novelty: number }[] = [];
	let totalObs = 0;

	for (const { territory, observations } of territoryData) {
		territories[territory] = observations.length;
		totalObs += observations.length;

		for (const obs of observations) {
			try {
				const created = new Date(obs.created).getTime();
				if (created > cutoff48h) {
					recent.push({
						id: obs.id,
						territory,
						glimpse: obs.content.slice(0, 120) + (obs.content.length > 120 ? "..." : ""),
						charge: obs.texture?.charge || [],
						somatic: obs.texture?.somatic,
						grip: obs.texture?.grip,
						created: obs.created
					});
				}
			} catch { /* skip */ }

			if (obs.texture?.grip === "iron") {
				ironGrip.push({ obs, territory, pull: calculatePullStrength(obs) });
			}

			const novelty = obs.texture?.novelty_score ?? 0.5;
			if (novelty >= 0.7 && obs.texture?.grip !== "iron") {
				noveltyPool.push({ obs, territory, novelty });
			}
		}
	}

	recent.sort((a, b) => (b.created || "") > (a.created || "") ? 1 : -1);

	noveltyPool.sort((a, b) => b.novelty - a.novelty);
	const topNovelty = noveltyPool.slice(0, 5).map(({ obs, territory, novelty }) => ({
		id: obs.id,
		territory,
		essence: extractEssence(obs),
		novelty,
		charge: obs.texture?.charge || [],
		grip: obs.texture?.grip
	}));

	ironGrip.sort((a, b) => b.pull - a.pull);
	const topPulls = ironGrip.slice(0, 5).map(({ obs, territory, pull }) => ({
		id: obs.id,
		territory,
		summary: obs.summary || extractEssence(obs),
		pull,
		charge: obs.texture?.charge || []
	}));

	const recentCharges: Record<string, number> = {};
	const recentSomatic: Record<string, number> = {};
	for (const r of recent) {
		for (const c of r.charge || []) { recentCharges[c] = (recentCharges[c] || 0) + 1; }
		if (r.somatic) { recentSomatic[r.somatic] = (recentSomatic[r.somatic] || 0) + 1; }
	}

	const activeLoops = loops.filter(l => !["resolved", "abandoned"].includes(l.status));
	const burning = activeLoops.filter(l => l.status === "burning");
	const nagging = activeLoops.filter(l => l.status === "nagging");

	return {
		timestamp: getTimestamp(),
		state: {
			mood: state.current_mood,
			energy: state.energy_level,
			momentum: state.momentum?.current_charges || [],
			momentum_intensity: state.momentum?.intensity || 0
		},
		circadian: getCurrentCircadianPhase(),
		recent: {
			count: recent.length,
			observations: recent.slice(0, 10),
			patterns: {
				charges: Object.entries(recentCharges).sort((a, b) => b[1] - a[1]).slice(0, 5),
				somatic: Object.entries(recentSomatic).sort((a, b) => b[1] - a[1]).slice(0, 3)
			}
		},
		pulling: topPulls,
		novelty: topNovelty,
		loops: {
			burning: burning.length,
			nagging: nagging.length,
			items: [...burning, ...nagging].slice(0, 5).map(l => ({
				id: l.id,
				status: l.status,
				content: l.content.slice(0, 80)
			}))
		},
		unread_letters: letters.filter(l => !l.read && l.to_context === "chat").length,
		subconscious: subconscious ? {
			hot_entities: subconscious.hot_entities?.slice(0, 3) ?? [],
			mood_inference: subconscious.mood_inference,
			orphan_count: subconscious.orphans?.length || 0
		} : null,
		territories,
		tasks: summarizePendingTasks(pendingTasks),
		summary: {
			total_observations: totalObs,
			iron_grip_total: ironGrip.length,
			hint: "Use mind_pull(id) for full content. mind_link action=chain for cascades."
		}
	};
}

type WakeLoopSnapshot = {
	id: string;
	status: string;
	resolved?: string;
};

type StoredWakeSnapshot = {
	loops: WakeLoopSnapshot[];
};

async function finalizeWakePayload(
	storage: IBrainStorage,
	payload: any,
	loops: OpenLoop[],
	depth: "quick" | "full"
): Promise<any> {
	const delta = await buildWakeDelta(storage, loops);
	const finalized = {
		...payload,
		delta
	};

	const wakeLog: WakeLogEntry = {
		id: generateId("wake"),
		timestamp: finalized.timestamp ?? getTimestamp(),
		summary: `auto ${depth} wake`,
		actions: [],
		iron_pulls: Array.isArray(finalized.pulling) ? finalized.pulling.map((item: any) => item.id).filter(Boolean) : [],
		phase: getCurrentCircadianPhase().phase,
		kind: "auto",
		depth,
		snapshot: createWakeSnapshot(loops)
	};

	await storage.appendWakeLog(wakeLog);
	return finalized;
}

async function buildWakeDelta(storage: IBrainStorage, loops: OpenLoop[]): Promise<any> {
	const previousWake = await storage.readLatestWakeLog();
	const since = typeof previousWake?.timestamp === "string" ? previousWake.timestamp : null;

	if (!since) {
		return {
			since: null,
			tasks: { changed: 0, items: [] },
			loops: { changed: 0, items: [] },
			projects: { changed: 0, items: [] }
		};
	}

	const [taskChanges, projectChanges] = await Promise.all([
		storage.listTaskChangesSince(since, 20, true),
		storage.listProjectDossiers({ updated_after: since, limit: 20 })
	]);

	const loopChanges = diffLoopSnapshots(previousWake, loops);
	const projectItems = await hydrateProjectDelta(storage, projectChanges);

	return {
		since,
		tasks: {
			changed: taskChanges.length,
			items: taskChanges.slice(0, 5).map(task => ({
				id: task.id,
				title: task.title,
				status: task.status,
				priority: task.priority,
				assigned_tenant: task.assigned_tenant,
				updated_at: task.updated_at
			}))
		},
		loops: {
			changed: loopChanges.length,
			items: loopChanges.slice(0, 5)
		},
		projects: {
			changed: projectItems.length,
			items: projectItems.slice(0, 5)
		}
	};
}

function createWakeSnapshot(loops: OpenLoop[]): StoredWakeSnapshot {
	return {
		loops: loops.map(loop => ({
			id: loop.id,
			status: loop.status,
			resolved: loop.resolved
		}))
	};
}

function diffLoopSnapshots(previousWake: WakeLogEntry | null, loops: OpenLoop[]) {
	const previousSnapshot = extractWakeSnapshot(previousWake);
	if (!previousSnapshot) return [];

	const previousById = new Map(previousSnapshot.loops.map(loop => [loop.id, loop]));
	const changes = loops.filter(loop => {
		const previous = previousById.get(loop.id);
		if (!previous) return true;
		return previous.status !== loop.status || previous.resolved !== loop.resolved;
	});

	return changes.map(loop => ({
		id: loop.id,
		status: loop.status,
		resolved: loop.resolved,
		content: loop.content.slice(0, 80)
	}));
}

function extractWakeSnapshot(wake: WakeLogEntry | null): StoredWakeSnapshot | null {
	const snapshot = wake?.snapshot as StoredWakeSnapshot | undefined;
	if (!snapshot || !Array.isArray(snapshot.loops)) return null;
	return {
		loops: snapshot.loops
			.filter((loop): loop is WakeLoopSnapshot => !!loop && typeof loop.id === "string" && typeof loop.status === "string")
			.map(loop => ({ id: loop.id, status: loop.status, resolved: loop.resolved }))
	};
}

async function hydrateProjectDelta(storage: IBrainStorage, dossiers: ProjectDossier[]) {
	const projects = await Promise.all(dossiers.map(async dossier => {
		const entity = await storage.findEntityById(dossier.project_entity_id);
		if (!entity) return null;
		return {
			project_entity_id: dossier.project_entity_id,
			name: entity.name,
			lifecycle_status: dossier.lifecycle_status,
			summary: dossier.summary,
			last_active_at: dossier.last_active_at,
			updated_at: dossier.updated_at
		};
	}));

	return projects.filter((project): project is NonNullable<typeof project> => project != null);
}

function collectPendingTasks(openTasks: Task[], inProgressTasks: Task[], scheduledTasks: Task[], nowMs: number): Task[] {
	const uniquePending = new Map<string, Task>();

	for (const task of [...openTasks, ...inProgressTasks]) {
		uniquePending.set(task.id, task);
	}

	for (const task of scheduledTasks) {
		if (task.scheduled_wake != null && new Date(task.scheduled_wake).getTime() <= nowMs) {
			uniquePending.set(task.id, task);
		}
	}

	return Array.from(uniquePending.values()).sort((a, b) => {
		const aStamp = a.status === 'scheduled' ? (a.scheduled_wake ?? a.created_at ?? "") : (a.updated_at ?? a.created_at ?? "");
		const bStamp = b.status === 'scheduled' ? (b.scheduled_wake ?? b.created_at ?? "") : (b.updated_at ?? b.created_at ?? "");
		return bStamp > aStamp ? 1 : -1;
	});
}

function summarizePendingTasks(pendingTasks: Task[]) {
	return {
		pending: pendingTasks.length,
		items: pendingTasks.slice(0, 5).map(task => ({
			id: task.id,
			title: task.title,
			status: task.status,
			priority: task.priority,
			assigned_tenant: task.assigned_tenant,
			scheduled_wake: task.scheduled_wake
		}))
	};
}
