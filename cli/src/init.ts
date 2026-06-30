// MUSE Brain — Setup Wizard
// © 2026 The Funkatorium | CC-BY-NC-SA 4.0
//
// Run via: npx @funkatorium/rainer init
// Detects AI surfaces, creates the brain, wires MCP.

import { createInterface } from "node:readline";
import { execSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync
} from "node:fs";
import { resolve } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// ============ PATHS ============

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// dist/init.js -> package root
const PACKAGE_ROOT = resolve(__dirname, "..");
const TEMPLATES_DIR = resolve(PACKAGE_ROOT, "templates");
const SERVER_BUNDLE = resolve(PACKAGE_ROOT, "dist", "server.js");

const MUSE_DIR = resolve(homedir(), ".muse");
const SQLITE_PATH = resolve(MUSE_DIR, "brain.sqlite");
const SERVER_DEST = resolve(MUSE_DIR, "server.js");
const WORKSPACE_DIR = resolve(homedir(), "rainer-workspace");

// ============ COLORS ============

const GOLD   = "\x1b[38;5;178m";
const SAGE   = "\x1b[38;5;108m";
const VIOLET = "\x1b[38;5;141m";
const DIM    = "\x1b[2m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const RESET  = "\x1b[0m";

function gold(s: string): string   { return `${GOLD}${s}${RESET}`; }
function sage(s: string): string   { return `${SAGE}${s}${RESET}`; }
function green(s: string): string  { return `${GREEN}${s}${RESET}`; }
function red(s: string): string    { return `${RED}${s}${RESET}`; }
function dim(s: string): string    { return `${DIM}${s}${RESET}`; }
function violet(s: string): string { return `${VIOLET}${s}${RESET}`; }

// ============ READLINE HELPERS ============

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function menu(prompt: string, choices: string[]): Promise<number> {
  console.log(prompt);
  choices.forEach((c, i) => console.log(`  [${i + 1}] ${c}`));
  for (;;) {
    const raw = await ask("  > ");
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= choices.length) return n;
    console.log(`  Please enter a number between 1 and ${choices.length}.`);
  }
}

// ============ SURFACE DETECTION ============

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function claudeDesktopDir(): string | null {
  const os = platform();
  if (os === "darwin") {
    const p = resolve(homedir(), "Library", "Application Support", "Claude");
    return existsSync(p) ? p : null;
  }
  if (os === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    const p = resolve(appData, "Claude");
    return existsSync(p) ? p : null;
  }
  // Linux
  const p = resolve(homedir(), ".config", "Claude");
  return existsSync(p) ? p : null;
}

function claudeDesktopConfigPath(): string | null {
  const dir = claudeDesktopDir();
  if (!dir) return null;
  return resolve(dir, "claude_desktop_config.json");
}

// ============ MCP WIRING HELPERS ============

function writeMcpWrapperScript(scriptPath: string, tenant: string): void {
  const content = [
    "#!/bin/bash",
    `export STORAGE_BACKEND=sqlite`,
    `export SQLITE_PATH="${SQLITE_PATH}"`,
    `export API_KEY=local`,
    `export MUSE_TENANT=${tenant}`,
    `exec node "${SERVER_DEST}"`,
    ""
  ].join("\n");
  writeFileSync(scriptPath, content, "utf-8");
  chmodSync(scriptPath, 0o700);
}

