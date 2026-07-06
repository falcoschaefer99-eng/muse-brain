## Review: Michael — Security
**Verdict: FAIL — the vault has no lock. There is no key→tenant binding at all. Path B Slice 1 (per-companion brain keys) cannot land until the server derives tenant FROM the key.**

**Files reviewed (this session):**
- `/Users/falco/AI/muse-brain/muse-brain/src/index.ts` (worker entry, auth, tenant resolution)
- `/Users/falco/AI/muse-brain/muse-brain/src/constants.ts` (ALLOWED_TENANTS, territories)
- `/Users/falco/AI/muse-brain/muse-brain/src/types.ts` (Env shape)
- `/Users/falco/AI/muse-brain/muse-brain/src/storage/factory.ts`, `storage/postgres.ts`, `storage/interface.ts` (tenant scoping)
- `/Users/falco/AI/muse-brain/muse-brain/src/tools-v2/comms.ts` (mind_letter cross-brain), `runtime.ts`, `memory.ts` (cross-tenant params)
- `/Users/falco/AI/muse-brain/muse-brain/{.env.example,.dev.vars.example,wrangler.jsonc.example}`
- `/Users/falco/AI/rook-memory/cloud_brain_proxy.py` (client proxy)
**Mode:** Deep Review (gating, single UNVERIFIED item closure)

---

### 1. Key→tenant binding — traced

**There is exactly ONE key, and tenant is a free header parameter. The tenant is NOT derived from the key — it is supplied by the caller and trusted after format-validation only.**

- Auth validates the bearer token against a **single global secret** `env.API_KEY`, timing-safe compare, one value for the whole service: `index.ts:162-181` (`configuredKey = env.API_KEY`). `Env.API_KEY` is a single string — `types.ts:7`. No per-tenant key exists anywhere: `grep` for `*_KEY` across `src/` returns only `API_KEY` and unrelated cache keys.
- Tenant is resolved **solely from the `X-Brain-Tenant` request header**, defaulting to `"rainer"` when absent: `index.ts:62-75` (`resolveTenantFromHeader`), read at `index.ts:64` (`request.headers.get("X-Brain-Tenant")`).
- That header-derived tenant is passed straight into storage construction: `index.ts:103` (`createStorage(resolveStorageConfig(env), tenant)`) → `factory.ts` → `postgres.ts` constructor `:315-321`, and every query is scoped `WHERE tenant_id = ${this.tenant}` (`postgres.ts:365`, `:399-400`, and throughout).

**Conclusion:** the DB-layer isolation is real and correct *given a tenant value* — but the tenant value has no cryptographic relationship to the key. The client proxy proves the model: it presents `Authorization: Bearer ${ROOK_BRAIN_KEY}` **and** `X-Brain-Tenant: ${current_tenant}` as independent, caller-controlled headers (`cloud_brain_proxy.py:36-37`). The key names *who may talk to the service*; the header names *whose memory to touch*. They are decoupled.

**Direct answer to the question:** There is no separate "ROOK key" and "RAINER key." A single key unlocks the whole service, and the caller then names the tenant. Anyone holding that one key can set `X-Brain-Tenant: rainer` and read/write RAINER's entire memory, or set it to `companion` for the other tenant. Cross-tenant access is not just possible — it is the *only* access model. **This is the exact UNVERIFIED dependency from threat-model §2c / item 9, and it resolves to FAIL.**

---

### 2. Cross-tenant reach — enumerated

