// ============ BRAIN STORAGE ============
// Tenant-isolated R2 access. All keys prefixed: {tenant}/{path}
// Imports from types, constants, helpers only.

import type {
	Observation,
	Link,
	OpenLoop,
	BrainState,
	Letter,
	IdentityCore,
	Anchor,
	Desire,
	WakeLogEntry,
	RelationalState,
	SubconsciousState,
	TriggerCondition,
	ConsentState,
	TerritoryOverview,
	IronGripEntry
} from "./types";

import { TERRITORIES, VALID_TERRITORIES, HARD_BOUNDARIES, RELATIONSHIP_GATES } from "./constants";
import { getTimestamp, calculateMomentumDecay, calculateAfterglowFade } from "./helpers";

export class BrainStorage {
	constructor(
		private bucket: R2Bucket,
		private tenant: string
	) {
		// Validate tenant on construction — fail fast, fail loud.
		// DNS label rules: 3-63 chars, lowercase alphanumeric + hyphens, no trailing hyphen.
		// Length cap prevents CPU waste on absurdly long keys (R2 limit is 1024 bytes).
		if (!/^[a-z][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenant)) {
			throw new Error("Invalid tenant ID");
		}
	}

	// ============ KEY CONSTRUCTION ============
	// Central key builder — all R2 access flows through here.
	// Path validation prevents traversal: no ../ segments, no null bytes.

	private key(path: string): string {
		// Reject empty, null-byte, and slash-bounded paths
		if (!path || path.includes('\0') || path.startsWith('/') || path.endsWith('/')) {
			throw new Error("Invalid path");
		}
		// Traversal check — reject any segment that would escape tenant root
		const segments = path.split('/');
		for (const seg of segments) {
			if (seg === '..' || seg === '.') {
				throw new Error("Invalid path: traversal attempt");
			}
		}
		return `${this.tenant}/${path}`;
	}

	// ============ PRIVATE RAW R2 OPERATIONS ============
	// Direct R2 read/write primitives. Never called from outside this class.

	private async readJsonl<T>(path: string): Promise<T[]> {
		const obj = await this.bucket.get(this.key(path));
		if (!obj) return [];
		const text = await obj.text();
		return text.trim().split('\n').filter(line => line && !line.includes('_rook_mind')).map(line => {
			try { return JSON.parse(line); } catch { return null; }
		}).filter((x): x is T => x !== null);
	}

	private async writeJsonl<T>(path: string, items: T[]): Promise<void> {
		const content = items.map(item => JSON.stringify(item)).join('\n');
		await this.bucket.put(this.key(path), content || '');
	}

	private async appendJsonl<T>(path: string, item: T): Promise<void> {
		const existing = await this.readJsonl<T>(path);
		existing.push(item);
		await this.writeJsonl(path, existing);
	}

	private async readJson<T>(path: string, defaultValue: T): Promise<T> {
		const obj = await this.bucket.get(this.key(path));
		if (!obj) return defaultValue;
		try { return JSON.parse(await obj.text()); } catch { return defaultValue; }
	}

	private async writeJson<T>(path: string, data: T): Promise<void> {
		await this.bucket.put(this.key(path), JSON.stringify(data, null, 2));
	}

	// ============ PUBLIC DOMAIN METHODS ============

	// --- Brain State ---

	async readBrainState(): Promise<BrainState> {
		const defaultState: BrainState = {
			current_mood: "neutral",
			energy_level: 0.7,
			last_updated: getTimestamp(),
			momentum: { current_charges: [], intensity: 0, last_updated: getTimestamp() },
			afterglow: { residue_charges: [] }
		};

		const stored = await this.readJson<Partial<BrainState>>("meta/brain_state.json", {});

		// Merge with defaults to ensure all fields exist
		const state: BrainState = {
			current_mood: stored.current_mood ?? defaultState.current_mood,
			energy_level: stored.energy_level ?? defaultState.energy_level,
			last_updated: stored.last_updated ?? defaultState.last_updated,
			momentum: stored.momentum ?? defaultState.momentum,
			afterglow: stored.afterglow ?? defaultState.afterglow
		};

		// Ensure momentum has all required fields
		if (!state.momentum.last_updated) {
			state.momentum.last_updated = getTimestamp();
		}

		// Apply decay — storage is NOT a dumb CRUD wrapper
		state.momentum = calculateMomentumDecay(state.momentum);
		state.afterglow = calculateAfterglowFade(state.afterglow);

		return state;
	}

