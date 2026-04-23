import { describe, expect, it, vi } from "vitest";
import { handleTool as handleMemoryTool } from "../src/tools-v2/memory";
import type { Observation } from "../src/types";

// ============ HELPERS ============

function makeObservation(id: string, created: string, overrides: Partial<Observation> = {}): Observation {
	return {
		id,
		content: overrides.content ?? `observation ${id}`,
		territory: overrides.territory ?? "craft",
		created,
		texture: overrides.texture ?? {
			salience: "active",
			vividness: "vivid",
			charge: [],
			grip: "present",
			charge_phase: "fresh"
		},
		access_count: overrides.access_count ?? 0,
		entity_id: overrides.entity_id,
		tags: overrides.tags,
		summary: overrides.summary
	};
}

function makeEntity(id: string, name: string, tags: string[] = []) {
	return {
		id,
		tenant_id: "rainer",
		name,
		entity_type: "project",
		tags,
		salience: "active",
		primary_context: undefined,
		created_at: "2026-04-01T00:00:00.000Z",
		updated_at: "2026-04-01T00:00:00.000Z"
	};
}

function makeDossier(id: string, entityId: string, metadata: Record<string, unknown> = {}) {
	return {
		id,
		tenant_id: "rainer",
		project_entity_id: entityId,
		lifecycle_status: "active",
		summary: "Test project",
		goals: [],
		constraints: [],
		decisions: [],
		open_questions: [],
		next_actions: [],
		metadata,
		last_active_at: "2026-04-01T00:00:00.000Z",
		created_at: "2026-04-01T00:00:00.000Z",
		updated_at: "2026-04-01T00:00:00.000Z"
	};
}

// ============ TEST 1: Cross-tenant visibility gate (A1 hard gate) ============

describe("loadProjectRegistry cross-tenant visibility gate (A1)", () => {
	it("excludes cross-tenant private projects from lookup results", async () => {
		const privateEntity = makeEntity("ent_private", "Secret Project");
		const privateDossier = makeDossier("dossier_private", "ent_private", { visibility: "private" });

		// The cross-tenant storage — has a private project
		const crossTenantStorage = {
			listProjectDossiers: vi.fn(async () => [privateDossier]),
			findEntityById: vi.fn(async (id: string) => id === "ent_private" ? privateEntity : null)
		};

		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => crossTenantStorage as any),
			listProjectDossiers: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			readAllTerritories: vi.fn(async () => []),
			listTasks: vi.fn(async () => [])
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "lookup",
			keyword: "secret project"
		}, { storage: storage as any });

		// Private cross-tenant project should not appear — lookup falls through to keyword_lookup
		expect(result.search_mode).not.toBe("project_bundle");
		// It may return keyword_lookup or no matches — either way, the private project was not surfaced
		if (result.search_mode === "project_bundle") {
			expect(result.project.entity.id).not.toBe("ent_private");
		}
	});

	it("includes cross-tenant shared projects in lookup results", async () => {
		const sharedEntity = makeEntity("ent_shared", "Shared Atlas", ["atlas"]);
		const sharedDossier = makeDossier("dossier_shared", "ent_shared", { visibility: "shared" });
		const now = Date.now();
		const obs = makeObservation("obs_atlas", new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), {
			content: "Shared Atlas project notes",
			entity_id: "ent_shared"
		});

		const crossTenantStorage = {
			listProjectDossiers: vi.fn(async () => [sharedDossier]),
			findEntityById: vi.fn(async (id: string) => id === "ent_shared" ? sharedEntity : null),
			readAllTerritories: vi.fn(async () => [{ territory: "craft", observations: [obs] }]),
			listTasks: vi.fn(async () => [])
		};

		const storage = {
			getTenant: () => "companion",
			forTenant: vi.fn(() => crossTenantStorage as any),
			listProjectDossiers: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			readAllTerritories: vi.fn(async () => []),
			listTasks: vi.fn(async () => [])
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "lookup",
			keyword: "shared atlas"
		}, { storage: storage as any });

		expect(result.search_mode).toBe("project_bundle");
		expect(result.project.entity.id).toBe("ent_shared");
	});
});

// ============ TEST 2: mind_memory action=lookup ============

