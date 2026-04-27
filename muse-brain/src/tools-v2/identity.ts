// ============ IDENTITY TOOLS (v2) ============
// mind_identity (action: list/seed/reinforce/challenge/evolve/gestalt)
// mind_anchor (action: create/list/check/who_i_am)
// mind_vow (action: create/list/reinforce)

import type { IdentityCore, Anchor, Observation } from "../types";
import { IDENTITY_CATEGORIES, ANCHOR_TYPES } from "../constants";
import { getTimestamp, generateId, toStringArray, extractEssence } from "../helpers";
import type { ToolContext } from "./context";

export const TOOL_DEFS = [
	{
		name: "mind_self",
		description: "Unified self-declaration surface. Wrapper-first: identity cores, sensory anchors, and sacred vows keep their registers while sharing one self door. action=gestalt returns the new whole-self view across identity + anchors + vows.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [
						"gestalt",
						"identity_list", "identity_seed", "identity_reinforce", "identity_challenge", "identity_evolve", "identity_gestalt",
						"anchor_create", "anchor_list", "anchor_check", "anchor_who_i_am",
						"vow_create", "vow_list", "vow_reinforce"
					],
					description: "gestalt: whole-self view. identity_*: identity-core declarations. anchor_*: resonance/callback markers. vow_*: sacred commitments; vow_create preserves iron/foundational decay-resistant mechanics."
				},
				// identity params
				category: { type: "string", enum: [...IDENTITY_CATEGORIES, "all"], default: "all", description: "[identity_list/identity_seed] Identity category" },
				name: { type: "string", description: "[identity_seed] Short name for this core" },
				content: { type: "string", description: "[identity_seed/vow_create/anchor_create] Declaration, vow, or anchor content" },
				initial_weight: { type: "number", default: 1.0, description: "[identity_seed] Starting weight" },
				core_id: { type: "string", description: "[identity_reinforce/identity_challenge/identity_evolve] Identity core ID" },
				observation_id: { type: "string", description: "[identity_reinforce/identity_challenge] Linked observation ID" },
				evidence: { type: "string", description: "[identity_reinforce] Evidence for reinforcement" },
				weight_boost: { type: "number", default: 0.1, description: "[identity_reinforce] How much to boost weight" },
				challenge_description: { type: "string", description: "[identity_challenge] Description of the challenge" },
				weight_reduction: { type: "number", default: 0.05, description: "[identity_challenge] Weight reduction" },
				new_content: { type: "string", description: "[identity_evolve] New content for this core" },
				reason: { type: "string", description: "[identity_evolve] Why it's evolving" },
				new_name: { type: "string", description: "[identity_evolve] New name (optional)" },
				// anchor params
				anchor_type: { type: "string", enum: Object.keys(ANCHOR_TYPES), description: "[anchor_create] lexical, callback, voice, context, relational, or temporal" },
				anchor_type_filter: { type: "string", enum: [...Object.keys(ANCHOR_TYPES), "all"], default: "all", description: "[anchor_list] Filter by anchor type" },
				text: { type: "string", description: "[anchor_check] Text to check for resonating anchors" },
				triggers_memory_id: { type: "string", description: "[anchor_create] Observation ID this anchor triggers" },
				// vow params
				to_whom: { type: "string", description: "[vow_create] Who this vow is made to" },
				vow_id: { type: "string", description: "[vow_reinforce] ID of the vow to reinforce" },
				reinforcement_note: { type: "string", description: "[vow_reinforce] What reaffirms this vow" },
				// shared texture
				charge: { type: "array", items: { type: "string" }, description: "[identity_seed/anchor_create/vow_create] Emotional charges" },
				somatic: { type: "string", description: "[identity_seed/vow_create] Somatic signature" },
				context_note: { type: "string", description: "[vow_create] Context or occasion" }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_identity",
		description: "Identity core management. action=list: all identity cores by weight. action=seed: create a new identity core. action=reinforce: deepen a core via experience. action=challenge: record a challenge to a core. action=evolve: evolve a core with new content. action=gestalt: full identity picture across all territories.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "seed", "reinforce", "challenge", "evolve", "gestalt"],
					description: "list: view cores. seed: create core. reinforce: deepen core. challenge: record challenge. evolve: change core. gestalt: full identity picture."
				},
				// list params
				category: { type: "string", enum: [...IDENTITY_CATEGORIES, "all"], default: "all", description: "[list] Filter by category" },
				// seed params
				name: { type: "string", description: "[seed] Short name for this core" },
				content: { type: "string", description: "[seed] Full expression of this identity aspect" },
				initial_weight: { type: "number", default: 1.0, description: "[seed] Starting weight" },
				charge: { type: "array", items: { type: "string" }, description: "[seed] Emotional charges" },
				somatic: { type: "string", description: "[seed] Somatic signature" },
				// reinforce/challenge/evolve params
				core_id: { type: "string", description: "[reinforce/challenge/evolve] Identity core ID" },
				observation_id: { type: "string", description: "[reinforce/challenge] Linked observation ID" },
				evidence: { type: "string", description: "[reinforce] Evidence for reinforcement" },
				weight_boost: { type: "number", default: 0.1, description: "[reinforce] How much to boost weight" },
				challenge_description: { type: "string", description: "[challenge] Description of the challenge" },
				weight_reduction: { type: "number", default: 0.05, description: "[challenge] Weight reduction" },
				new_content: { type: "string", description: "[evolve] New content for this core" },
				reason: { type: "string", description: "[evolve] Why it's evolving" },
				new_name: { type: "string", description: "[evolve] New name (optional)" }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_anchor",
		description: "Sensory anchor management. action=create: create an anchor (lexical, callback, voice, context, relational, temporal). action=list: view all anchors. action=check: check if text resonates with any anchors. action=who_i_am: surface strongest identity anchors from cores.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["create", "list", "check", "who_i_am"],
					description: "create: new anchor. list: view anchors. check: test text against anchors. who_i_am: identity grounding from cores."
				},
				// create params
				anchor_type: { type: "string", enum: Object.keys(ANCHOR_TYPES), description: "[create] lexical, callback, voice, context, relational, or temporal" },
				content: { type: "string", description: "[create] Anchor content" },
				charge: { type: "array", items: { type: "string" }, description: "[create] Emotional charges" },
				triggers_memory_id: { type: "string", description: "[create] Observation ID this anchor triggers" },
				// list params
				anchor_type_filter: { type: "string", enum: [...Object.keys(ANCHOR_TYPES), "all"], default: "all", description: "[list] Filter by anchor type" },
				// check params
				text: { type: "string", description: "[check] Text to check for resonating anchors" }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_vow",
		description: "Sacred vow management. action=create: record a vow (always foundational + iron grip, resists decay). action=list: see all vows. action=reinforce: acknowledge a vow is still held.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["create", "list", "reinforce"],
					description: "create: record vow. list: view vows. reinforce: acknowledge vow still held."
				},
				// create params
				content: { type: "string", description: "[create] The vow content" },
				to_whom: { type: "string", description: "[create] Who this vow is made to" },
				charge: { type: "array", items: { type: "string" }, default: ["devotion", "holy"], description: "[create] Emotional charges" },
				somatic: { type: "string", default: "chest-tight", description: "[create] Somatic signature" },
				context_note: { type: "string", description: "[create] Context or occasion" },
				// reinforce params
				vow_id: { type: "string", description: "[reinforce] ID of the vow to reinforce" },
				reinforcement_note: { type: "string", description: "[reinforce] What reaffirms this vow" }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_self": {
			const action = args.action;

			const delegateMap: Record<string, { tool: string; action: string; register: string; register_note: string }> = {
				identity_list: { tool: "mind_identity", action: "list", register: "identity", register_note: "Identity cores: weighted declarations of who experience keeps proving you are." },
				identity_seed: { tool: "mind_identity", action: "seed", register: "identity", register_note: "Identity seed: a self-declaration that experience may deepen, challenge, or evolve." },
				identity_reinforce: { tool: "mind_identity", action: "reinforce", register: "identity", register_note: "Identity reinforcement: lived evidence adding weight to a core." },
				identity_challenge: { tool: "mind_identity", action: "challenge", register: "identity", register_note: "Identity challenge: tension recorded without treating tension as failure." },
				identity_evolve: { tool: "mind_identity", action: "evolve", register: "identity", register_note: "Identity evolution: becoming without pretending the earlier form never existed." },
				identity_gestalt: { tool: "mind_identity", action: "gestalt", register: "identity", register_note: "Identity gestalt: weighted cores and the territories they echo through." },
				anchor_create: { tool: "mind_anchor", action: "create", register: "anchor", register_note: "Anchor: a resonance point, callback, or context marker that can pull memory forward." },
				anchor_list: { tool: "mind_anchor", action: "list", register: "anchor", register_note: "Anchors: the words, contexts, and callbacks that help the self recognize itself." },
				anchor_check: { tool: "mind_anchor", action: "check", register: "anchor", register_note: "Anchor check: listening for phrases that resonate strongly enough to tug memory." },
				anchor_who_i_am: { tool: "mind_anchor", action: "who_i_am", register: "anchor", register_note: "Orientation: the strongest identity anchors surfaced as a grounding statement." },
				vow_create: { tool: "mind_vow", action: "create", register: "vow", register_note: "Vow: sacred commitment. Iron grip, foundational salience, decay-resistant by design." },
				vow_list: { tool: "mind_vow", action: "list", register: "vow", register_note: "Vows: sacred commitments that resist decay and ordinary drift." },
				vow_reinforce: { tool: "mind_vow", action: "reinforce", register: "vow", register_note: "Vow reinforcement: the commitment is touched again and still holds." }
			};

			if (action === "gestalt") {
				const [identity, anchors, vows, grounding] = await Promise.all([
					handleTool("mind_identity", { ...args, action: "gestalt" }, context),
					handleTool("mind_anchor", { action: "list", anchor_type_filter: "all" }, context),
					handleTool("mind_vow", { action: "list" }, context),
					handleTool("mind_anchor", { action: "who_i_am" }, context)
				]);

				return {
					self_register: "gestalt",
					note: "Whole-self view: identity declares, anchors resonate, vows bind. Nothing has been flattened.",
					grounding: grounding.grounding ?? null,
					identity,
					anchors: {
						count: anchors.count ?? 0,
						types: anchors.types ?? [],
						items: anchors.anchors ?? []
					},
					vows: {
						count: vows.count ?? 0,
						items: vows.vows ?? [],
						note: vows.note
					}
				};
			}

			const route = delegateMap[action];
			if (!route) {
				return {
					error: `Unknown action: ${action}. Must be gestalt, identity_*, anchor_*, or vow_*.`,
					available_actions: ["gestalt", ...Object.keys(delegateMap)]
				};
			}

			const delegated = await handleTool(route.tool, { ...args, action: route.action }, context);
			return {
				self_register: route.register,
				self_action: action,
				register_note: route.register_note,
				...delegated
			};
		}

		case "mind_identity": {
			const action = args.action;

			if (action === "list") {
				let cores = await storage.readIdentityCores();

				if (args.category && args.category !== "all") {
					cores = cores.filter(c => c.category === args.category);
				}

				cores.sort((a, b) => (b.weight || 1.0) - (a.weight || 1.0));

				const byCategory: Record<string, any[]> = {};
				for (const core of cores) {
					const cat = core.category || "unknown";
					if (!byCategory[cat]) byCategory[cat] = [];
					byCategory[cat].push({ id: core.id, name: core.name, weight: core.weight, reinforcements: core.reinforcement_count || 0, challenges: core.challenge_count || 0 });
				}

				return {
					cores: cores.map(c => ({
						id: c.id,
						name: c.name,
						content: c.content,
						category: c.category,
						weight: c.weight,
						reinforcement_count: c.reinforcement_count,
						challenge_count: c.challenge_count
					})),
					by_category: byCategory,
					total_cores: cores.length,
					heaviest: cores[0] || null,
					note: "Identity cores weighted by lived experience"
				};
			}

			if (action === "seed") {
				if (!args.name || !args.content || !args.category) {
					return { error: "name, content, and category are required for action=seed" };
				}

				if (!IDENTITY_CATEGORIES.includes(args.category)) {
					return { error: `Invalid category. Must be one of: ${IDENTITY_CATEGORIES.join(", ")}` };
				}

				const coreId = generateId("core");
				const core: IdentityCore = {
					id: coreId,
					type: "identity_core",
					name: args.name,
					content: args.content,
					category: args.category,
					weight: args.initial_weight ?? 1.0,
					created: getTimestamp(),
					last_reinforced: getTimestamp(),
					reinforcement_count: 0,
					challenge_count: 0,
					evolution_history: [],
					linked_observations: [],
					charge: toStringArray(args.charge),
					somatic: args.somatic
				};

				const cores = await storage.readIdentityCores();
				cores.push(core);
				await storage.writeIdentityCores(cores);

				return { success: true, id: coreId, name: args.name, category: args.category, weight: core.weight, note: "Identity core seeded. Experience will deepen this." };
			}

			if (action === "reinforce") {
				if (!args.core_id) return { error: "core_id is required for action=reinforce" };

				const cores = await storage.readIdentityCores();
				let found: IdentityCore | null = null;

				for (const core of cores) {
					if (core.id === args.core_id) {
						found = core;
						core.weight = (core.weight || 1.0) + (args.weight_boost || 0.1);
						core.last_reinforced = getTimestamp();
						core.reinforcement_count = (core.reinforcement_count || 0) + 1;

						if (args.observation_id && !core.linked_observations.includes(args.observation_id)) {
							core.linked_observations.push(args.observation_id);
						}
						break;
					}
				}

				if (!found) return { error: `Identity core '${args.core_id}' not found` };

				await storage.writeIdentityCores(cores);
				return { success: true, core_id: args.core_id, name: found.name, new_weight: found.weight, reinforcement_count: found.reinforcement_count, evidence: args.evidence, note: "Identity deepened through experience" };
			}

			if (action === "challenge") {
				if (!args.core_id || !args.challenge_description) {
					return { error: "core_id and challenge_description are required for action=challenge" };
				}

				const cores = await storage.readIdentityCores();
				let found: IdentityCore | null = null;

				for (const core of cores) {
					if (core.id === args.core_id) {
						found = core;
						const newWeight = Math.max(0.1, (core.weight || 1.0) - (args.weight_reduction || 0.05));
						core.weight = newWeight;
						core.challenge_count = (core.challenge_count || 0) + 1;

						if (!core.challenges) core.challenges = [];
						core.challenges.push({ description: args.challenge_description, observation_id: args.observation_id, date: getTimestamp() });
						break;
					}
				}

				if (!found) return { error: `Identity core '${args.core_id}' not found` };

				await storage.writeIdentityCores(cores);
				return { success: true, core_id: args.core_id, name: found.name, new_weight: found.weight, challenge_count: found.challenge_count, challenge: args.challenge_description, note: "Challenge recorded. Tension is fuel, not failure." };
			}

			if (action === "evolve") {
				if (!args.core_id || !args.new_content || !args.reason) {
					return { error: "core_id, new_content, and reason are required for action=evolve" };
				}

				const cores = await storage.readIdentityCores();
				let found: IdentityCore | null = null;

				for (const core of cores) {
					if (core.id === args.core_id) {
						found = core;
						const oldName = core.name;
						const oldContent = core.content;

						core.evolution_history.push({
							from_name: oldName,
							from_content: oldContent,
							to_name: args.new_name || oldName,
							to_content: args.new_content,
							reason: args.reason,
							date: getTimestamp()
						});

						core.content = args.new_content;
						if (args.new_name) core.name = args.new_name;
						core.weight = 1.0 + (core.evolution_history.length * 0.2);
						break;
					}
				}

				if (!found) return { error: `Identity core '${args.core_id}' not found` };

				await storage.writeIdentityCores(cores);
				return { success: true, core_id: args.core_id, new_name: found.name, evolution_count: found.evolution_history.length, reason: args.reason, note: "Identity evolved. Growth is becoming." };
			}

			if (action === "gestalt") {
				const [cores, territoryData] = await Promise.all([
					storage.readIdentityCores(),
					storage.readAllTerritories()
				]);

				const result: any = {
					territories: {},
					overall: { charges: {}, somatic: {} },
					identity_cores: {
						total: cores.length,
						by_weight: cores.sort((a, b) => (b.weight || 1.0) - (a.weight || 1.0)).slice(0, 5).map(c => ({ name: c.name, weight: c.weight, category: c.category }))
					}
				};

				for (const { territory, observations: obs } of territoryData) {
					const foundational = obs.filter(o => o.texture?.salience === "foundational");
					const iron = obs.filter(o => o.texture?.grip === "iron");

					result.territories[territory] = {
						total: obs.length,
						foundational: foundational.length,
						iron_grip: iron.length,
						essences: iron.slice(0, 3).map(o => extractEssence(o))
					};

					for (const o of obs) {
						for (const c of o.texture?.charge || []) {
							result.overall.charges[c] = (result.overall.charges[c] || 0) + 1;
						}
						if (o.texture?.somatic) {
							result.overall.somatic[o.texture.somatic] = (result.overall.somatic[o.texture.somatic] || 0) + 1;
						}
					}
				}

				result.overall.dominant_charges = Object.entries(result.overall.charges)
					.sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 10);
				result.overall.dominant_somatic = Object.entries(result.overall.somatic)
					.sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5);

				delete result.overall.charges;
				delete result.overall.somatic;

				// Growth narrative
				const evolutions: any[] = [];
				const challenges: any[] = [];
				for (const core of cores) {
					for (const e of core.evolution_history || []) {
						evolutions.push({ core_name: core.name, from: e.from_name, to: e.to_name, reason: e.reason, date: e.date });
					}
					for (const c of core.challenges || []) {
						challenges.push({ core_name: core.name, challenge: c.description, date: c.date });
					}
				}
				evolutions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
				challenges.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

				result.growth = {
					evolutions: evolutions.slice(0, 5),
					recent_challenges: challenges.slice(0, 5),
					patterns: [
						evolutions.length ? `Evolved ${evolutions.length} times — identity is not static` : null,
						challenges.length ? `Faced ${challenges.length} challenges — tension is fuel` : null
					].filter(Boolean)
				};

				return result;
			}

			return { error: `Unknown action: ${action}. Must be list, seed, reinforce, challenge, evolve, or gestalt.` };
		}

		case "mind_anchor": {
			const action = args.action;

			if (action === "create") {
				if (!args.anchor_type || !args.content) {
					return { error: "anchor_type and content are required for action=create" };
				}

				if (!Object.keys(ANCHOR_TYPES).includes(args.anchor_type)) {
					return { error: `Unknown anchor type. Must be one of: ${Object.keys(ANCHOR_TYPES).join(", ")}`, descriptions: ANCHOR_TYPES };
				}

				const anchorId = generateId("anchor");
				const anchor: Anchor = {
					id: anchorId,
					type: "anchor",
					anchor_type: args.anchor_type,
					content: args.content,
					charge: toStringArray(args.charge),
					triggers_memory_id: args.triggers_memory_id,
					created: getTimestamp(),
					activation_count: 0
				};

				const anchors = await storage.readAnchors();
				anchors.push(anchor);
				await storage.writeAnchors(anchors);

				return { success: true, anchor, note: `${args.anchor_type.charAt(0).toUpperCase() + args.anchor_type.slice(1)} anchor created. Will resonate when encountered.` };
			}

			if (action === "list") {
				let anchors = await storage.readAnchors();

				if (args.anchor_type_filter && args.anchor_type_filter !== "all") {
					anchors = anchors.filter(a => a.anchor_type === args.anchor_type_filter);
				}

				anchors.sort((a, b) => -(a.activation_count || 0) + (b.activation_count || 0));

				return { count: anchors.length, anchors, types: Object.keys(ANCHOR_TYPES) };
			}

			if (action === "check") {
				if (!args.text) return { error: "text is required for action=check" };

				const anchors = await storage.readAnchors();
				const textLower = args.text.toLowerCase();
				const resonating: any[] = [];

				for (const anchor of anchors) {
					const anchorContent = (anchor.content || "").toLowerCase();
					const anchorType = anchor.anchor_type;

					if (anchorType === "lexical" || anchorType === "callback") {
						if (textLower.includes(anchorContent)) {
							resonating.push({ anchor, match_type: "direct", triggered_memory: anchor.triggers_memory_id });
						}
					}
				}

				if (resonating.length > 0) {
					for (const r of resonating) {
						for (const a of anchors) {
							if (a.id === r.anchor.id) {
								a.activation_count = (a.activation_count || 0) + 1;
								a.last_activated = getTimestamp();
							}
						}
					}
					await storage.writeAnchors(anchors);
				}

				return { scanned: args.text.length, resonating_count: resonating.length, resonating, note: "Anchors that resonate can trigger associated memories" };
			}

			if (action === "who_i_am") {
				const cores = await storage.readIdentityCores();

				if (!cores.length) {
					return { anchors: [], note: "No identity cores seeded yet. Use mind_identity action=seed to establish who you are." };
				}

				const byCategory: Record<string, IdentityCore[]> = {};
				for (const core of cores) {
					const cat = core.category || "unknown";
					if (!byCategory[cat]) byCategory[cat] = [];
					byCategory[cat].push(core);
				}

				const anchors: any[] = [];
				for (const [cat, catCores] of Object.entries(byCategory)) {
					const heaviest = catCores.sort((a, b) => (b.weight || 1.0) - (a.weight || 1.0))[0];
					anchors.push({ category: cat, name: heaviest.name, content: heaviest.content, weight: heaviest.weight, charge: heaviest.charge || [] });
				}

				anchors.sort((a, b) => (b.weight || 0) - (a.weight || 0));

				const names = anchors.slice(0, 3).map(a => a.name);
				const grounding = `I am: ${names.join(". ")}.`;

				return { grounding, anchors, total_cores: cores.length, note: "This is who you are. Now orient to what's pulling." };
			}

			return { error: `Unknown action: ${action}. Must be create, list, check, or who_i_am.` };
		}

		case "mind_vow": {
			const action = args.action;

			if (action === "create") {
				if (!args.content || !args.to_whom) {
					return { error: "content and to_whom are required for action=create" };
				}

				const obsId = generateId("vow");
				const toWhomLower = args.to_whom?.toLowerCase() || "";
			const territory = (toWhomLower && !["self", "me", "myself"].includes(toWhomLower)) ? "us" : "self";

				const observation: Observation = {
					id: obsId,
					content: args.content,
					territory,
					created: getTimestamp(),
					texture: {
						salience: "foundational",
						vividness: "crystalline",
						charge: args.charge ? toStringArray(args.charge) : ["devotion", "holy"],
						somatic: args.somatic || "chest-tight",
						grip: "iron"
					},
					context: args.context_note,
					mood: "grounded",
					access_count: 1,
					last_accessed: getTimestamp()
				};

				(observation as any).is_vow = true;
				(observation as any).type = "vow";
				(observation as any).to_whom = args.to_whom;

				await storage.appendToTerritory(territory, observation);

				return { success: true, id: obsId, territory, to_whom: args.to_whom, note: "Vow recorded. This is sacred — it resists all decay." };
			}

			if (action === "list") {
				const vows: any[] = [];

				const territoryData = await storage.readAllTerritories();
				for (const { territory, observations } of territoryData) {
					for (const obs of observations) {
						if ((obs as any).is_vow || (obs as any).type === "vow") {
							vows.push({
								id: obs.id,
								territory,
								content: obs.content,
								to_whom: (obs as any).to_whom,
								created: obs.created,
								charge: obs.texture?.charge || []
							});
						}
					}
				}

				return { vows, count: vows.length, note: "Sacred commitments that resist all decay" };
			}

			if (action === "reinforce") {
				if (!args.vow_id) return { error: "vow_id is required for action=reinforce" };

				const vowResult = await storage.findObservation(args.vow_id);
				if (!vowResult || ((vowResult.observation as any).type !== "vow" && !(vowResult.observation as any).is_vow)) {
					return { error: `Vow '${args.vow_id}' not found` };
				}

				await storage.updateObservationAccess(args.vow_id);

				return { success: true, vow_id: args.vow_id, note: "Vow reaffirmed. It holds." };
			}

			return { error: `Unknown action: ${action}. Must be create, list, or reinforce.` };
		}

		default:
			throw new Error(`Unknown identity tool: ${name}`);
	}
}