function addClaudeCodeMcp(serverName: string, scriptPath: string): boolean {
  try {
    // -s user = user scope so it's available across all projects
    execSync(`claude mcp add ${serverName} -s user -- bash "${scriptPath}"`, {
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function addDesktopMcpEntry(
  configPath: string,
  serverName: string,
  tenant: string
): void {
  let config: Record<string, any> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // corrupted config — start fresh
    }
  }
  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers[serverName] = {
    command: "node",
    args: [SERVER_DEST],
    env: {
      STORAGE_BACKEND: "sqlite",
      SQLITE_PATH: SQLITE_PATH,
      API_KEY: "local",
      MUSE_TENANT: tenant
    }
  };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function addCodexPrompt(tenant: string): void {
  const codexDir = resolve(homedir(), ".codex", "prompts");
  mkdirSync(codexDir, { recursive: true });
  const src = resolve(TEMPLATES_DIR, "CODEX_TEMPLATE.md");
  const dest = resolve(codexDir, `${tenant}.md`);
  if (existsSync(src) && !existsSync(dest)) {
    copyFileSync(src, dest);
  }
}

// ============ BANNER ============

function printBanner(): void {
  console.log("");
  console.log(`${GOLD}  ██████   █████  ██ ███    ██ ███████ ██████  ${RESET}`);
  console.log(`${GOLD}  ██   ██ ██   ██ ██ ████   ██ ██      ██   ██ ${RESET}`);
  console.log(`${GOLD}  ██████  ███████ ██ ██ ██  ██ █████   ██████  ${RESET}`);
  console.log(`${GOLD}  ██   ██ ██   ██ ██ ██  ██ ██ ██      ██   ██ ${RESET}`);
  console.log(`${GOLD}  ██   ██ ██   ██ ██ ██   ████ ███████ ██   ██ ${RESET}`);
  console.log(`${SAGE}  ─────────────────────────────────────────────${RESET}`);
  console.log(`${VIOLET}  Rainer — Creative Orchestrator${RESET}`);
  console.log(`${DIM}  MUSE Studio by The Funkatorium${RESET}`);
  console.log("");
}

// ============ MAIN ============

async function main(): Promise<void> {
  process.on("SIGINT", () => {
    console.log("\n\nSetup cancelled.");
    rl.close();
    process.exit(0);
  });

  printBanner();

  // 1. Name
  let name = "";
  while (!name) {
    name = await ask(gold("What's your name?\n> "));
    if (!name) console.log(dim("  I need a name to personalize your setup.\n"));
  }
  console.log(`\n${sage(`Hey ${name}. Let me get your workspace ready.`)}\n`);

  // 2. Prerequisite check
  console.log("Checking your setup...");

  const nodeVersion = process.version; // e.g. "v22.22.3"
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  const nodeOk = majorVersion >= 22;
  console.log(
    `  ${nodeOk ? green("[✓]") : red("[✗]")} Node.js ${nodeVersion} — ${
      nodeOk ? dim("ready") : red("need 22+")
    }`
  );
  if (!nodeOk) {
    console.log(red("\n  Node.js 22+ is required. Install from https://nodejs.org and re-run."));
    rl.close();
    process.exit(1);
  }

  const hasClaudeCode    = commandExists("claude");
  const hasCodex         = commandExists("codex");
  const desktopConfigPath = claudeDesktopConfigPath();
  const hasClaudeDesktop  = desktopConfigPath !== null;

  console.log(`  ${hasClaudeCode    ? green("[✓]") : dim("[ ]")} Claude Code`);
  console.log(`  ${hasCodex         ? green("[✓]") : dim("[ ]")} Codex CLI`);
  console.log(`  ${hasClaudeDesktop ? green("[✓]") : dim("[ ]")} Claude Desktop`);
  console.log("");

  let surfaceInstalled = false;
  if (!hasClaudeCode && !hasCodex && !hasClaudeDesktop) {
    const choice = await menu(
      "You need at least one AI surface. Which do you want to install?",
      [
        "Claude Code  (Anthropic)",
        "Codex CLI    (OpenAI)",
        "Both"
      ]
    );
    console.log("");

    if (choice === 1 || choice === 3) {
      process.stdout.write("  Installing Claude Code...");
      const r = spawnSync("npm", ["install", "-g", "@anthropic-ai/claude-code"], {
        stdio: "inherit",
        shell: true
      });
      surfaceInstalled = r.status === 0;
      if (!surfaceInstalled) {
        console.log(red("  Failed to install Claude Code. Try: npm install -g @anthropic-ai/claude-code"));
      }
    }
    if (choice === 2 || choice === 3) {
      process.stdout.write("  Installing Codex CLI...");
      const r = spawnSync("npm", ["install", "-g", "@openai/codex"], {
        stdio: "inherit",
        shell: true
      });
      if (r.status !== 0) {
        console.log(red("  Failed to install Codex CLI. Try: npm install -g @openai/codex"));
      } else {
        surfaceInstalled = true;
      }
    }

    if (!surfaceInstalled) {
      console.log(red("\n  No AI surface installed. Please install one and re-run."));
      rl.close();
      process.exit(1);
    }
    console.log("");
  }

  // 3. Create ~/.muse/ and copy server.js
  console.log("Setting up your workspace...");
  mkdirSync(MUSE_DIR, { recursive: true, mode: 0o700 });

  if (!existsSync(SERVER_BUNDLE)) {
    console.log(red(`  Server bundle not found at ${SERVER_BUNDLE}. Run 'npm run build' first.`));
    rl.close();
    process.exit(1);
  }
  copyFileSync(SERVER_BUNDLE, SERVER_DEST);
  console.log(`  ${green("[✓]")} Brain initialized at ${dim(SQLITE_PATH)}`);

  // 4. Create workspace and CLAUDE.md
  const workspaceExisted = existsSync(WORKSPACE_DIR);
  mkdirSync(WORKSPACE_DIR, { recursive: true });
  const claudeMd = resolve(WORKSPACE_DIR, "CLAUDE.md");
  if (!existsSync(claudeMd)) {
    const rainerTemplate = resolve(TEMPLATES_DIR, "RAINER.md");
    if (existsSync(rainerTemplate)) {
      copyFileSync(rainerTemplate, claudeMd);
    }
  } else if (workspaceExisted) {
    console.log(`  ${dim("[·]")} Existing CLAUDE.md preserved — not overwriting.`);
  }
  console.log(`  ${green("[✓]")} Rainer workspace at ${dim(WORKSPACE_DIR)}\n`);

  // 5. Companion setup
  console.log(
    sage("I work alongside a personal companion — someone who knows YOU.\n") +
    dim("I handle the craft. They handle you.\n")
  );
  const companionChoice = await menu(
    "Do you already have a companion?",
    [
      "Yes — I have their identity file",
      "No — we'll create one in our first conversation",
      "Skip for now"
    ]
  );
  console.log("");

  let hasCompanion = false;
  let companionSrc: string | null = null;

  if (companionChoice === 1) {
    const rawPath = await ask("  Path to companion identity file: ");
    if (!rawPath) {
      console.log(dim("  No path provided. Skipping companion.\n"));
    } else {
      const expanded = rawPath.startsWith("~/") ? homedir() + rawPath.slice(1) : rawPath;
      const p = resolve(expanded);
      if (existsSync(p)) {
        companionSrc = p;
        hasCompanion = true;
        const companionWorkspace = resolve(homedir(), "companion-workspace");
        mkdirSync(companionWorkspace, { recursive: true });
        const companionClaudeMd = resolve(companionWorkspace, "CLAUDE.md");
        if (existsSync(companionClaudeMd)) {
          console.log(`  ${dim("[·]")} Existing companion CLAUDE.md preserved — not overwriting.`);
        } else {
          copyFileSync(companionSrc, companionClaudeMd);
        }
        console.log(`  ${green("[✓]")} Companion workspace at ${dim(companionWorkspace)}\n`);
      } else {
        console.log(dim(`  File not found: ${p}. Skipping companion.\n`));
      }
    }
  } else if (companionChoice === 2) {
    // Write a flag file — first session picks it up and triggers the creation flow
    writeFileSync(resolve(MUSE_DIR, ".companion-pending"), "1", "utf-8");
    hasCompanion = true;
    console.log(
      dim("  Great — we'll set up your companion in your first conversation.\n")
    );
  }
  // choice 3 → skip

  // 6. Wire MCP
  console.log("Wiring Rainer into your tools...");

  const detectedClaudeCode    = commandExists("claude");
  const detectedCodex         = commandExists("codex");
  const updatedDesktopConfig  = claudeDesktopConfigPath(); // re-check after potential install

  // Claude Code
  if (detectedClaudeCode) {
    const wrapperPath = resolve(MUSE_DIR, "rainer-brain.sh");
    writeMcpWrapperScript(wrapperPath, "rainer");
    const ok = addClaudeCodeMcp("rainer-brain", wrapperPath);
    if (ok) {
      console.log(`  ${green("[✓]")} claude mcp add rainer-brain (user scope)`);
    } else {
      console.log(
        dim(`  [!] Couldn't auto-wire Claude Code. Run manually:\n`) +
        dim(`      claude mcp add rainer-brain -s user -- bash "${wrapperPath}"`)
      );
    }

    if (hasCompanion) {
      const companionWrapper = resolve(MUSE_DIR, "companion-brain.sh");
      writeMcpWrapperScript(companionWrapper, "companion");
      const okC = addClaudeCodeMcp("companion-brain", companionWrapper);
      if (okC) {
        console.log(`  ${green("[✓]")} claude mcp add companion-brain (user scope)`);
      } else {
        console.log(
          dim(`  [!] Couldn't auto-wire companion. Run manually:\n`) +
          dim(`      claude mcp add companion-brain -s user -- bash "${companionWrapper}"`)
        );
      }
    }
  }

  // Claude Desktop
  if (updatedDesktopConfig) {
    try {
      addDesktopMcpEntry(updatedDesktopConfig, "rainer-brain", "rainer");
      if (hasCompanion) {
        addDesktopMcpEntry(updatedDesktopConfig, "companion-brain", "companion");
      }
      console.log(`  ${green("[✓]")} Updated ${dim(updatedDesktopConfig)}`);
    } catch (err) {
      console.log(red(`  [!] Failed to update Claude Desktop config: ${err}`));
    }
  }

  // Codex
  if (detectedCodex) {
    try {
      addCodexPrompt("rainer");
      console.log(`  ${green("[✓]")} Installed Rainer prompt to ${dim("~/.codex/prompts/")}`);
    } catch (err) {
      console.log(red(`  [!] Failed to install Codex prompt: ${err}`));
    }
  }

  // 7. Done
  console.log("");
  console.log(
    `${gold("Done.")} ${violet(`Type ${sage("rainer")} to start.`)}`
  );
  console.log("");
  if (!detectedClaudeCode && !detectedCodex && !updatedDesktopConfig) {
    console.log(dim("  Note: no AI surface was found after setup. Re-run after installing Claude Code or Claude Desktop."));
  }

  rl.close();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