describe("mind_memory action=lookup", () => {
	it("returns project_bundle when keyword matches a project", async () => {
		const entity = makeEntity("ent_brain", "Brain Surgery", ["brain"]);
		const dossier = makeDossier("dossier_brain", "ent_brain");
		const now = Date.now();
		const obs = makeObservation("obs_brain", new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(), {
			content: "Brain Surgery project kickoff",
			entity_id: "ent_brain"
		});

		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => ({ ...storage } as any)),
			listProjectDossiers: vi.fn(async () => [dossier]),
			findEntityById: vi.fn(async (id: string) => id === "ent_brain" ? entity : null),
			readAllTerritories: vi.fn(async () => [{ territory: "craft", observations: [obs] }]),
			listTasks: vi.fn(async () => [])
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "lookup",
			keyword: "brain surgery"
		}, { storage: storage as any });

		expect(result.search_mode).toBe("project_bundle");
		expect(result.project.entity.id).toBe("ent_brain");
		expect(result.project.recent_observations).toBeDefined();
	});

	it("returns ambiguity error when two projects score equally (A2 policy)", async () => {
		const entityA = makeEntity("ent_alpha", "Alpha", ["alpha"]);
		const entityB = makeEntity("ent_beta", "Alpha", ["alpha"]);
		const dossierA = makeDossier("dossier_alpha", "ent_alpha");
		const dossierB = makeDossier("dossier_beta", "ent_beta");

		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn(async () => [dossierA, dossierB]),
			findEntityById: vi.fn(async (id: string) => {
				if (id === "ent_alpha") return entityA;
				if (id === "ent_beta") return entityB;
				return null;
			}),
			readAllTerritories: vi.fn(async () => []),
			listTasks: vi.fn(async () => [])
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "lookup",
			keyword: "alpha"
		}, { storage: storage as any });

		expect(result.error).toMatch(/ambiguous/i);
		expect(result.policy).toMatch(/A2/);
		expect(result.candidates).toHaveLength(2);
	});

	it("performs tags-only lookup when keyword is absent but tags are present", async () => {
		const entity = makeEntity("ent_sprint", "Sprint 4.5", ["retrieval", "sprint"]);
		const dossier = makeDossier("dossier_sprint", "ent_sprint");
		const now = Date.now();
		const obs = makeObservation("obs_sprint", new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), {
			content: "Sprint 4.5 retrieval work",
			tags: ["retrieval", "sprint"]
		});

		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn(async () => [dossier]),
			findEntityById: vi.fn(async (id: string) => id === "ent_sprint" ? entity : null),
			readAllTerritories: vi.fn(async () => [{ territory: "craft", observations: [obs] }]),
			listTasks: vi.fn(async () => [])
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "lookup",
			tags: ["retrieval"]
		}, { storage: storage as any });

		// Tags-only lookup falls through to keyword_lookup, not project_bundle
		expect(result.error).toBeUndefined();
		expect(result.search_mode).toBe("keyword_lookup");
		expect(result.count).toBe(1);
		expect(result.observations[0].id).toBe("obs_sprint");
	});

	it("applies grip filter in keyword lookup fallback path", async () => {
		const now = Date.now();
		const ironObs = makeObservation("obs_iron", new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), {
			content: "test project iron grip note",
			texture: { salience: "foundational", vividness: "crystalline", charge: [], grip: "iron", charge_phase: "fresh" }
		});
		const dormantObs = makeObservation("obs_dormant", new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), {
			content: "test project dormant note",
			texture: { salience: "archive", vividness: "faded", charge: [], grip: "dormant", charge_phase: "faded" }
		});

		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			readAllTerritories: vi.fn(async () => [{ territory: "craft", observations: [ironObs, dormantObs] }]),
			readTerritory: vi.fn(async () => [ironObs, dormantObs]),
			listTasks: vi.fn(async () => [])
		};

		// With grip=iron, only iron-grip observations should pass
		const result = await handleMemoryTool("mind_memory", {
			action: "lookup",
			keyword: "test project",
			grip: "iron"
		}, { storage: storage as any });

		expect(result.search_mode).toBe("keyword_lookup");
		const ids = result.observations.map((o: any) => o.id);
		expect(ids).toContain("obs_iron");
		expect(ids).not.toContain("obs_dormant");
	});

	it("returns error when neither keyword nor tags are provided", async () => {
		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "lookup"
		}, { storage: storage as any });

		expect(result.error).toMatch(/keyword or tags/i);
	});

	it("uses getEntityObservations optimized lane when available", async () => {
		const entity = makeEntity("ent_opt", "Optimized Project", ["optimized"]);
		const dossier = makeDossier("dossier_opt", "ent_opt");
		const now = Date.now();
		const obs = makeObservation("obs_opt", new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), {
			content: "Optimized Project note",
			entity_id: "ent_opt"
		});

		const getEntityObservations = vi.fn(async () => [{ observation: obs, territory: "craft" }]);
		const readAllTerritories = vi.fn(async () => [{ territory: "craft", observations: [obs] }]);
		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn(async () => [dossier]),
			findEntitiesByIds: vi.fn(async () => [entity]),
			findEntityById: vi.fn(async () => entity),
			getEntityObservations,
			readAllTerritories,
			hybridSearch: vi.fn(async () => []),
			listTasks: vi.fn(async () => [])
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "lookup",
			keyword: "optimized project",
			limit: 1
		}, { storage: storage as any });

		expect(result.search_mode).toBe("project_bundle");
		expect(getEntityObservations).toHaveBeenCalledWith("ent_opt", 20);
		expect(readAllTerritories).not.toHaveBeenCalled();
	});

	it("does not route archived projects through project_bundle by default", async () => {
		const entity = makeEntity("ent_archived", "Archived Atlas", ["archived", "atlas"]);
		const dossier = {
			...makeDossier("dossier_archived", "ent_archived"),
			lifecycle_status: "archived" as const
		};

		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn(async () => [dossier]),
			findEntitiesByIds: vi.fn(async () => [entity]),
			findEntityById: vi.fn(async () => entity),
			hybridSearch: vi.fn(async () => []),
			queryObservations: vi.fn(async () => []),
			readAllTerritories: vi.fn(async () => []),
			listTasks: vi.fn(async () => [])
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "lookup",
			keyword: "archived atlas"
		}, { storage: storage as any });

		expect(result.error).toBeUndefined();
		expect(result.search_mode).not.toBe("project_bundle");
	});
});