| Vector | File:Line | Authorized against caller's key? | Reachability |
|---|---|---|---|
| **`X-Brain-Tenant` header (primary)** | `index.ts:64,103` | **NO** — trusted after allowlist/format check only | Full read+write of any allowed tenant, every tool. The master key to every room. |
| **`mind_letter` `to:` cross-brain** | `comms.ts:309-324` | **NO** — recipient checked only against `ALLOWED_TENANTS` (`:311`), then `storage.forTenant(recipient)` (`:315`) | Cross-tenant **write-only** (`appendLetter`, `:323`), rate-limited 200/day/sender (`:320`). Deliberate feature. Cannot read recipient's letters. |
| **`mind_context`/task assignment** | `tasks.ts:267-270` | **NO** — `forTenant(existing.tenant_id)` to deliver assignment notice | Cross-tenant **write** (handoff notice). Deliberate. |
| **Project registry `scope: "all"`** | `memory.ts:113-118` | **NO** — iterates `ALLOWED_TENANTS`, `forTenant(tenant)` for each | Cross-tenant **read** of every tenant's project dossiers. Gated by nothing but a param value. |
| **`mind_runtime` `agent_tenant`** | `runtime.ts:109,152,578-588` | **NO** — `resolveAgentTenant` validates only `isAllowedTenant` (`:584`); caller's own tenant is merely the *default* (`:580`) | Caller names any allowed tenant as the runtime key. Whether this crosses into another tenant's *storage* rows vs. filtering a column within the caller's scoped storage is **UNVERIFIED — verify the runtime table's tenant_id vs agent_tenant column semantics in `postgres.ts` before relying on this**; the pattern (caller-supplied tenant, trusted) is the same regardless. |
| **`storage.forTenant()` primitive** | `postgres.ts:335-339` | **NO** — accepts any `ALLOWED_TENANTS` member, no caller-identity check | The shared enabling mechanism for every cross-tenant hop above. It authorizes *nothing* because the caller has no bound identity to authorize against. |

Every one of these is moot as a *separate* escalation: since the header already grants full access to any tenant, these are additional roads to an already-unlocked vault. But they matter for the fix — **each is a caller-supplied tenant that trusts input, and each must be re-gated once key→tenant binding exists.** The deliberate cross-brain features (mind_letter, task handoff) are mediated today by *nothing but `ALLOWED_TENANTS` membership* — no authorization that the *sender* is who they claim, because the sender identity itself (`storage.getTenant()`, `comms.ts:299,318`) is just the trusted header value.

**Server-side daemon cross-tenant** (`daemon/tasks/cross-tenant.ts:25-47`) runs in the cron `scheduled()` handler over all tenants — not caller-reachable, correctly scoped via `forTenant`. Not an attack surface for a client key. `/health` hardcodes tenant `"rainer"` unauthenticated (`index.ts:147-158`) but only returns `{status}`, leaks no data — acceptable.

---

### 3. Injection / validation — PASS

House-rule checks (`../`, null bytes, ID sanitization) hold at every input I read:
- **Tenant header:** length ≤ 64, null-byte rejected, allowlist-checked — `index.ts:46,66-72`.
- **Tenant at storage layer:** DNS-label regex `^[a-z][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$` — `postgres.ts:320` and `forTenant` re-checks `ALLOWED_TENANTS` (`:336`). Defense-in-depth. No traversal or null-byte surface.
- **Territory:** allowlist `Object.keys(TERRITORIES).includes(territory)` — `memory.ts:530`, `constants.ts:7-19`. Territories are Postgres column values, not filesystem paths — no `../` file-access surface exists here at all.
- **Body:** 1 MB pre-flight + post-buffer size caps, batch ≤ 20 — `index.ts:206-221,318-324`.
- Query-param auth was correctly removed (`index.ts:161`); the `/mcp?tenant=` in the SSE endpoint advert (`index.ts:281`) is not read back for authz — POST reads the header only.

No injection findings. The validation layer is clean. The problem is not *what* the tenant string may contain — it is *who is allowed to name it*.

---

### 4. Config drift flag (MEDIUM — verify before Slice 1)

Server `ALLOWED_TENANTS = ["companion", "rainer"]` (`constants.ts:4`) vs. client proxy `ALLOWED_TENANTS = ["rook", "rainer"]` with default `"rook"` (`cloud_brain_proxy.py:24-25`). A proxy sending `X-Brain-Tenant: rook` gets a **400 Invalid tenant** from the server (`index.ts:70-72`, `:301-306`) — `"rook"` is no longer a valid server tenant. The sovereign-muse gateway (`brain-client.ts`, `brain-mcp-bridge.ts`) names tenants as `rook`/`rainer`; the cloud brain now speaks `companion`/`rainer`. **Whoever wires Slice 1 must reconcile the tenant vocabulary across gateway, proxy, and brain, or calls will silently 400 or land on the wrong default.** *(UNVERIFIED which value the live gateway sends today — reconcile against the deployed `BRAIN_TENANT` env before enabling any rainer path.)*

