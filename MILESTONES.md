# MUSE Brain — Milestones

This public repository is a clean-history export from the private production codebase.

## v1.4.1-rc.1 (2026-04-02)
- Postgres JSONB storage hardening (prevents identity seeding follow-up failures)
- MCP/runtime stabilization after credential/config churn
- Security hardening:
  - empty `API_KEY` misconfiguration guard
  - strict tenant header normalization/validation
  - `/mcp` SSE tenant validation
- Runner publish hygiene:
  - local-vs-template config split
  - launchd template/install cleanup
  - machine-path scrubbing
- Release gauntlet green:
  - `muse-brain`: 112/112 unit tests + TypeScript clean
  - `runner`: 17/17 tests + TypeScript build clean

## Product shape in this public release
- Public-facing default tenant: `rainer`
- Secondary example tenant: `companion` (generic collaborator)
- Runtime/deploy credentials are **not** included