// ============ TEST 3: mind_memory action=recent ============

describe("mind_memory action=recent", () => {
	it("returns action=recent and search_mode=recent when called with days:7", async () => {
		const now = Date.now();
		const storage = {
			hybridSearch: vi.fn(async () => ([
				{
					observation: makeObservation("obs_recent", new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()),
					territory: "craft",
					score: 0.7,
					match_sources: ["keyword"]
				}
			])),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null),
			readAllTerritories: vi.fn(async () => [
				{
					territory: "craft",
					observations: [makeObservation("obs_recent", new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString())]
				}
			])
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "recent",
			days: 7
		}, { storage: storage as any });

		expect(result.action).toBe("recent");
		expect(result.search_mode).toBe("recent");
		expect(result.filter.days).toBe(7);
		expect(result.count).toBe(1);
		expect(result.observations[0].id).toBe("obs_recent");
	});

	it("returns error when neither days nor hours are provided", async () => {
		const storage = {
			getTenant: () => "rainer"
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "recent"
		}, { storage: storage as any });

		expect(result.error).toMatch(/days or hours/i);
	});

	it("returns validation error for negative days (Fix 4)", async () => {
		const storage = {
			getTenant: () => "rainer"
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "recent",
			days: -5
		}, { storage: storage as any });

		expect(result.error).toMatch(/days must be between/i);
	});

	it("returns validation error for negative hours (Fix 4)", async () => {
		const storage = {
			getTenant: () => "rainer"
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "recent",
			hours: -2
		}, { storage: storage as any });

		expect(result.error).toMatch(/hours must be between/i);
	});

	it("returns validation error for zero days (Fix 4)", async () => {
		const storage = {
			getTenant: () => "rainer"
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "recent",
			days: 0
		}, { storage: storage as any });

		expect(result.error).toMatch(/days must be between/i);
	});
});

// ============ TEST 4: Autolink threshold and ambiguity ============

