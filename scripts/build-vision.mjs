#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "dist", "vision");
const STAGE_DIR = path.join(ROOT, "dist", `.vision-build-${process.pid}-${Date.now()}`);

try {
  await build({
    entryPoints: {
      "mcp-server": path.join(ROOT, "plugins", "vision", "mcp-server.mjs"),
      cli: path.join(ROOT, "lib", "vision", "cli.mjs"),
    },
    outdir: STAGE_DIR,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    mainFields: ["module", "main"],
    outExtension: { ".js": ".mjs" },
    packages: "bundle",
    sourcemap: false,
    legalComments: "none",
  });

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.renameSync(STAGE_DIR, OUT_DIR);
  console.log(`built ${path.relative(ROOT, OUT_DIR)}`);
} finally {
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
}
