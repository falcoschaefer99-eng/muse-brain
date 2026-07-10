#!/usr/bin/env bash
# deploy.sh — muse-brain (Class B: Cloudflare Worker)
# Usage: ./deploy.sh [--ref <commit|tag>]
#
# Prerequisites:
#   - wrangler.jsonc must exist. It is tracked in this repo (reproduces Falco's
#     "rook-brain" production config) — a fresh clone already has it. Self-hosting a
#     different instance: copy wrangler.jsonc.example instead and set your own
#     name + hyperdrive id.
#   - CLOUDFLARE_API_TOKEN set in environment, or run: npx wrangler login
#   - Run from muse-brain/ subdirectory (where package.json lives)
#
# Secrets required (set via: npx wrangler secret put <NAME>):
#   DATABASE_URL — Neon Postgres connection string (if not using Hyperdrive)
#   Any other secrets listed in wrangler.jsonc
set -euo pipefail

# Health check URL — derived from worker name in wrangler.jsonc
# Falco's instance: https://rook-brain.<account>.workers.dev or custom domain
# Update WORKER_URL if a custom domain is configured.
WORKER_URL="${MUSE_BRAIN_URL:-}"  # set MUSE_BRAIN_URL env var or update this line

REF=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ -n "$REF" ]]; then
  echo "[deploy] Checking out ref: $REF"
  git -C .. fetch --tags
  git -C .. checkout "$REF"
fi

# Confirm wrangler.jsonc exists
if [[ ! -f "wrangler.jsonc" ]]; then
  echo "[deploy] ERROR: wrangler.jsonc not found."
  echo "  Copy wrangler.jsonc.example → wrangler.jsonc and set name + hyperdrive id."
  exit 1
fi

COMMIT=$(git -C .. rev-parse --short HEAD)
TIMESTAMP=$(date -u +%Y%m%d-%H%M)
TAG="deploy-prod-${TIMESTAMP}"

WORKER_NAME=$(node -e "const fs=require('fs'); const c=fs.readFileSync('wrangler.jsonc','utf8').replace(/\/\/.*/g,''); console.log(JSON.parse(c).name)" 2>/dev/null || echo "muse-brain")
echo "[deploy] Deploying muse-brain worker '${WORKER_NAME}' @ ${COMMIT}"

# ── Deploy ───────────────────────────────────────────────────────────────────
npm run deploy

# ── Verify ───────────────────────────────────────────────────────────────────
if [[ -n "$WORKER_URL" ]]; then
  echo "[deploy] Verifying worker health at ${WORKER_URL}/health..."
  HTTP_STATUS=$(curl -fsI "${WORKER_URL}/health" -o /dev/null -w "%{http_code}" --max-time 15 || true)
  if [[ "$HTTP_STATUS" != "200" ]]; then
    echo "[deploy] WARNING: ${WORKER_URL}/health returned HTTP ${HTTP_STATUS}"
  else
    echo "[deploy] Worker health check passed (HTTP 200)"
  fi
else
  echo "[deploy] SKIP: Set MUSE_BRAIN_URL env var to enable health check verification."
fi

# ── Tag ──────────────────────────────────────────────────────────────────────
git -C .. tag "$TAG"
echo "[deploy] Tagged: ${TAG}"

echo "[deploy] Done. muse-brain '${WORKER_NAME}' @ ${COMMIT}"