describe("autoLinkProjectEntity threshold and ambiguity in mind_observe", () => {
	it("sets auto_linked_project when content matches one project at high confidence", async () => {
		const entity = makeEntity("ent_muse", "Muse Studio", ["muse", "studio"]);
		const dossier = makeDossier("dossier_muse", "ent_muse");

		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn(async () => [dossier]),
			findEntityById: vi.fn(async (id: string) => id === "ent_muse" ? entity : null),
			findEntityByName: vi.fn(async () => null),
			validateTerritory: vi.fn((t: string) => t || "episodic"),
			appendToTerritory: vi.fn(async () => undefined),
			readBrainState: vi.fn(async () => ({
				momentum: { current_charges: [], intensity: 0, last_updated: "" }
			})),
			writeBrainState: vi.fn(async () => undefined)
		};

		const result = await handleMemoryTool("mind_observe", {
			mode: "observe",
			content: "Working on muse studio improvements today",
			territory: "craft"
		}, { storage: storage as any });

		expect(result.observed).toBe(true);
		expect(result.auto_linked_project).toBeDefined();
		expect(result.auto_linked_project.entity_id).toBe("ent_muse");
		expect(result.auto_linked_project.confidence).toBeGreaterThanOrEqual(0.7);
	});

	it("sets auto_link_notice when two projects are ambiguously matched", async () => {
		const entityA = makeEntity("ent_x", "X Platform", ["x", "platform"]);
		const entityB = makeEntity("ent_y", "X Protocol", ["x", "protocol"]);
		const dossierA = makeDossier("dossier_x", "ent_x");
		const dossierB = makeDossier("dossier_y", "ent_y");

		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn(async () => [dossierA, dossierB]),
			findEntityById: vi.fn(async (id: string) => {
				if (id === "ent_x") return entityA;
				if (id === "ent_y") return entityB;
				return null;
			}),
			findEntityByName: vi.fn(async () => null),
			validateTerritory: vi.fn((t: string) => t || "episodic"),
			appendToTerritory: vi.fn(async () => undefined),
			readBrainState: vi.fn(async () => ({
				momentum: { current_charges: [], intensity: 0, last_updated: "" }
			})),
			writeBrainState: vi.fn(async () => undefined)
		};

		const result = await handleMemoryTool("mind_observe", {
			mode: "observe",
			content: "x update — reviewing the x work",
			territory: "craft"
		}, { storage: storage as any });

		expect(result.observed).toBe(true);
		expect(result.auto_link_notice).toMatch(/ambiguous/i);
		expect(result.auto_linked_project).toBeUndefined();
	});

	it("does not set auto_linked_project when content scores below 0.7", async () => {
		const entity = makeEntity("ent_lowmatch", "Totally Unrelated Thing", ["unrelated"]);
		const dossier = makeDossier("dossier_lowmatch", "ent_lowmatch");

		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn(async () => [dossier]),
			findEntityById: vi.fn(async (id: string) => id === "ent_lowmatch" ? entity : null),
			findEntityByName: vi.fn(async () => null),
			validateTerritory: vi.fn((t: string) => t || "episodic"),
			appendToTerritory: vi.fn(async () => undefined),
			readBrainState: vi.fn(async () => ({
				momentum: { current_charges: [], intensity: 0, last_updated: "" }
			})),
			writeBrainState: vi.fn(async () => undefined)
		};

		const result = await handleMemoryTool("mind_observe", {
			mode: "observe",
			content: "Just a general observation with no project signal",
			territory: "craft"
		}, { storage: storage as any });

		expect(result.observed).toBe(true);
		expect(result.auto_linked_project).toBeUndefined();
	});
});

// ============ TEST 5: mind_memory action=get coverage ============

