// Build script for @funkatorium/rainer
// Bundles the MCP stdio server and setup wizard using esbuild.

import * as esbuild from "esbuild";
import { mkdirSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

mkdirSync(resolve(__dirname, "dist"), { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  target: ["node22"],
  format: "esm",
  // node:* built-ins are automatically external with platform: "node".
  // The dynamic import of node:sqlite via a variable in sqlite.ts is
  // unanalyzable by esbuild and passes through as-is — node 22 provides it.
  external: ["node:*"],
  sourcemap: false,
  treeShaking: true,
};

console.log("Building dist/server.js...");
await esbuild.build({
  ...common,
  entryPoints: [resolve(__dirname, "src/stdio-server.ts")],
  outfile: resolve(__dirname, "dist/server.js"),
  banner: { js: "#!/usr/bin/env node" },
});

console.log("Building dist/init.js...");
await esbuild.build({
  ...common,
  entryPoints: [resolve(__dirname, "src/init.ts")],
  outfile: resolve(__dirname, "dist/init.js"),
  banner: { js: "#!/usr/bin/env node" },
});

// Ensure dist/init.js is executable so the rainer-init bin works when
// npm links it into node_modules/.bin/ without a wrapper shell script.
chmodSync(resolve(__dirname, "dist/init.js"), 0o755);

console.log("Build complete.");