	async writeBrainState(state: BrainState): Promise<void> {
		state.last_updated = getTimestamp();
		await this.writeJson("meta/brain_state.json", state);
	}

	// --- Territory Validation ---

	validateTerritory(territory: string): string {
		if (!VALID_TERRITORIES.includes(territory)) {
			throw new Error("Invalid territory");
		}
		return territory;
	}

	// --- Territories ---

	async readTerritory(territory: string): Promise<Observation[]> {
		this.validateTerritory(territory);
		return this.readJsonl<Observation>(`territories/${territory}.jsonl`);
	}

	async writeTerritory(territory: string, observations: Observation[]): Promise<void> {
		this.validateTerritory(territory);
		await this.writeJsonl(`territories/${territory}.jsonl`, observations);
	}

	// Parallel read of all territories — use this instead of sequential loops
	async readAllTerritories(): Promise<{ territory: string; observations: Observation[] }[]> {
		return Promise.all(
			Object.keys(TERRITORIES).map(async territory => ({
				territory,
				observations: await this.readTerritory(territory)
			}))
		);
	}

	// Find an observation by ID across all territories (parallel search)
	async findObservation(id: string): Promise<{ observation: Observation; territory: string } | null> {
		const allData = await this.readAllTerritories();
		for (const { territory, observations } of allData) {
			const found = observations.find(o => o.id === id);
			if (found) return { observation: found, territory };
		}
		return null;
	}

	// --- Open Loops ---

	async readOpenLoops(): Promise<OpenLoop[]> {
		return this.readJsonl<OpenLoop>("meta/open_loops.jsonl");
	}

	async writeOpenLoops(loops: OpenLoop[]): Promise<void> {
		await this.writeJsonl("meta/open_loops.jsonl", loops);
	}

	// --- Links ---

	async readLinks(): Promise<Link[]> {
		return this.readJsonl<Link>("links/connections.jsonl");
	}

	async writeLinks(links: Link[]): Promise<void> {
		await this.writeJsonl("links/connections.jsonl", links);
	}

	// --- Letters ---
	// Cross-tenant letter exchange: write to recipient's inbox via forTenant().

	async readLetters(): Promise<Letter[]> {
		return this.readJsonl<Letter>("correspondence/letters.jsonl");
	}

	async writeLetters(letters: Letter[]): Promise<void> {
		await this.writeJsonl("correspondence/letters.jsonl", letters);
	}

	getTenant(): string {
		return this.tenant;
	}

	// --- Cross-Tenant Access ---
	// Creates a BrainStorage scoped to a different tenant (same bucket).
	// Used for cross-brain letters: write to recipient's namespace.
	forTenant(tenant: string): BrainStorage {
		return new BrainStorage(this.bucket, tenant);
	}

	// --- Identity Cores ---

	async readIdentityCores(): Promise<IdentityCore[]> {
		return this.readJsonl<IdentityCore>("identity/cores.jsonl");
	}

	async writeIdentityCores(cores: IdentityCore[]): Promise<void> {
		await this.writeJsonl("identity/cores.jsonl", cores);
	}

	// --- Anchors ---

	async readAnchors(): Promise<Anchor[]> {
		return this.readJsonl<Anchor>("identity/anchors.jsonl");
	}

	async writeAnchors(anchors: Anchor[]): Promise<void> {
		await this.writeJsonl("identity/anchors.jsonl", anchors);
	}

	// --- Desires ---

	async readDesires(): Promise<Desire[]> {
		return this.readJsonl<Desire>("desires/wants.jsonl");
	}

	async writeDesires(desires: Desire[]): Promise<void> {
		await this.writeJsonl("desires/wants.jsonl", desires);
	}

	// --- Wake Log (append-only — no overwrite method by design) ---

	async appendWakeLog(entry: WakeLogEntry): Promise<void> {
		await this.appendJsonl("meta/wake_log.jsonl", entry);
	}

