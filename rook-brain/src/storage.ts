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
	WakeLogEntry
} from "./types";

import { TERRITORIES, VALID_TERRITORIES } from "./constants";
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
	// Note: cross-tenant writes come in Step 6 of the dual-tenant refactor.
	// For now, all letter operations are within this tenant's namespace.

	async readLetters(): Promise<Letter[]> {
		return this.readJsonl<Letter>("correspondence/letters.jsonl");
	}

	async writeLetters(letters: Letter[]): Promise<void> {
		await this.writeJsonl("correspondence/letters.jsonl", letters);
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
}