describe("mind_memory action=get", () => {
	it("retrieves an observation by obs_ prefix", async () => {
		const now = Date.now();
		const obs = makeObservation("obs_abc123", new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), {
			content: "full observation content"
		});

		const storage = {
			findObservation: vi.fn(async (id: string) =>
				id === "obs_abc123" ? { observation: obs, territory: "craft" } : null
			),
			updateObservationAccess: vi.fn(async () => {}),
			readLetters: vi.fn(async () => []),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "get",
			id: "obs_abc123"
		}, { storage: storage as any });

		expect(result.found).toBe(true);
		expect(result.type).toBe("observation");
	});

	it("retrieves a letter by letter_ prefix through the unified path", async () => {
		const letter = {
			id: "letter_abc123",
			from_context: "rook",
			to_context: "chat",
			content: "German v7 updates",
			timestamp: "2026-04-21T22:33:41.000Z",
			read: false,
			letter_type: "handoff" as const
		};

		const storage = {
			findObservation: vi.fn(async () => null),
			getLetterById: vi.fn(async (id: string, recipientContext: string) => id === "letter_abc123" && recipientContext === "chat" ? letter : null),
			readLetters: vi.fn(async () => []),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "get",
			id: "letter_abc123"
		}, { storage: storage as any });

		expect(result.found).toBe(true);
		expect(result.type).toBe("letter");
		expect(result.data.id).toBe("letter_abc123");
		expect(storage.getLetterById).toHaveBeenCalledWith("letter_abc123", "chat");
	});

	it("retrieves a task by task_ prefix", async () => {
		const task = {
			id: "task_xyz",
			tenant_id: "rainer",
			title: "Ship the fix",
			status: "open",
			priority: "high",
			linked_entity_ids: [],
			created_at: "2026-04-14T00:00:00.000Z",
			updated_at: "2026-04-14T00:00:00.000Z"
		};

		const storage = {
			findObservation: vi.fn(async () => null),
			readLetters: vi.fn(async () => []),
			getTask: vi.fn(async (id: string) => id === "task_xyz" ? task : null),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "get",
			id: "task_xyz"
		}, { storage: storage as any });

		expect(result.found).toBe(true);
		expect(result.type).toBe("task");
		expect(result.data.id).toBe("task_xyz");
	});

	it("retrieves a project entity+dossier bundle by ent_ prefix", async () => {
		const entity = makeEntity("ent_proj99", "Project 99");
		const dossier = makeDossier("dossier_proj99", "ent_proj99");

		const storage = {
			findObservation: vi.fn(async () => null),
			readLetters: vi.fn(async () => []),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async (id: string) => id === "ent_proj99" ? entity : null),
			getProjectDossier: vi.fn(async (id: string) => id === "ent_proj99" ? dossier : null)
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "get",
			id: "ent_proj99"
		}, { storage: storage as any });

		expect(result.found).toBe(true);
		expect(result.type).toBe("project");
		expect(result.data.entity.id).toBe("ent_proj99");
		expect(result.data.dossier.id).toBe("dossier_proj99");
	});

	it("returns found:false for a non-existent ID", async () => {
		const storage = {
			findObservation: vi.fn(async () => null),
			readLetters: vi.fn(async () => []),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "get",
			id: "obs_does_not_exist"
		}, { storage: storage as any });

		expect(result.found).toBe(false);
	});
});

