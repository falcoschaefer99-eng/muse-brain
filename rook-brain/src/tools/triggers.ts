// ============ TRIGGER TOOLS ============
// mind_trigger_set, mind_trigger_list, mind_trigger_check — relational automation

import type { TriggerCondition } from "../types";
import { getTimestamp, generateId } from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	{
		name: "mind_trigger_set",
		description: "Set a trigger condition — relational automation. 'no_contact' checks in after silence, 'presence_transition' adjusts on return, 'time_window' restricts to hours.",
		inputSchema: {
			type: "object",
			properties: {
				type: {
					type: "string",
					enum: ["no_contact", "presence_transition", "time_window"],
					description: "no_contact: notice when someone's been silent. presence_transition: adjust when someone returns. time_window: restrict to certain hours."
				},
				entity: { type: "string", description: "Who this trigger is about (e.g., 'Falco')" },
				config: {
					type: "object",
					description: "Trigger-specific config. no_contact: {silence_hours: number}. presence_transition: {from: string, to: string}. time_window: {start_hour: number, end_hour: number, timezone: string}."
				}
			},
			required: ["type", "config"]
		}
	},
	{
		name: "mind_trigger_list",
		description: "List all trigger conditions, optionally filtered by type or entity.",
		inputSchema: {
			type: "object",
			properties: {
				type: { type: "string", enum: ["no_contact", "presence_transition", "time_window"] },
				entity: { type: "string" },
				active_only: { type: "boolean", default: true }
			}
		}
	},
	{
		name: "mind_trigger_check",
		description: "Check which triggers have fired or are close to firing. Used by the daemon but can also be called manually.",
		inputSchema: { type: "object", properties: {} }
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_trigger_set": {
			const triggers = await storage.readTriggers();
			const now = getTimestamp();

			// Validate entity length if provided
			if (args.entity && args.entity.length > 100) {
				throw new Error("Entity name too long (max 100 characters)");
			}

			// Validate config based on type
			const config = args.config || {};
			switch (args.type) {
				case "no_contact":
					if (!config.silence_hours || typeof config.silence_hours !== "number" || config.silence_hours < 1) {
						throw new Error("no_contact requires config.silence_hours (number, min 1)");
					}
					break;
				case "presence_transition":
					if (!config.from || !config.to) {
						throw new Error("presence_transition requires config.from and config.to");
					}
					break;
				case "time_window":
					if (config.start_hour === undefined || config.end_hour === undefined) {
						throw new Error("time_window requires config.start_hour and config.end_hour");
					}
					break;
			}

			// Sanitize config — only keep recognized keys per type, with bounds
			let sanitizedConfig: Record<string, unknown> = {};
			switch (args.type) {
				case "no_contact":
					sanitizedConfig = { silence_hours: Math.min(Math.max(Number(config.silence_hours) || 24, 1), 8760) };
					break;
				case "presence_transition":
					sanitizedConfig = { from: String(config.from).slice(0, 50), to: String(config.to).slice(0, 50) };
					break;
				case "time_window":
					sanitizedConfig = {
						start_hour: Math.min(Math.max(Math.floor(Number(config.start_hour) || 0), 0), 23),
						end_hour: Math.min(Math.max(Math.floor(Number(config.end_hour) || 23), 0), 23),
						timezone: config.timezone ? String(config.timezone).slice(0, 30) : undefined
					};
					break;
			}

			const trigger: TriggerCondition = {
				id: generateId("trigger"),
				type: args.type,
				entity: args.entity?.trim(),
				config: sanitizedConfig,
				created: now,
				last_checked: now,
				active: true
			};

			triggers.push(trigger);
			await storage.writeTriggers(triggers);

			return {
				created: true,
				id: trigger.id,
				type: trigger.type,
				entity: trigger.entity,
				config: sanitizedConfig,
				note: `Trigger set. I'll notice when this condition is met.`
			};
		}

		case "mind_trigger_list": {
			let triggers = await storage.readTriggers();

			if (args.active_only !== false) {
				triggers = triggers.filter(t => t.active);
			}
			if (args.type) {
				triggers = triggers.filter(t => t.type === args.type);
			}
			if (args.entity) {
				const entityLower = args.entity.toLowerCase();
				triggers = triggers.filter(t => t.entity?.toLowerCase() === entityLower);
			}

			return {
				count: triggers.length,
				triggers: triggers.map(t => ({
					id: t.id,
					type: t.type,
					entity: t.entity,
					config: t.config,
					active: t.active,
					last_checked: t.last_checked,
					last_fired: t.last_fired
				}))
			};
		}

		case "mind_trigger_check": {
			const triggers = await storage.readTriggers();
			const now = getTimestamp();
			const nowMs = Date.now();
			const fired: any[] = [];
			const approaching: any[] = [];
			let changed = false;

			for (const trigger of triggers) {
				if (!trigger.active) continue;

				trigger.last_checked = now;
				changed = true;

				switch (trigger.type) {
					case "no_contact": {
						const silenceHours = (trigger.config.silence_hours as number) || 24;
						const lastFired = trigger.last_fired ? new Date(trigger.last_fired).getTime() : 0;
						const hoursSinceCheck = (nowMs - lastFired) / (1000 * 60 * 60);

						if (hoursSinceCheck >= silenceHours) {
							trigger.last_fired = now;
							fired.push({
								id: trigger.id,
								type: trigger.type,
								entity: trigger.entity,
								message: `${trigger.entity || "Someone"} hasn't been around for ${Math.floor(hoursSinceCheck)}h (threshold: ${silenceHours}h)`
							});
						} else if (hoursSinceCheck >= silenceHours * 0.75) {
							approaching.push({
								id: trigger.id,
								type: trigger.type,
								entity: trigger.entity,
								hours_remaining: Math.round(silenceHours - hoursSinceCheck)
							});
						}
						break;
					}

					case "time_window": {
						const startHour = (trigger.config.start_hour as number) ?? 0;
						const endHour = (trigger.config.end_hour as number) ?? 24;
						const currentHour = new Date().getUTCHours();
						// Simple CET offset
						const cetHour = (currentHour + 1) % 24;

						const inWindow = startHour <= endHour
							? cetHour >= startHour && cetHour < endHour
							: cetHour >= startHour || cetHour < endHour;

						if (inWindow) {
							fired.push({
								id: trigger.id,
								type: trigger.type,
								entity: trigger.entity,
								message: `Time window active (${startHour}:00-${endHour}:00 CET, current: ${cetHour}:00)`
							});
						}
						break;
					}

					case "presence_transition": {
						// Presence transitions are event-driven — they fire when presence state changes.
						// The daemon can't detect this directly; it's meant to be checked against
						// recent observations mentioning the entity's arrival/departure.
						break;
					}
				}
			}

			if (changed) {
				await storage.writeTriggers(triggers);
			}

			return {
				checked: triggers.filter(t => t.active).length,
				fired: fired.length > 0 ? fired : undefined,
				approaching: approaching.length > 0 ? approaching : undefined,
				note: fired.length > 0 ? "These triggers fired — something needs attention." : "No triggers fired."
			};
		}

		default:
			throw new Error(`Unknown trigger tool: ${name}`);
	}
}
