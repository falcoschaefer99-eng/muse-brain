// ============ TERRITORY TOOL (v2) ============
// mind_territory — unified read/list with action dispatch

import { TERRITORIES } from "../constants";
import type { ToolContext } from "./context";

export const TOOL_DEFS = [
	{
		name: "mind_territory",
		description: "Read or list territories. action=list shows all with counts. action=read returns all observations from a specific territory.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "read"],
					default: "list",
					description: "list: show all territories with counts. read: full observations from one territory."
				},
				territory: {
					type: "string",
					enum: Object.keys(TERRITORIES),
					description: "Required when action=read. Which territory to read."
				}
			}
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_territory": {
			const action = args.action || "list";

			if (action === "list") {
				const counts: Record<string, any> = {};
				let total = 0;

				for (const [territory, description] of Object.entries(TERRITORIES)) {
					const obs = await storage.readTerritory(territory);
					counts[territory] = {
						description,
						count: obs.length,
						iron_grip: obs.filter(o => o.texture?.grip === "iron").length,
						foundational: obs.filter(o => o.texture?.salience === "foundational").length
					};
					total += obs.length;
				}

				return { territories: counts, total };
			}

			if (action === "read") {
				if (!args.territory || !Object.keys(TERRITORIES).includes(args.territory)) {
					return { error: `territory is required for action=read. Must be one of: ${Object.keys(TERRITORIES).join(", ")}` };
				}

				const observations = await storage.readTerritory(args.territory);

				return {
					territory: args.territory,
					description: TERRITORIES[args.territory],
					observations: observations.map(o => ({
						id: o.id,
						content: o.content,
						texture: o.texture,
						created: o.created,
						last_accessed: o.last_accessed,
						access_count: o.access_count
					})),
					count: observations.length
				};
			}

			return { error: `Unknown action: ${action}. Must be list or read.` };
		}

		default:
			throw new Error(`Unknown territory tool: ${name}`);
	}
}