describe("mind_pull universal ID resolver", () => {
	it("resolves letter IDs in one call", async () => {
		const letter = {
			id: "letter_123",
			from_context: "rook",
			to_context: "chat",
			content: "handoff payload",
			timestamp: "2026-04-21T22:33:41.000Z",
			read: false
		};

		const storage = {
			getLetterById: vi.fn(async (id: string, recipientContext: string) => id === "letter_123" && recipientContext === "chat" ? letter : null),
			readLetters: vi.fn(async () => []),
			findObservation: vi.fn(async () => null),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_pull", { id: "letter_123" }, { storage: storage as any });
		expect(result.found).toBe(true);
		expect(result.type).toBe("letter");
		expect(result.data.id).toBe("letter_123");
		expect(storage.getLetterById).toHaveBeenCalledWith("letter_123", "chat");
		expect(storage.findObservation).not.toHaveBeenCalled();
	});

	it("scopes letter lookups by provided context", async () => {
		const letter = {
			id: "letter_ctx",
			from_context: "rook",
			to_context: "phone",
			content: "for phone context",
			timestamp: "2026-04-21T22:33:41.000Z",
			read: false
		};
		const storage = {
			getLetterById: vi.fn(async (_id: string, recipientContext: string) => recipientContext === "phone" ? letter : null),
			readLetters: vi.fn(async () => []),
			findObservation: vi.fn(async () => null),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_pull", { id: "letter_ctx", context: "phone" }, { storage: storage as any });

		expect(result.found).toBe(true);
		expect(result.type).toBe("letter");
		expect(storage.getLetterById).toHaveBeenCalledWith("letter_ctx", "phone");
	});

	it("resolves task IDs in one call", async () => {
		const task = {
			id: "task_123",
			tenant_id: "rainer",
			title: "Gate release",
			status: "open",
			priority: "high",
			linked_entity_ids: [],
			created_at: "2026-04-21T22:33:41.000Z",
			updated_at: "2026-04-21T22:33:41.000Z"
		};

		const storage = {
			findObservation: vi.fn(async () => null),
			getTask: vi.fn(async (id: string) => id === "task_123" ? task : null),
			getLetterById: vi.fn(async () => null),
			readLetters: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_pull", { id: "task_123" }, { storage: storage as any });
		expect(result.found).toBe(true);
		expect(result.type).toBe("task");
		expect(result.data.id).toBe("task_123");
		expect(storage.findObservation).not.toHaveBeenCalled();
	});

	it("returns a typed hint for missing letter IDs", async () => {
		const storage = {
			getLetterById: vi.fn(async () => null),
			readLetters: vi.fn(async () => []),
			findObservation: vi.fn(async () => null),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_pull", { id: "letter_missing" }, { storage: storage as any });
		expect(result.error).toMatch(/not found/i);
		expect(result.hint).toMatch(/letter_/i);
		expect(storage.findObservation).not.toHaveBeenCalled();
	});

	it("returns a typed hint for missing task IDs", async () => {
		const storage = {
			getTask: vi.fn(async () => null),
			findObservation: vi.fn(async () => null),
			getLetterById: vi.fn(async () => null),
			readLetters: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_pull", { id: "task_missing" }, { storage: storage as any });
		expect(result.error).toMatch(/not found/i);
		expect(result.hint).toMatch(/task_/i);
		expect(storage.findObservation).not.toHaveBeenCalled();
	});

	it("returns a typed hint for missing entity IDs", async () => {
		const storage = {
			findEntityById: vi.fn(async () => null),
			findObservation: vi.fn(async () => null),
			getLetterById: vi.fn(async () => null),
			readLetters: vi.fn(async () => []),
			getTask: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_pull", { id: "ent_missing" }, { storage: storage as any });
		expect(result.error).toMatch(/not found/i);
		expect(result.hint).toMatch(/ent_/i);
		expect(storage.findObservation).not.toHaveBeenCalled();
	});

	it("covers unprefixed fallback chain letter -> task -> entity", async () => {
		const letter = {
			id: "shared_id",
			from_context: "rook",
			to_context: "chat",
			content: "letter fallback",
			timestamp: "2026-04-21T22:33:41.000Z",
			read: false
		};
		const task = {
			id: "shared_id",
			tenant_id: "rainer",
			title: "task fallback",
			status: "open",
			priority: "normal",
			linked_entity_ids: [],
			created_at: "2026-04-21T22:33:41.000Z",
			updated_at: "2026-04-21T22:33:41.000Z"
		};
		const entity = makeEntity("shared_id", "entity fallback");

		const letterStorage = {
			findObservation: vi.fn(async () => null),
			getLetterById: vi.fn(async () => letter),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null)
		};
		const letterResult = await handleMemoryTool("mind_pull", { id: "shared_id" }, { storage: letterStorage as any });
		expect(letterResult.type).toBe("letter");
		expect(letterStorage.getTask).not.toHaveBeenCalled();
		expect(letterStorage.findEntityById).not.toHaveBeenCalled();

		const taskStorage = {
			findObservation: vi.fn(async () => null),
			getLetterById: vi.fn(async () => null),
			getTask: vi.fn(async () => task),
			findEntityById: vi.fn(async () => null)
		};
		const taskResult = await handleMemoryTool("mind_pull", { id: "shared_id" }, { storage: taskStorage as any });
		expect(taskResult.type).toBe("task");
		expect(taskStorage.findEntityById).not.toHaveBeenCalled();

		const entityStorage = {
			findObservation: vi.fn(async () => null),
			getLetterById: vi.fn(async () => null),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => entity),
			getProjectDossier: vi.fn(async () => null)
		};
		const entityResult = await handleMemoryTool("mind_pull", { id: "shared_id" }, { storage: entityStorage as any });
		expect(entityResult.type).toBe("project");
	});

	it("preserves observation process:true behavior for trimmed IDs", async () => {
		const obs = makeObservation("obs_proc", new Date(Date.now() - 3600_000).toISOString(), {
			content: "processing lane observation",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: ["focus"],
				grip: "present",
				charge_phase: "active"
			}
		});

		const storage = {
			findObservation: vi.fn(async (id: string) => id === "obs_proc" ? { observation: obs, territory: "craft" } : null),
			updateObservationAccess: vi.fn(async () => undefined),
			createProcessingEntry: vi.fn(async () => undefined),
			incrementProcessingCount: vi.fn(async () => 2),
			advanceChargePhase: vi.fn(async () => ({ advanced: true, new_phase: "integrated" })),
			getLetterById: vi.fn(async () => null),
			readLetters: vi.fn(async () => []),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_pull", {
			id: "  obs_proc  ",
			process: true,
			processing_note: "holding this memory",
			charge: ["calm"]
		}, { storage: storage as any });

		expect(result.id).toBe("obs_proc");
		expect(result.processing.recorded).toBe(true);
		expect(result.processing.processing_count).toBe(2);
		expect(result.processing.phase_advanced).toBe(true);
		expect(storage.updateObservationAccess).toHaveBeenCalledWith("obs_proc");
		expect(storage.createProcessingEntry).toHaveBeenCalledWith(expect.objectContaining({
			observation_id: "obs_proc",
			processing_note: "holding this memory",
			charge_at_processing: ["calm"]
		}));
		expect(storage.incrementProcessingCount).toHaveBeenCalledWith("obs_proc");
		expect(storage.advanceChargePhase).toHaveBeenCalledWith("obs_proc");
	});

	it("process:true keeps new_phase absent when phase does not advance", async () => {
		const obs = makeObservation("obs_proc_no_advance", new Date(Date.now() - 3600_000).toISOString(), {
			content: "non-advance processing lane",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: ["focus"],
				grip: "present",
				charge_phase: "active"
			}
		});

		const storage = {
			findObservation: vi.fn(async (id: string) => id === "obs_proc_no_advance" ? { observation: obs, territory: "craft" } : null),
			updateObservationAccess: vi.fn(async () => undefined),
			createProcessingEntry: vi.fn(async () => undefined),
			incrementProcessingCount: vi.fn(async () => 1),
			advanceChargePhase: vi.fn(async () => ({ advanced: false })),
			getLetterById: vi.fn(async () => null),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_pull", {
			id: "obs_proc_no_advance",
			process: true
		}, { storage: storage as any });

		expect(result.processing.recorded).toBe(true);
		expect(result.processing.processing_count).toBe(1);
		expect(result.processing.phase_advanced).toBe(false);
		expect(result.processing.new_phase).toBeUndefined();
	});
});