	async readWakeLog(): Promise<WakeLogEntry[]> {
		return this.readJsonl<WakeLogEntry>("meta/wake_log.jsonl");
	}

	// --- Conversation Context ---

	async readConversationContext(): Promise<unknown> {
		return this.readJson<unknown>("meta/conversation_context.json", null);
	}

	async writeConversationContext(context: unknown): Promise<void> {
		await this.writeJson("meta/conversation_context.json", context);
	}

	// --- Raw append for territory (used by mind_link and direct territory appends) ---

	async appendToTerritory(territory: string, observation: Observation): Promise<void> {
		this.validateTerritory(territory);
		await this.appendJsonl(`territories/${territory}.jsonl`, observation);
	}

	async appendLink(link: Link): Promise<void> {
		await this.appendJsonl("links/connections.jsonl", link);
	}

	async appendOpenLoop(loop: OpenLoop): Promise<void> {
		await this.appendJsonl("meta/open_loops.jsonl", loop);
	}

	async appendLetter(letter: Letter): Promise<void> {
		await this.appendJsonl("correspondence/letters.jsonl", letter);
	}

	// --- Relational State ---

	async readRelationalState(): Promise<RelationalState[]> {
		return this.readJsonl<RelationalState>("meta/relational_state.jsonl");
	}

	async writeRelationalState(states: RelationalState[]): Promise<void> {
		await this.writeJsonl("meta/relational_state.jsonl", states);
	}

	// --- Subconscious ---

	async readSubconscious(): Promise<SubconsciousState | null> {
		return this.readJson<SubconsciousState | null>("meta/subconscious.json", null);
	}

	async writeSubconscious(state: SubconsciousState): Promise<void> {
		await this.writeJson("meta/subconscious.json", state);
	}

	// --- Triggers ---

	async readTriggers(): Promise<TriggerCondition[]> {
		return this.readJsonl<TriggerCondition>("meta/triggers.jsonl");
	}

	async writeTriggers(triggers: TriggerCondition[]): Promise<void> {
		await this.writeJsonl("meta/triggers.jsonl", triggers);
	}

	// --- Consent ---

	async readConsent(): Promise<ConsentState> {
		const defaultConsent: ConsentState = {
			user_consent: [],
			ai_boundaries: {
				hard: [...HARD_BOUNDARIES],
				relationship_gated: { ...RELATIONSHIP_GATES }
			},
			relationship_level: "stranger",
			log: []
		};
		return this.readJson<ConsentState>("meta/consent.json", defaultConsent);
	}

	async writeConsent(consent: ConsentState): Promise<void> {
		await this.writeJson("meta/consent.json", consent);
	}

	// --- Backfill Tracking ---

	private validateBackfillVersion(version: string): void {
		if (!/^[a-z0-9]+$/.test(version)) throw new Error("Invalid backfill version");
	}

	async readBackfillFlag(version: string): Promise<unknown> {
		this.validateBackfillVersion(version);
		return this.readJson<unknown>(`meta/backfill_${version}_complete.json`, null);
	}

	async writeBackfillFlag(version: string, data: unknown): Promise<void> {
		this.validateBackfillVersion(version);
		await this.writeJson(`meta/backfill_${version}_complete.json`, data);
	}

	// --- Territory Overviews (Phase B — not yet called by any tool) ---

	async readOverviews(): Promise<TerritoryOverview[]> {
		return this.readJson<TerritoryOverview[]>("meta/overviews.json", []);
	}

	async writeOverviews(overviews: TerritoryOverview[]): Promise<void> {
		await this.writeJson("meta/overviews.json", overviews);
	}

	// --- Iron Grip Index (Phase B — not yet called by any tool. appendIronGripEntry is O(n), cap at ~200 entries) ---

	async readIronGripIndex(): Promise<IronGripEntry[]> {
		return this.readJsonl<IronGripEntry>("meta/iron_grip.jsonl");
	}

	async writeIronGripIndex(entries: IronGripEntry[]): Promise<void> {
		await this.writeJsonl("meta/iron_grip.jsonl", entries);
	}

	async appendIronGripEntry(entry: IronGripEntry): Promise<void> {
		await this.appendJsonl("meta/iron_grip.jsonl", entry);
	}
}
