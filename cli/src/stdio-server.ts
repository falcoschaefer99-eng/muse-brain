// MUSE Brain — stdio MCP server for local deployment
// © 2026 The Funkatorium | CC-BY-NC-SA 4.0
//
// Reads newline-delimited JSON-RPC from stdin, writes responses to stdout.
// stderr is used for diagnostic logging so stdout stays clean.
//
// Launched by claude mcp add / Claude Desktop config — one process per tenant.

import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";

// Import storage and tools directly from the brain source.
// We import createSQLiteStorage directly (not via factory) to avoid pulling
// in the postgres dependency. esbuild bundles these at build time.
import { createSQLiteStorage } from "../../muse-brain/src/storage/sqlite";
import { TOOL_DEFS, executeTool } from "../../muse-brain/src/tools-v2/index";

// ============ CONFIG ============

const tenant = (process.env.MUSE_TENANT || "rainer").trim();
const rawSqlitePath = process.env.SQLITE_PATH;
const sqlitePath = rawSqlitePath
  ? resolve(rawSqlitePath)
  : resolve(homedir(), ".muse", "brain.sqlite");

// ============ STORAGE ============

// Ensure the parent directory exists before SQLiteBrainStorage constructor
// fires initSqlite() — DatabaseSync fails if the directory is missing.
mkdirSync(dirname(sqlitePath), { recursive: true, mode: 0o700 });

const storage = createSQLiteStorage(sqlitePath, tenant);

// waitUntil shim — fire-and-forget, no Cloudflare ExecutionContext available.
const waitUntil = (p: Promise<unknown>): void => {
  p.catch(() => {});
};

// ============ LOGGING ============

// All logs go to stderr so stdout stays clean for JSON-RPC messages.
function log(...args: unknown[]): void {
  process.stderr.write(args.map(String).join(" ") + "\n");
}

// ============ JSON-RPC HANDLER ============

type JsonRpc = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: any;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: any;
  error?: { code: number; message: string };
};

function respond(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + "\n");
}

async function handleRequest(raw: string): Promise<void> {
  let request: JsonRpc;
  try {
    request = JSON.parse(raw);
  } catch {
    respond({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }

  const { id, method, params } = request;

  // JSON-RPC 2.0: notifications have no `id`. Never respond to them.
  if (id === undefined || id === null) return;

  try {
    switch (method) {
      case "initialize":
        respond({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "rainer", version: "1.0.0" },
            capabilities: { tools: {} }
          }
        });
        break;

      case "tools/list":
        respond({ jsonrpc: "2.0", id, result: { tools: TOOL_DEFS } });
        break;

      case "tools/call": {
        const { name, arguments: args } = params ?? {};
        const result = await executeTool(name, args ?? {}, {
          storage,
          ai: undefined,  // no embeddings locally — tools degrade gracefully
          waitUntil
        });
        respond({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
        });
        break;
      }

      case "ping":
        respond({ jsonrpc: "2.0", id, result: {} });
        break;

      default:
        respond({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    }
  } catch (error: any) {
    log("MCP error:", error?.message ?? error);
    const safeErrors = [
      "Invalid territory",
      "Missing required parameter",
      "Observation content too large"
    ];
    const msg = error?.message?.includes("Unknown tool:") ? "Unknown tool" :
      safeErrors.find(e => error?.message?.includes(e)) ?? "Internal error";
    respond({ jsonrpc: "2.0", id, error: { code: -32603, message: msg } });
  }
}

// ============ STDIN LOOP ============

log(`[muse-brain] stdio server starting — tenant: ${tenant}, db: ${sqlitePath}`);

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  // handleRequest is async; errors are caught inside and written to stdout.
  handleRequest(trimmed).catch((err) => {
    log("[muse-brain] unhandled error in handleRequest:", err);
  });
});

rl.on("close", () => {
  log("[muse-brain] stdin closed, exiting.");
  process.exit(0);
});
