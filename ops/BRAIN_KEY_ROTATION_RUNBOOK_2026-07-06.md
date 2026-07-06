# MUSE Brain — Key→Tenant Rotation Runbook

**For:** Sawyer (deploy). **Depends on:** `feat/tenant-key-binding` branch merged and deployed.
**Closes:** ops/MICHAEL_TENANT_KEY_AUDIT_2026-07-06.md FAIL verdict.

This is a **secrets-only** operation once the code is deployed. No further code changes,
no downtime, no coordinated cutover window required — the dual-accept transition
(`src/auth.ts`) makes rotation safe to do incrementally, one secret at a time, in
production.

## Preconditions

- [ ] `feat/tenant-key-binding` merged to `main` and deployed to the `muse-brain` Worker.
- [ ] Confirm the deployed version is live: `GET /health` responds (unauthenticated,
      unaffected by this change).
- [ ] Confirm today's shared secret value: the current `API_KEY` Wrangler secret. Every
      existing client (cloud_brain_proxy.py, sovereign-muse gateway, any other consumer)
      is currently sending this value in `Authorization: Bearer <API_KEY>`.

## Step-by-step rotation

**1. Bind per-tenant secrets ALONGSIDE the existing legacy key. Do this first, verify, then move on.**

**MUST: every secret value below MUST be distinct — generate a fresh random value for
each one. Do NOT reuse the legacy `API_KEY` value for any `API_KEY_<TENANT>`, and do NOT
reuse one tenant's key value for another tenant.** This is not just a discipline
reminder — it is now **code-enforced** (`src/auth.ts` `findDuplicateSecretValues`,
M1 hardening from Michael's PASS WITH CONDITIONS re-review, 2026-07-06). If you
accidentally reuse a value, the service will refuse to authenticate ANY bearer at all
(503 `Service misconfigured`, logged server-side with only the conflicting env var
names — never the value) until the duplicate is fixed. This is deliberate: a reused
value could otherwise let a per-tenant key silently resolve via the legacy candidate and
reopen the header-authoritative cross-tenant path. Treat a 503 immediately after binding
a new secret as "check for a copy-paste duplicate," not "something else is broken."

```bash
wrangler secret put API_KEY_COMPANION   # generate a new long random value, distinct from every other secret below
wrangler secret put API_KEY_RAINER      # a DIFFERENT new long random value
```

At this point the deployment has three valid secrets: the legacy `API_KEY` (still
authenticating via the old header-derived-tenant path, now logging a deprecation
warning on every use) plus the two new per-tenant keys. Nothing about existing traffic
changes yet — this step is purely additive, as long as all three values are distinct.

**2. Verify each new key resolves to the correct tenant before touching any client config.**

```bash
curl -s https://your-brain.yourdomain.com/mcp \
  -H "Authorization: Bearer <API_KEY_COMPANION value>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"mind_runtime","arguments":{"action":"get_session"}}}'
# -> result should show "agent_tenant": "companion"

curl -s https://your-brain.yourdomain.com/mcp \
  -H "Authorization: Bearer <API_KEY_RAINER value>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"mind_runtime","arguments":{"action":"get_session"}}}'
# -> result should show "agent_tenant": "rainer"
```

Also verify the fail-closed cross-check: presenting the companion key with
`X-Brain-Tenant: rainer` must return **403**, not 200 and not silently reassign the
tenant.

**3. Migrate each client, one at a time, to its own key.**

- `rook-memory/cloud_brain_proxy.py` (or whichever env it reads its brain key from) →
  point at `API_KEY_RAINER` (or `API_KEY_COMPANION`, whichever tenant that deployment
  actually is — see the vocabulary-drift note below before assuming).
- sovereign-muse gateway (`brain-client.ts` / `brain-mcp-bridge.ts`) → same.
- Any wake/runner scripts using `BRAIN_API_KEY` → update to the matching per-tenant value.
- After each client is migrated, watch logs for that client's traffic — it should stop
  triggering the `deprecated_auth_legacy_api_key` warning and start authenticating via
  its own key.

You can migrate clients in any order, one at a time, with zero downtime — both the
legacy key and the new per-tenant keys work simultaneously during this whole window.

**4. Confirm zero remaining legacy traffic.**

Grep Worker logs for `deprecated_auth_legacy_api_key` over a full traffic cycle
(recommend at least 48h to catch cron-triggered / low-frequency clients like scheduled
runners). Zero hits = every known client has rotated.

**5. Delete the legacy secret. This is the moment the service becomes strict.**

```bash
wrangler secret delete API_KEY
```

After this, `discoverAuthCandidates()` in `src/auth.ts` no longer includes a legacy
candidate — a request presenting the old shared key gets a plain **401 Unauthorized**
(not 503; the per-tenant keys still authenticate the service, it's just no longer
misconfigured). There is no code to change and no deploy to run for this step — it is
a pure secrets operation.

**6. (Optional, only if adding a genuinely new tenant later)**

```bash
wrangler secret put API_KEY_NEWTENANT
```

...and add `"newtenant"` to the `ALLOWED_TENANTS` Worker var (plain-text, not a secret —
see `wrangler.jsonc.example`) if it's not already in the compiled-in default list. No
code change required. Note the scope boundary below before relying on cross-tenant
features (mind_letter recipient, project-registry `scope:"all"`, `mind_runtime
agent_tenant`) recognizing the new tenant.

## Rollback

If something goes wrong mid-rotation (a client can't be reached to migrate, a per-tenant
key was generated wrong, etc.) — **do nothing**. The legacy key still works until you
explicitly delete it in step 5. There is no rollback needed for steps 1-4; they're purely
additive. If you've already deleted the legacy secret and need to roll back:

```bash
wrangler secret put API_KEY   # re-bind the old value if you still have it recorded
```

This immediately restores the dual-accept transition. Per-tenant keys keep working
throughout.

## Known scope boundary (flag if you're adding a third tenant)

`ALLOWED_TENANTS` env override affects the entry-point auth/tenant-resolution layer
(`src/auth.ts`, `src/tenant-config.ts`) fully. It does **not** currently propagate into
the deeper tool/storage layer's static allowlists (`src/constants.ts` `ALLOWED_TENANTS`
is still imported directly in `tools-v2/comms.ts`, `tools-v2/tasks.ts`,
`tools-v2/runtime.ts`, `tools-v2/memory.ts`, `storage/postgres.ts`,
`storage/sqlite.ts`). A genuinely new third tenant (beyond companion/rainer) will
authenticate fine and get correctly tenant-scoped storage, but cannot be named as a
`mind_letter` recipient, appear in project-registry `scope:"all"` iteration, or be set
as a `mind_runtime agent_tenant` until those files are updated too (small follow-up,
not done in this pass — see June's report in
`ops/MICHAEL_TENANT_KEY_AUDIT_2026-07-06.md` follow-up thread).
