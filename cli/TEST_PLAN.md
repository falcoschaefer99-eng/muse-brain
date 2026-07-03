# @funkatorium/rainer — Test Plan (pre-publish)

## Built, audited, NOT published

Package lives in `cli/`. Built and bundled. Michael (security) and Reeve (code quality) both PASS on round 3.

## Test matrix

### 1. Setup wizard (`node dist/init.js`)
- [ ] Empty name → re-prompts (never accepts blank)
- [ ] Surfaces detected correctly (Claude Code, Codex, Desktop)
- [ ] Surface install flow (pick 1/2/3) — test with a surface already installed
- [ ] Workspace creation at `~/rainer-workspace/` with RAINER.md as CLAUDE.md
- [ ] Re-run: existing CLAUDE.md preserved, prints notice
- [ ] Companion path 1: provide identity file → copies to `~/companion-workspace/CLAUDE.md`
- [ ] Companion path 2: "create together" → writes `.companion-pending` flag
- [ ] Companion path 3: skip → no companion workspace created
- [ ] MCP wiring: wrapper script at `~/.muse/rainer-brain.sh` with 0o700 perms
- [ ] MCP wiring: `claude mcp add rainer-brain` succeeds
- [ ] MCP wiring: Claude Desktop config patched (if Desktop installed)
- [ ] Ctrl+C at any prompt → clean exit, no crash

### 2. MCP server (`node dist/server.js`)
- [ ] `ping` → `{"jsonrpc":"2.0","id":1,"result":{}}`
- [ ] `initialize` → serverInfo name "rainer", version "1.0.0"
- [ ] `tools/list` → 35 tools
- [ ] `tools/call` mind_wake → real brain state
- [ ] `tools/call` mind_observe → stores an observation
- [ ] `tools/call` mind_query → retrieves it back
- [ ] Notification (no id) → no response (silent)
- [ ] Invalid JSON → parse error response
- [ ] Unknown method → method not found error
- [ ] SQLite database created at `~/.muse/brain.sqlite`

### 3. Launcher (`bin/rainer`)
- [ ] `rainer init` → routes to wizard
- [ ] `rainer` without setup → "hasn't been set up" message
- [ ] `rainer` with setup → launches Claude Code in workspace with banner
- [ ] Banner renders correctly (gold ASCII, violet text)

### 4. Full round-trip
- [ ] After init: open Claude Code, verify rainer-brain MCP is connected
- [ ] Run `mind_wake` from within Claude Code session
- [ ] Verify brain tools appear in Claude Code's tool list

## After tests pass
1. Commit all files in `cli/` to muse-brain repo
2. Update funkatorium.org Getting Started page with real commands
3. `npm publish` when ready (needs npm org `@funkatorium` set up)