// ============ TEST 7: Recency through delegation (mind_memory action=search with days) ============

describe("mind_memory action=search with days filter — recency delegation", () => {
	it("only returns observations within the days window", async () => {
		const now = Date.now();
		const recentObs = makeObservation("obs_fresh", new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString());
		const staleObs = makeObservation("obs_stale", new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString());

		const storage = {
			hybridSearch: vi.fn(async () => ([
				{
					observation: recentObs,
					territory: "craft",
					score: 0.8,
					match_sources: ["keyword"]
				},
				{
					observation: staleObs,
					territory: "craft",
					score: 0.85,
					match_sources: ["keyword"]
				}
			])),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_memory", {
			action: "search",
			query: "recent work",
			days: 2
		}, { storage: storage as any });

		const ids = result.observations.map((o: any) => o.id);
		expect(ids).toContain("obs_fresh");
		expect(ids).not.toContain("obs_stale");
	});
});

describe("project registry cache behavior", () => {
	it("reuses registry cache for repeated lookups in the same context", async () => {
		const entity = makeEntity("ent_cache", "Cache Lane", ["cache"]);
		const dossier = makeDossier("dossier_cache", "ent_cache");
		const obs = makeObservation("obs_cache", new Date(Date.now() - 3600_000).toISOString(), {
			content: "Cache Lane update",
			entity_id: "ent_cache"
		});
		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn(async () => [dossier]),
			findEntitiesByIds: vi.fn(async () => [entity]),
			findEntityById: vi.fn(async () => entity),
			getEntityObservations: vi.fn(async () => [{ observation: obs, territory: "craft" }]),
			hybridSearch: vi.fn(async () => []),
			listTasks: vi.fn(async () => [])
		};
		const context = { storage: storage as any };

		const first = await handleMemoryTool("mind_memory", { action: "lookup", keyword: "cache lane", limit: 1 }, context);
		const second = await handleMemoryTool("mind_memory", { action: "lookup", keyword: "cache lane", limit: 1 }, context);

		expect(first.search_mode).toBe("project_bundle");
		expect(second.search_mode).toBe("project_bundle");
		expect(storage.listProjectDossiers).toHaveBeenCalledTimes(1);
	});

	it("evicts failed registry cache entries so retries can recover", async () => {
		const entity = makeEntity("ent_retry", "Retry Lane", ["retry"]);
		const dossier = makeDossier("dossier_retry", "ent_retry");
		const obs = makeObservation("obs_retry", new Date(Date.now() - 3600_000).toISOString(), {
			content: "Retry Lane update",
			entity_id: "ent_retry"
		});
		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => storage as any),
			listProjectDossiers: vi.fn()
				.mockRejectedValueOnce(new Error("temporary failure"))
				.mockResolvedValue([dossier]),
			findEntitiesByIds: vi.fn(async () => [entity]),
			findEntityById: vi.fn(async () => entity),
			getEntityObservations: vi.fn(async () => [{ observation: obs, territory: "craft" }]),
			hybridSearch: vi.fn(async () => []),
			listTasks: vi.fn(async () => [])
		};
		const context = { storage: storage as any };

		await expect(
			handleMemoryTool("mind_memory", { action: "lookup", keyword: "retry lane", limit: 1 }, context)
		).rejects.toThrow(/temporary failure/i);

		const recovered = await handleMemoryTool("mind_memory", { action: "lookup", keyword: "retry lane", limit: 1 }, context);
		expect(recovered.search_mode).toBe("project_bundle");
		expect(storage.listProjectDossiers).toHaveBeenCalledTimes(2);
	});
});