---

### Exact fixes required before sovereign-muse Slice 1 lands

1. **Bind key→tenant server-side.** Replace the single `env.API_KEY` with per-tenant secrets (`env.API_KEY_COMPANION`, `env.API_KEY_RAINER`, or a keyed map). At `index.ts:162-181`, resolve the tenant **from which key matched**, not from the header. Timing-safe compare each candidate; the matched key *is* the tenant. This is the whole fix — everything else is downstream of it.
2. **Demote `X-Brain-Tenant` to at most a cross-check.** After key→tenant resolution, if a header is present it may only be *asserted equal* to the key's tenant; a mismatch is **403**, never an override. Preferably ignore the header entirely for the caller's own tenant.
3. **Re-gate every `forTenant` cross-tenant path** (`comms.ts:315`, `tasks.ts:267`, `memory.ts:115`, `runtime.ts` `agent_tenant`) so the *sender* identity is the key-derived tenant, not `storage.getTenant()` sourced from a trusted header. mind_letter between companion and rainer is legitimate — but the sender must be *proven* by its key, and cross-tenant **read** (project registry `scope:all`) should require an explicit grant, not mere `ALLOWED_TENANTS` membership.
4. **Reconcile tenant vocabulary** (companion/rainer vs rook/rainer) across brain, proxy, and gateway (§4).
5. **Fail closed:** a valid key with an unknown/absent tenant mapping must 4xx, never default to `"rainer"` (`index.ts:64`).

Until fix #1 ships, the answer to "can a caller with one companion's key read another's memory" is an unqualified **yes** — the key is not scoped to a tenant, and the tenant is a header the caller writes. Do not create per-companion brain keys on this substrate; there is nothing on the server to make them mean anything.

---

**Cross-check flags:**
- → **Nikita**: this closes the UNVERIFIED external dependency you were flagged on (threat-model line 163, §6 item 9). The cloud brain does **not** bind tenant↔key — it FAILS. Update the go/no-go: item 9 is now a confirmed BLOCK, not a pending verification.
- → **Eli**: fix #1 is architectural, not a patch. The `resolveTenantFromHeader` → `createStorage` seam (`index.ts:62-103`) must invert so tenant flows from the matched key. This mirrors the gateway-side `IDENTITY='rook'` structural problem you already own — same disease (identity supplied/assumed rather than derived), both ends of the wire.
- → **June** (when fixes land): fix #1 touches `index.ts:162-181` (auth), the `Env` type (`types.ts:7`), and wrangler secrets. Fix #3 touches the five `forTenant` call sites above.

**UNVERIFIED — verify before relying on:**
- The deployed Cloudflare secret configuration (does prod already have per-tenant secrets bound, overriding what the code implies? The code reads a single `API_KEY` — I cannot see prod Wrangler secrets from this repo).
- The `mind_runtime` `agent_tenant` row-level reachability into another tenant's storage vs. in-scope column filter (§2, runtime row).
- Which tenant string the live sovereign-muse gateway actually transmits today (rook vs companion).

```
MEMORY (persisted to ~/.claude/agents/memory/michael/_universal.md):
- [2026-07-06] MUSE Brain cloud worker has ZERO key→tenant binding: single global env.API_KEY (index.ts:164) authorizes ALL tenants; tenant derived purely from caller X-Brain-Tenant header (index.ts:62-75, resolveTenantFromHeader) then fed to createStorage (index.ts:103). Any key holder reads/writes any tenant by naming it. Per-companion brain keys (Path B Slice 1) impossible until server binds key→tenant. **#multi-tenant #confused-deputy #cloud-brain #tenant-key-binding** (CRITICAL, 98 confidence)
```
