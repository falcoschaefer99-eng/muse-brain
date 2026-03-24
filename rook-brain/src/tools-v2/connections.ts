// ============ CONNECTIONS TOOLS (v2) ============
// mind_link (action: create/trace/chain), mind_loop (action: open/list/resolve)

import type { Link, Observation, OpenLoop } from "../types";
import { TERRITORIES, RESONANCE_TYPES, LINK_STRENGTHS, LOOP_STATUSES } from "../constants";
import { getTimestamp, generateId, extractEssence, calculatePullStrength } from "../helpers";
import type { ToolContext } from "./context";

export const TOOL_DEFS = [
	{
		name: "mind_link",
		description: "Create or follow resonance links. action=create: link two observations. action=trace: follow the web from a memory (BFS). action=chain: follow associative chain from a memory (finds resonant connections by charge/somatic/content).",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["create", "trace", "chain"],
					description: "create: link two observations. trace: BFS link traversal. chain: associative resonance chain."
				},
				// create params
				source_id: { type: "string", description: "[create] Source observation ID" },
				target_id: { type: "string", description: "[create] Target observation ID" },
				resonance_type: { type: "string", enum: RESONANCE_TYPES, description: "[create] Type of resonance" },
				strength: { type: "string", enum: LINK_STRENGTHS, default: "present", description: "[create] Link strength" },
				bidirectional: { type: "boolean", default: true, description: "[create] Create reverse link too" },
				// trace params
				id: { type: "string", description: "[trace] Observation ID to trace from" },
				depth: { type: "number", default: 2, description: "[trace] Max traversal depth" },
				// chain params
				start_id: { type: "string", description: "[chain] Starting observation ID" },
				max_depth: { type: "number", default: 5, description: "[chain] Max chain length" }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_loop",
		description: "Open loop (Zeigarnik) management. action=open: create an open loop. action=list: see all active loops by urgency. action=resolve: close an open loop.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["open", "list", "resolve"],
					description: "open: create open loop. list: view active loops. resolve: close a loop."
				},
				// open params
				content: { type: "string", description: "[open] What's unfinished" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), default: "self", description: "[open] Territory this loop belongs to" },
				status: { type: "string", enum: LOOP_STATUSES, default: "nagging", description: "[open] Initial urgency" },
				// resolve params
				loop_id: { type: "string", description: "[resolve] ID of the loop to resolve" },
				resolution_note: { type: "string", description: "[resolve] How it was resolved" }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_link": {
			const action = args.action;

			if (action === "create") {
				if (!args.source_id || !args.target_id || !args.resonance_type) {
					return { error: "source_id, target_id, and resonance_type are required for action=create" };
				}

				const link: Link = {
					id: generateId("link"),
					source_id: args.source_id,
					target_id: args.target_id,
					resonance_type: args.resonance_type,
					strength: args.strength || "present",
					origin: "explicit",
					created: getTimestamp(),
					last_activated: getTimestamp()
				};

				await storage.appendLink(link);

				if (args.bidirectional !== false) {
					const reverseLink: Link = {
						...link,
						id: generateId("link"),
						source_id: args.target_id,
						target_id: args.source_id
					};
					await storage.appendLink(reverseLink);
				}

				return { linked: true, id: link.id, type: args.resonance_type, bidirectional: args.bidirectional !== false };
			}

			if (action === "trace") {
				if (!args.id) return { error: "id is required for action=trace" };

				const [links, territoryData] = await Promise.all([
					storage.readLinks(),
					storage.readAllTerritories()
				]);

				const obsMap = new Map<string, { observation: Observation; territory: string }>();
				for (const { territory, observations } of territoryData) {
					for (const obs of observations) {
						obsMap.set(obs.id, { observation: obs, territory });
					}
				}

				const visited = new Set<string>();
				const chain: any[] = [];
				const maxDepth = args.depth || 2;

				function trace(id: string, depth: number) {
					if (depth <= 0 || visited.has(id)) return;
					visited.add(id);

					const found = obsMap.get(id);
					if (found) {
						chain.push({
							id: found.observation.id,
							territory: found.territory,
							essence: extractEssence(found.observation),
							pull: calculatePullStrength(found.observation),
							depth: maxDepth - depth
						});
					}

					const connected = links.filter(l => l.source_id === id);
					for (const link of connected.slice(0, 3)) {
						trace(link.target_id, depth - 1);
					}
				}

				trace(args.id, maxDepth);

				return { root: args.id, chain, total_visited: chain.length };
			}

			if (action === "chain") {
				if (!args.start_id) return { error: "start_id is required for action=chain" };

				const allObs: any[] = [];
				let startObs: any = null;

				const territoryData = await storage.readAllTerritories();
				for (const { territory, observations } of territoryData) {
					for (const obs of observations) {
						const withTerritory = { ...obs, territory };
						allObs.push(withTerritory);
						if (obs.id === args.start_id) {
							startObs = withTerritory;
						}
					}
				}

				if (!startObs) return { error: `Observation ${args.start_id} not found` };

				const maxDepth = args.max_depth || 5;
				const chain: any[] = [{
					step: 0,
					id: startObs.id,
					territory: startObs.territory,
					essence: extractEssence(startObs),
					charges: startObs.texture?.charge || [],
					why: "Starting point"
				}];

				const visited = new Set([args.start_id]);
				let current = startObs;

				for (let step = 1; step <= maxDepth; step++) {
					const currentCharges = new Set(current.texture?.charge || []);
					const currentSomatic = current.texture?.somatic;

					const candidates: any[] = [];
					for (const obs of allObs) {
						if (visited.has(obs.id)) continue;

						let resonance = 0;
						const obsCharges = obs.texture?.charge || [];

						for (const charge of obsCharges) {
							if (currentCharges.has(charge)) resonance += 0.3;
						}

						if (currentSomatic && obs.texture?.somatic === currentSomatic) resonance += 0.2;

						const currentWords = new Set(current.content.toLowerCase().split(/\W+/).filter((w: string) => w.length > 4));
						const obsWords = obs.content.toLowerCase().split(/\W+/).filter((w: string) => w.length > 4);
						for (const word of obsWords) {
							if (currentWords.has(word)) resonance += 0.1;
						}

						if (resonance > 0.25) candidates.push({ obs, resonance });
					}

					if (candidates.length === 0) break;

					candidates.sort((a, b) => b.resonance - a.resonance);
					const next = candidates[0].obs;
					visited.add(next.id);
					current = next;

					chain.push({
						step,
						id: next.id,
						territory: next.territory,
						essence: extractEssence(next),
						charges: next.texture?.charge || [],
						why: `Resonance: ${Math.round(candidates[0].resonance * 100)}%`
					});
				}

				return { start_id: args.start_id, chain, depth_achieved: chain.length - 1, hint: "Use mind_pull(id) for full content of any node" };
			}

			return { error: `Unknown action: ${action}. Must be create, trace, or chain.` };
		}

		case "mind_loop": {
			const action = args.action;

			if (action === "open") {
				if (!args.content) return { error: "content is required for action=open" };

				const loop: OpenLoop = {
					id: generateId("loop"),
					content: args.content,
					status: args.status || "nagging",
					territory: storage.validateTerritory(args.territory || "self"),
					created: getTimestamp()
				};

				await storage.appendOpenLoop(loop);
				return { created: true, id: loop.id, status: loop.status };
			}

			if (action === "list") {
				const loops = await storage.readOpenLoops();
				const active = loops.filter(l => !["resolved", "abandoned"].includes(l.status));

				const statusOrder: Record<string, number> = { burning: 0, nagging: 1, background: 2 };
				active.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));

				return {
					total_active: active.length,
					loops: active.map(l => ({ id: l.id, content: l.content, status: l.status, territory: l.territory, created: l.created }))
				};
			}

			if (action === "resolve") {
				if (!args.loop_id) return { error: "loop_id is required for action=resolve" };

				const loops = await storage.readOpenLoops();
				const idx = loops.findIndex(l => l.id === args.loop_id);

				if (idx === -1) return { resolved: false, error: "Loop not found" };

				loops[idx].status = "resolved";
				loops[idx].resolved = getTimestamp();
				loops[idx].resolution_note = args.resolution_note;

				await storage.writeOpenLoops(loops);
				return { resolved: true, id: args.loop_id };
			}

			return { error: `Unknown action: ${action}. Must be open, list, or resolve.` };
		}

		default:
			throw new Error(`Unknown connections tool: ${name}`);
	}
}
