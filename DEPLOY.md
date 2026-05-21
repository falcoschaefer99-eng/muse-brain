# Deploy — muse-brain

**Live URL:** https://rook.funkatorium.org (Falco's instance — `rook-brain` worker)
**Target class:** CF Worker (Class B)
**Auto-deploy on push:** Not yet (Phase 1)

## Recipe

```bash
# Run from muse-brain/ subdirectory (where package.json and wrangler.jsonc live)
cd muse-brain
./deploy.sh
# or with a specific ref:
./deploy.sh --ref <commit|tag>
```

`muse-brain/deploy.sh` encodes the full recipe. Step by step:

1. (Optional) `git checkout <ref>` if `--ref` supplied
2. Assert `wrangler.jsonc` exists (gitignored — must be configured locally)
3. `npm run deploy` (which runs `wrangler deploy`)
4. If `MUSE_BRAIN_URL` set: `curl -fsI $MUSE_BRAIN_URL/health` — assert HTTP 200
5. `git tag deploy-prod-YYYYMMDD-HHMM`

## Triggers

- **Manual (now):** `cd muse-brain && ./deploy.sh` from repo root
- **git push (Phase 1):** GitHub Actions will call `./deploy.sh` (CF_API_TOKEN as repo secret)
- **PWA button (Phase 3):** POST to Hetzner deploy-head → shells out to `./deploy.sh`

## Targets & Bindings

| Binding | Type | Notes |
|---------|------|-------|
| `AI` | Cloudflare AI | workers-ai binding |
| `HYPERDRIVE` | Hyperdrive | Neon Postgres connection pooling |

Worker name (Falco's instance): `rook-brain`
Instance config file: `muse-brain/wrangler.jsonc` (gitignored — copy from `wrangler.jsonc.example`)

## Secrets

Set via `cd muse-brain && npx wrangler secret put <NAME>`:

| Secret | Purpose |
|--------|---------|
| `DATABASE_URL` | Neon Postgres URL (fallback if not using Hyperdrive) |

Any additional secrets are instance-specific — document in your local `wrangler.jsonc` comments.

CF API token for CI: set as `CLOUDFLARE_API_TOKEN` in GitHub Actions repo secrets (Phase 1).

## First-time setup

This is a public open-source template. For Falco's `rook-brain` instance:

```bash
cd muse-brain
cp wrangler.jsonc.example wrangler.jsonc
# Edit wrangler.jsonc: set name = "rook-brain", set hyperdrive id
npm install
npx wrangler secret put DATABASE_URL
./deploy.sh
```

## Verification

```bash
export MUSE_BRAIN_URL=https://rook.funkatorium.org
cd muse-brain && ./deploy.sh
# deploy.sh will curl /health automatically when MUSE_BRAIN_URL is set
```

## Rollback

```bash
# Roll back to a previous deploy tag
cd muse-brain && ./deploy.sh --ref deploy-prod-YYYYMMDD-HHMM

# Worker rollback via wrangler
cd muse-brain && npx wrangler rollback
```

## Notes

- `wrangler.jsonc` is gitignored — instance-specific config stays off the repo.
- `runner/` is the autonomous runner (separate process, not deployed via this script).
- Falco's deployed instance is at `rook.funkatorium.org` (set `MUSE_BRAIN_URL` accordingly).
