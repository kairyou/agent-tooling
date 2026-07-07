import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATUSLINE_SCRIPT = join(ROOT, "statusline", "claude", "statusline.mjs");

test("Claude statusline renders configured fields in configured order", () => {
  const temp = mkdtempSync(join(tmpdir(), "agent-tooling-statusline-"));
  const projectDir = join(temp, "project");
  mkdirSync(projectDir, { recursive: true });
  const configFile = join(temp, "config.jsonc");
  writeFileSync(configFile, JSON.stringify({
    statusline: {
      fields: ["directory", "model", "context"],
      separator: " / ",
      symbols: { context: "ctx" },
    },
  }));

  const input = {
    workspace: {
      current_dir: projectDir,
      project_dir: projectDir,
    },
    model: {
      display_name: "Claude Opus 4.8",
    },
    context_window: {
      used_percentage: 42.2,
    },
  };

  const result = spawnSync(process.execPath, [STATUSLINE_SCRIPT], {
    input: JSON.stringify(input),
    env: { ...process.env, AGENT_TOOLING_CONFIG: configFile },
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${basename(projectDir)} / Opus 4.8 / ctx 42%`);
});
