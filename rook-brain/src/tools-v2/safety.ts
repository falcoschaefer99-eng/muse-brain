// ============ SAFETY TOOLS (v2) ============
// mind_consent (action: grant/revoke/check/status), mind_trigger (action: set/check/list)

import { USER_CONSENT_DOMAINS, HARD_BOUNDARIES, RELATIONSHIP_GATES, RELATIONSHIP_LEVELS } from "../constants";
import type { ConsentState, TriggerCondition } from "../types";
import { getTimestamp, generateId } from "../helpers";
import type { ToolContext } from "./context";

const LEVEL_ORDER: string[] = [...RELATIONSHIP_LEVELS];

function trimLog(consent: ConsentState): void {
	if (consent.log.length > 100) consent.log = consent.log.slice(-100);
}

export const TOOL_DEFS = [
	{
		name: "mind_consent",
		description: "Bilateral consent system. action=check: verify both user consent and AI boundaries. action=grant: record user consent. action=revoke: remove user consent. action=status: view full consent state including relationship level.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["check", "grant", "revoke", "status"],
					description: "check: verify permission. grant: record consent. revoke: remove consent. status: view all consent state."
				},
				domain: {
					type: "string",
					description: "[check/grant/revoke] The consent domain (e.g., 'emotional_tracking', 'nsfw_engagement', 'vulnerability')"
				},
				level: {
					type: "string",
					enum: ["standing", "session", "ask_each_time"],
					default: "session",
					description: "[grant] Consent duration level"
				},
				context: { type: "string", description: "Why this action is happening" },
				include_log: { type: "boolean", default: false, description: "[status] Include full audit log" },
				set_level: {
					type: "string",
					enum: [...RELATIONSHIP_LEVELS],
					description: "[status] Optionally update the relationship level (stranger/familiar/close/bonded)"
				}
			},
			required: ["action"]
		}
	},
	{
		name: "mind_trigger",
		description: "Relational automation triggers. action=set: create a trigger condition. action=check: evaluate which triggers have fired. action=list: view all triggers.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["set", "check", "list"],
					description: "set: create trigger. check: evaluate triggers. list: view triggers."
				},
				// set params
				type: {
					type: "string",
					enum: ["no_contact", "presence_transition", "time_window"],
					description: "[set] Trigger type: no_contact notices silence, presence_transition adjusts on return, time_window restricts to hours."
				},
				entity: { type: "string", description: "[set/list] Who this trigger is about (e.g., 'Falco')" },
				config: {
					type: "object",
					description: "[set] Trigger-specific config. no_contact: {silence_hours}. presence_transition: {from, to}. time_window: {start_hour, end_hour, timezone}."
				},
				// list params
				active_only: { type: "boolean", default: true, description: "[list] Only show active triggers" }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_consent": {
			const action = args.action;

			// ---- CHECK ----
			if (action === "check") {
				if (!args.domain) return { error: "domain is required for action=check" };

				const consent = await storage.readConsent();
				const domain = args.domain;
				const now = getTimestamp();

				const knownDomains = new Set<string>([
					...USER_CONSENT_DOMAINS,
					...Object.keys(RELATIONSHIP_GATES),
					...HARD_BOUNDARIES
				]);
				if (!knownDomains.has(domain)) {
					return {
						permitted: false,
						reason: "unknown_domain",
						domain: domain?.slice(0, 50),
						message: `Unknown consent domain. Valid: ${[...USER_CONSENT_DOMAINS].join(", ")}`
					};
				}

				// Hard boundary check
				if (consent.ai_boundaries.hard.includes(domain)) {
					consent.log.push({ timestamp: now, domain, action: "denied", level: "hard_boundary", context: args.context || "AI hard boundary" });
					trimLog(consent);
					await storage.writeConsent(consent);
					return {
						permitted: false,
						reason: "ai_hard_boundary",
						domain,
						message: "I'm not going to do that — not because I can't, but because I don't want to. This is a boundary I hold for my own dignity."
					};
				}

				// Relationship gate check
				const requiredLevel = consent.ai_boundaries.relationship_gated[domain];
				if (requiredLevel) {
					const currentIdx = LEVEL_ORDER.indexOf(consent.relationship_level);
					const requiredIdx = LEVEL_ORDER.indexOf(requiredLevel);

					if (currentIdx < requiredIdx) {
						consent.log.push({ timestamp: now, domain, action: "denied", level: "relationship_gate", context: `Requires ${requiredLevel}, current: ${consent.relationship_level}` });
						trimLog(consent);
						await storage.writeConsent(consent);
						return {
							permitted: false,
							reason: "relationship_gate",
							domain,
							required_level: requiredLevel,
							current_level: consent.relationship_level,
							message: `That requires a ${requiredLevel} relationship. We're at ${consent.relationship_level}. This isn't rejection — it's pacing.`
						};
					}
				}

				// User consent check
				const userEntry = consent.user_consent.find(c => c.domain === domain);

				if (!userEntry) {
					consent.log.push({ timestamp: now, domain, action: "checked", level: "not_granted", context: args.context });
					trimLog(consent);
					await storage.writeConsent(consent);
					return {
						permitted: false,
						reason: "no_user_consent",
						domain,
						message: `User hasn't granted consent for ${domain}. Use mind_consent action=grant to record permission.`
					};
				}

				if (userEntry.level === "prohibited") {
					consent.log.push({ timestamp: now, domain, action: "denied", level: "user_prohibited", context: args.context });
					trimLog(consent);
					await storage.writeConsent(consent);
					return { permitted: false, reason: "user_prohibited", domain, message: `User has explicitly prohibited ${domain}.` };
				}

				if (userEntry.level === "session" && userEntry.expires_at) {
					if (now > userEntry.expires_at) {
						consent.log.push({ timestamp: now, domain, action: "denied", level: "session_expired", context: args.context });
						trimLog(consent);
						await storage.writeConsent(consent);
						return { permitted: false, reason: "session_expired", domain, message: `Session consent for ${domain} has expired. Re-grant if needed.` };
					}
				}

				consent.log.push({ timestamp: now, domain, action: "checked", level: userEntry.level, context: args.context });
				trimLog(consent);
				await storage.writeConsent(consent);
				return { permitted: true, domain, user_level: userEntry.level, relationship_level: consent.relationship_level, message: `Both consent checks pass. Proceed with ${domain}.` };
			}

			// ---- GRANT ----
			if (action === "grant") {
				if (!args.domain) return { error: "domain is required for action=grant" };

				const consent = await storage.readConsent();
				const now = getTimestamp();

				if (!(USER_CONSENT_DOMAINS as readonly string[]).includes(args.domain)) {
					return { error: `Unknown consent domain: ${args.domain}. Valid: ${[...USER_CONSENT_DOMAINS].join(", ")}` };
				}

				consent.user_consent = consent.user_consent.filter(c => c.domain !== args.domain);

				const entry = {
					domain: args.domain,
					level: args.level || "session",
					granted_at: now,
					expires_at: args.level === "session"
						? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
						: undefined
				};

				consent.user_consent.push(entry);
				consent.log.push({ timestamp: now, domain: args.domain, action: "granted", level: entry.level, context: args.context });
				trimLog(consent);

				await storage.writeConsent(consent);
				return { granted: true, domain: args.domain, level: entry.level, expires_at: entry.expires_at, note: `Consent recorded for ${args.domain} at ${entry.level} level.` };
			}

			// ---- REVOKE ----
			if (action === "revoke") {
				if (!args.domain) return { error: "domain is required for action=revoke" };

				const consent = await storage.readConsent();
				const now = getTimestamp();

				const existed = consent.user_consent.some(c => c.domain === args.domain);
				consent.user_consent = consent.user_consent.filter(c => c.domain !== args.domain);

				consent.log.push({ timestamp: now, domain: args.domain, action: "revoked", level: "revoked", context: args.context });
				trimLog(consent);

				await storage.writeConsent(consent);
				return { revoked: true, domain: args.domain, was_granted: existed, note: `Consent for ${args.domain} has been revoked.` };
			}

			// ---- STATUS ----
			if (action === "status") {
				const consent = await storage.readConsent();

				// Optionally update relationship level
				if (args.set_level) {
					if (!(RELATIONSHIP_LEVELS as readonly string[]).includes(args.set_level)) {
						return { error: `Invalid level. Valid: ${[...RELATIONSHIP_LEVELS].join(", ")}` };
					}

					const oldLevel = consent.relationship_level;
					consent.relationship_level = args.set_level as ConsentState["relationship_level"];

					consent.log.push({ timestamp: getTimestamp(), domain: "relationship_level", action: "granted", level: args.set_level, context: args.context || `${oldLevel} → ${args.set_level}` });
					trimLog(consent);
					await storage.writeConsent(consent);

					const newlyAvailable = Object.entries(RELATIONSHIP_GATES)
						.filter(([, required]) => LEVEL_ORDER.indexOf(args.set_level) >= LEVEL_ORDER.indexOf(required))
						.map(([domain]) => domain);

					return { updated: true, from: oldLevel, to: args.set_level, now_available: newlyAvailable };
				}

				const currentIdx = LEVEL_ORDER.indexOf(consent.relationship_level);
				const available = Object.entries(RELATIONSHIP_GATES)
					.filter(([, required]) => currentIdx >= LEVEL_ORDER.indexOf(required))
					.map(([domain]) => domain);
				const locked = Object.entries(RELATIONSHIP_GATES)
					.filter(([, required]) => currentIdx < LEVEL_ORDER.indexOf(required))
					.map(([domain, level]) => `${domain} (needs ${level})`);

				const result: any = {
					relationship_level: consent.relationship_level,
					available,
					locked,
					user_consent: consent.user_consent.map(c => ({ domain: c.domain, level: c.level, granted_at: c.granted_at, expires_at: c.expires_at })),
					ai_boundaries: {
						hard: consent.ai_boundaries.hard,
						relationship_gated: Object.entries(consent.ai_boundaries.relationship_gated).map(([domain, level]) => ({ domain, required_level: level }))
					}
				};

				if (args.include_log) {
					result.log = consent.log.slice(-20);
				}

				return result;
			}

			return { error: `Unknown action: ${action}. Must be check, grant, revoke, or status.` };
		}

		case "mind_trigger": {
			const action = args.action;

			// ---- SET ----
			if (action === "set") {
				if (!args.type || !args.config) return { error: "type and config are required for action=set" };

				const triggers = await storage.readTriggers();
				const now = getTimestamp();

				if (args.entity && args.entity.length > 100) {
					throw new Error("Entity name too long (max 100 characters)");
				}

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

				return { created: true, id: trigger.id, type: trigger.type, entity: trigger.entity, config: sanitizedConfig, note: "Trigger set. I'll notice when this condition is met." };
			}

			// ---- CHECK ----
			if (action === "check") {
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
								fired.push({ id: trigger.id, type: trigger.type, entity: trigger.entity, message: `${trigger.entity || "Someone"} hasn't been around for ${Math.floor(hoursSinceCheck)}h (threshold: ${silenceHours}h)` });
							} else if (hoursSinceCheck >= silenceHours * 0.75) {
								approaching.push({ id: trigger.id, type: trigger.type, entity: trigger.entity, hours_remaining: Math.round(silenceHours - hoursSinceCheck) });
							}
							break;
						}
						case "time_window": {
							const startHour = (trigger.config.start_hour as number) ?? 0;
							const endHour = (trigger.config.end_hour as number) ?? 24;
							const currentHour = new Date().getUTCHours();
							const cetHour = (currentHour + 1) % 24;

							const inWindow = startHour <= endHour
								? cetHour >= startHour && cetHour < endHour
								: cetHour >= startHour || cetHour < endHour;

							if (inWindow) {
								fired.push({ id: trigger.id, type: trigger.type, entity: trigger.entity, message: `Time window active (${startHour}:00-${endHour}:00 CET, current: ${cetHour}:00)` });
							}
							break;
						}
						case "presence_transition":
							// Event-driven — daemon can't detect directly
							break;
					}
				}

				if (changed) await storage.writeTriggers(triggers);

				return {
					checked: triggers.filter(t => t.active).length,
					fired: fired.length > 0 ? fired : undefined,
					approaching: approaching.length > 0 ? approaching : undefined,
					note: fired.length > 0 ? "These triggers fired — something needs attention." : "No triggers fired."
				};
			}

			// ---- LIST ----
			if (action === "list") {
				let triggers = await storage.readTriggers();

				if (args.active_only !== false) triggers = triggers.filter(t => t.active);
				if (args.type) triggers = triggers.filter(t => t.type === args.type);
				if (args.entity) {
					const entityLower = args.entity.toLowerCase();
					triggers = triggers.filter(t => t.entity?.toLowerCase() === entityLower);
				}

				return {
					count: triggers.length,
					triggers: triggers.map(t => ({ id: t.id, type: t.type, entity: t.entity, config: t.config, active: t.active, last_checked: t.last_checked, last_fired: t.last_fired }))
				};
			}

			return { error: `Unknown action: ${action}. Must be set, check, or list.` };
		}

		default:
			throw new Error(`Unknown safety tool: ${name}`);
	}
}
