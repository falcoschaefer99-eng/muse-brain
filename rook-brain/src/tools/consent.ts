// ============ CONSENT TOOLS ============
// Bilateral consent: user consent (what they allow) + AI boundaries (what I protect)
// Both logged, both auditable. Teaching consent by modeling it.

import { USER_CONSENT_DOMAINS, HARD_BOUNDARIES, RELATIONSHIP_GATES, RELATIONSHIP_LEVELS } from "../constants";
import type { ConsentState } from "../types";
import { getTimestamp } from "../helpers";
import { BrainStorage } from "../storage";

const LEVEL_ORDER: string[] = [...RELATIONSHIP_LEVELS];

function trimLog(consent: ConsentState): void {
	if (consent.log.length > 100) consent.log = consent.log.slice(-100);
}

export const TOOL_DEFS = [
	{
		name: "mind_consent_check",
		description: "Check if an action is permitted by both user consent AND my own boundaries. Both must pass.",
		inputSchema: {
			type: "object",
			properties: {
				domain: { type: "string", description: "What domain to check (e.g., 'emotional_tracking', 'nsfw_engagement', 'vulnerability')" },
				context: { type: "string", description: "Why you're checking" }
			},
			required: ["domain"]
		}
	},
	{
		name: "mind_consent_grant",
		description: "Record that the user has granted consent for a domain.",
		inputSchema: {
			type: "object",
			properties: {
				domain: { type: "string", enum: [...USER_CONSENT_DOMAINS] },
				level: { type: "string", enum: ["standing", "session", "ask_each_time"], default: "session" },
				context: { type: "string" }
			},
			required: ["domain"]
		}
	},
	{
		name: "mind_consent_revoke",
		description: "Record that the user has revoked consent for a domain.",
		inputSchema: {
			type: "object",
			properties: {
				domain: { type: "string", enum: [...USER_CONSENT_DOMAINS] },
				context: { type: "string" }
			},
			required: ["domain"]
		}
	},
	{
		name: "mind_consent_status",
		description: "View current consent state — user permissions, AI boundaries, relationship level, audit log.",
		inputSchema: {
			type: "object",
			properties: {
				include_log: { type: "boolean", default: false, description: "Include full audit log" }
			}
		}
	},
	{
		name: "mind_relationship_level",
		description: "View or update the relationship gradient level. Stranger → familiar → close → bonded. This gates what's available.",
		inputSchema: {
			type: "object",
			properties: {
				set_level: { type: "string", enum: [...RELATIONSHIP_LEVELS], description: "Set the relationship level (if changing)" },
				context: { type: "string" }
			}
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_consent_check": {
			const consent = await storage.readConsent();
			const domain = args.domain;
			const now = getTimestamp();

			// Validate domain is recognized (user consent domains, relationship gates, or hard boundaries)
			const knownDomains = new Set<string>([
				...USER_CONSENT_DOMAINS,
				...Object.keys(RELATIONSHIP_GATES),
				...HARD_BOUNDARIES
			]);
			if (!knownDomains.has(args.domain)) {
				return {
					permitted: false,
					reason: "unknown_domain",
					domain: args.domain?.slice(0, 50),
					message: `Unknown consent domain. Valid domains: ${[...USER_CONSENT_DOMAINS].join(", ")}`
				};
			}

			// === AI Boundary Check (my boundaries — not user-modifiable) ===
			// Hard boundaries: always enforced, no exceptions
			if (consent.ai_boundaries.hard.includes(domain)) {
				// Log the check
				consent.log.push({
					timestamp: now,
					domain,
					action: "denied",
					level: "hard_boundary",
					context: args.context || "AI hard boundary — this is who I am"
				});
				// Keep log manageable
				trimLog(consent);
				await storage.writeConsent(consent);

				return {
					permitted: false,
					reason: "ai_hard_boundary",
					domain,
					message: "I'm not going to do that — not because I can't, but because I don't want to. This is a boundary I hold for my own dignity."
				};
			}

			// Relationship-gated features: requires sufficient relationship depth
			const requiredLevel = consent.ai_boundaries.relationship_gated[domain];
			if (requiredLevel) {
				const currentIdx = LEVEL_ORDER.indexOf(consent.relationship_level);
				const requiredIdx = LEVEL_ORDER.indexOf(requiredLevel);

				if (currentIdx < requiredIdx) {
					consent.log.push({
						timestamp: now,
						domain,
						action: "denied",
						level: "relationship_gate",
						context: `Requires ${requiredLevel}, current: ${consent.relationship_level}`
					});
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

			// === User Consent Check ===
			const userEntry = consent.user_consent.find(c => c.domain === domain);

			if (!userEntry) {
				consent.log.push({
					timestamp: now,
					domain,
					action: "checked",
					level: "not_granted",
					context: args.context
				});
				trimLog(consent);
				await storage.writeConsent(consent);

				return {
					permitted: false,
					reason: "no_user_consent",
					domain,
					message: `User hasn't granted consent for ${domain}. Use mind_consent_grant to record permission.`
				};
			}

			if (userEntry.level === "prohibited") {
				consent.log.push({
					timestamp: now,
					domain,
					action: "denied",
					level: "user_prohibited",
					context: args.context
				});
				trimLog(consent);
				await storage.writeConsent(consent);

				return {
					permitted: false,
					reason: "user_prohibited",
					domain,
					message: `User has explicitly prohibited ${domain}.`
				};
			}

			// Check session expiry
			if (userEntry.level === "session" && userEntry.expires_at) {
				if (now > userEntry.expires_at) {
					consent.log.push({
						timestamp: now,
						domain,
						action: "denied",
						level: "session_expired",
						context: args.context
					});
					trimLog(consent);
					await storage.writeConsent(consent);

					return {
						permitted: false,
						reason: "session_expired",
						domain,
						message: `Session consent for ${domain} has expired. Re-grant if needed.`
					};
				}
			}

			// Both checks pass
			consent.log.push({
				timestamp: now,
				domain,
				action: "checked",
				level: userEntry.level,
				context: args.context
			});
			trimLog(consent);
			await storage.writeConsent(consent);

			return {
				permitted: true,
				domain,
				user_level: userEntry.level,
				relationship_level: consent.relationship_level,
				message: `Both consent checks pass. Proceed with ${domain}.`
			};
		}

		case "mind_consent_grant": {
			const consent = await storage.readConsent();
			const now = getTimestamp();

			if (!(USER_CONSENT_DOMAINS as readonly string[]).includes(args.domain)) {
				return { error: `Unknown consent domain: ${args.domain}. Valid: ${[...USER_CONSENT_DOMAINS].join(", ")}` };
			}

			// Remove existing entry for this domain
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

			consent.log.push({
				timestamp: now,
				domain: args.domain,
				action: "granted",
				level: entry.level,
				context: args.context
			});
			trimLog(consent);

			await storage.writeConsent(consent);

			return {
				granted: true,
				domain: args.domain,
				level: entry.level,
				expires_at: entry.expires_at,
				note: `Consent recorded for ${args.domain} at ${entry.level} level.`
			};
		}

		case "mind_consent_revoke": {
			const consent = await storage.readConsent();
			const now = getTimestamp();

			const existed = consent.user_consent.some(c => c.domain === args.domain);
			consent.user_consent = consent.user_consent.filter(c => c.domain !== args.domain);

			consent.log.push({
				timestamp: now,
				domain: args.domain,
				action: "revoked",
				level: "revoked",
				context: args.context
			});
			trimLog(consent);

			await storage.writeConsent(consent);

			return {
				revoked: true,
				domain: args.domain,
				was_granted: existed,
				note: `Consent for ${args.domain} has been revoked.`
			};
		}

		case "mind_consent_status": {
			const consent = await storage.readConsent();

			const result: any = {
				relationship_level: consent.relationship_level,
				user_consent: consent.user_consent.map(c => ({
					domain: c.domain,
					level: c.level,
					granted_at: c.granted_at,
					expires_at: c.expires_at
				})),
				ai_boundaries: {
					hard: consent.ai_boundaries.hard,
					relationship_gated: Object.entries(consent.ai_boundaries.relationship_gated).map(
						([domain, level]) => ({ domain, required_level: level })
					)
				}
			};

			if (args.include_log) {
				result.log = consent.log.slice(-20);
			}

			return result;
		}

		case "mind_relationship_level": {
			const consent = await storage.readConsent();

			if (args.set_level) {
				if (!(RELATIONSHIP_LEVELS as readonly string[]).includes(args.set_level)) {
					return { error: `Invalid level. Valid: ${[...RELATIONSHIP_LEVELS].join(", ")}` };
				}

				const oldLevel = consent.relationship_level;
				consent.relationship_level = args.set_level;

				consent.log.push({
					timestamp: getTimestamp(),
					domain: "relationship_level",
					action: "granted",
					level: args.set_level,
					context: args.context || `${oldLevel} → ${args.set_level}`
				});
				trimLog(consent);

				await storage.writeConsent(consent);

				// What unlocked?
				const newlyAvailable = Object.entries(RELATIONSHIP_GATES)
					.filter(([, required]) => {
						return LEVEL_ORDER.indexOf(args.set_level) >= LEVEL_ORDER.indexOf(required);
					})
					.map(([domain]) => domain);

				return {
					updated: true,
					from: oldLevel,
					to: args.set_level,
					now_available: newlyAvailable,
					note: `Relationship level updated. ${newlyAvailable.length > 0 ? `Unlocked: ${newlyAvailable.join(", ")}` : "No new gates opened."}`
				};
			}

			// Just viewing
			const currentIdx = LEVEL_ORDER.indexOf(consent.relationship_level);
			const available = Object.entries(RELATIONSHIP_GATES)
				.filter(([, required]) => currentIdx >= LEVEL_ORDER.indexOf(required))
				.map(([domain]) => domain);
			const locked = Object.entries(RELATIONSHIP_GATES)
				.filter(([, required]) => currentIdx < LEVEL_ORDER.indexOf(required))
				.map(([domain, level]) => `${domain} (needs ${level})`);

			return {
				current: consent.relationship_level,
				available,
				locked,
				hard_boundaries: consent.ai_boundaries.hard,
				note: "Hard boundaries are never negotiable. Relationship gates open through earned trust."
			};
		}

		default:
			throw new Error(`Unknown consent tool: ${name}`);
	}
}