// ============ mind_query validation fixes ============

describe("mind_query input validation (Fix 3 and Fix 4)", () => {
	it("returns error when query exceeds 2000 chars (Fix 3)", async () => {
		const storage = {
			hybridSearch: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_query", {
			query: "x".repeat(2001)
		}, { storage: storage as any });

		expect(result.error).toMatch(/query too long/i);
		expect(storage.hybridSearch).not.toHaveBeenCalled();
	});

	it("accepts query exactly at 2000 chars (Fix 3)", async () => {
		const storage = {
			hybridSearch: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_query", {
			query: "x".repeat(2000)
		}, { storage: storage as any });

		expect(result.error).toBeUndefined();
	});

	it("returns error for negative hours in mind_query (Fix 4)", async () => {
		const storage = {
			hybridSearch: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_query", {
			hours: -1
		}, { storage: storage as any });

		expect(result.error).toMatch(/hours must be between/i);
	});

	it("returns error for hours=0 in mind_query (Fix 4)", async () => {
		const storage = {
			hybridSearch: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_query", {
			hours: 0
		}, { storage: storage as any });

		expect(result.error).toMatch(/hours must be between/i);
	});

	it("returns error for negative days in mind_query (Fix 4)", async () => {
		const storage = {
			hybridSearch: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_query", {
			days: -3
		}, { storage: storage as any });

		expect(result.error).toMatch(/days must be between/i);
	});

	it("returns error for days>90 in mind_query (Fix 4)", async () => {
		const storage = {
			hybridSearch: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_query", {
			days: 91
		}, { storage: storage as any });

		expect(result.error).toMatch(/days must be between/i);
	});

	it("uses queryObservations lane in filter mode before fallback", async () => {
		const now = Date.now();
		const obs = makeObservation("obs_filter_lane", new Date(now - 2 * 60 * 60 * 1000).toISOString(), {
			content: "Filter lane",
			texture: { salience: "active", vividness: "vivid", charge: ["joy"], grip: "strong", charge_phase: "fresh" }
		});
		const storage = {
			queryObservations: vi.fn(async () => [{ observation: obs, territory: "craft" }]),
			readAllTerritories: vi.fn(async () => []),
			readTerritory: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleMemoryTool("mind_query", {
			days: 7,
			sort_by: "recency",
			charge: "joy"
		}, { storage: storage as any });

		expect(storage.queryObservations).toHaveBeenCalledTimes(1);
		expect(storage.readAllTerritories).not.toHaveBeenCalled();
		expect(result.count).toBe(1);
		expect(result.observations[0].id).toBe("obs_filter_lane");
	});
});
