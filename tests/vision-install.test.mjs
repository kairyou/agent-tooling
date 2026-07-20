import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_SCRIPT = join(ROOT, "scripts", "install.mjs");

// Every run gets an isolated AGENT_TOOLS_HOME so tests never write into the
// real ~/.agent-tools; deps installation is skipped (covered by real installs).
const FALLBACK_HOME = mkdtempSync(join(tmpdir(), "at-vision-install-home-"));
const SKILL_MARKER = ".agent-tools-managed.json";

function runInstall(args, env = {}) {
  const result = spawnSync(process.execPath, [INSTALL_SCRIPT, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      AGENT_TOOLS_HOME: FALLBACK_HOME,
      ...env,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function tmp() {
  return mkdtempSync(join(tmpdir(), "at-vision-install-"));
}

function runtimeServerPath(home) {
  return join(home, "vision-runtime", "mcp-server.mjs").replace(/\\/g, "/");
}

// ---- claude ----

test("claude vision install/uninstall manages ~/.claude.json, the runtime, and the skill", () => {
  const dir = tmp();
  const home = join(dir, "agent-tools-home");
  const claudeJson = join(dir, "claude.json");
  const skillsDir = join(dir, "skills");
  writeFileSync(
    claudeJson,
    JSON.stringify({ mcpServers: { other: { command: "keep-me" } }, someState: 42 })
  );
  const args = ["vision", "-a", "claude", "--claude-json", claudeJson, "--claude-skills-dir", skillsDir];
  const env = { AGENT_TOOLS_HOME: home };

  runInstall(args, env);
  let cfg = JSON.parse(readFileSync(claudeJson, "utf8"));
  assert.deepEqual(cfg.mcpServers["agent-tools-vision"], {
    type: "stdio",
    command: "node",
    args: [runtimeServerPath(home)],
  });
  assert.equal(cfg.mcpServers.other.command, "keep-me");
  assert.equal(cfg.someState, 42);
  assert.ok(existsSync(join(skillsDir, "at-vision", "SKILL.md")));
  assert.match(
    readFileSync(join(skillsDir, "at-vision", "SKILL.md"), "utf8"),
    /callable MCP tool, not an MCP resource/
  );
  assert.ok(existsSync(join(skillsDir, "at-vision", SKILL_MARKER)));
  // Runtime copied into AGENT_TOOLS_HOME with a deps manifest.
  assert.ok(existsSync(join(home, "vision-runtime", "mcp-server.mjs")));
  assert.ok(existsSync(join(home, "vision-runtime", "cli.mjs")));
  const runtimeMeta = JSON.parse(readFileSync(join(home, "vision-runtime", "runtime.json"), "utf8"));
  assert.equal(runtimeMeta.owner, "@kairyou/agent-tools");
  assert.ok(!existsSync(join(home, "vision-runtime", "node_modules")));

  // Reinstall is idempotent.
  runInstall(args, env);
  const again = JSON.parse(readFileSync(claudeJson, "utf8"));
  assert.deepEqual(again, cfg);

  runInstall([...args, "--uninstall"], env);
  cfg = JSON.parse(readFileSync(claudeJson, "utf8"));
  assert.equal(cfg.mcpServers["agent-tools-vision"], undefined);
  assert.equal(cfg.mcpServers.other.command, "keep-me");
  assert.equal(cfg.someState, 42);
  assert.ok(!existsSync(join(skillsDir, "at-vision")));
  assert.ok(!existsSync(join(home, "vision-runtime")));
});

test("claude vision preserves an unmanaged same-name MCP entry", () => {
  const dir = tmp();
  const home = join(dir, "agent-tools-home");
  const claudeJson = join(dir, "claude.json");
  const manual = { type: "stdio", command: "node", args: ["custom-server.mjs"] };
  writeFileSync(claudeJson, JSON.stringify({ mcpServers: { "agent-tools-vision": manual } }));
  const args = [
    "vision", "-a", "claude",
    "--claude-json", claudeJson,
    "--claude-skills-dir", join(dir, "skills"),
  ];

  const install = spawnSync(process.execPath, [INSTALL_SCRIPT, ...args], {
    cwd: ROOT,
    env: { ...process.env, AGENT_TOOLS_HOME: home },
    encoding: "utf8",
  });
  assert.notEqual(install.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(claudeJson, "utf8")).mcpServers["agent-tools-vision"], manual);

  runInstall([...args, "--uninstall"]);
  assert.deepEqual(JSON.parse(readFileSync(claudeJson, "utf8")).mcpServers["agent-tools-vision"], manual);
});

test("claude vision migrates the installer-owned legacy runtime path", () => {
  const dir = tmp();
  const home = join(dir, "agent-tools-home");
  const claudeJson = join(dir, "claude.json");
  const legacy = join(home, "vision-runtime", "plugins", "vision", "mcp-server.mjs").replace(/\\/g, "/");
  writeFileSync(
    claudeJson,
    JSON.stringify({ mcpServers: { "agent-tools-vision": { type: "stdio", command: "node", args: [legacy] } } })
  );

  runInstall([
    "vision", "-a", "claude",
    "--claude-json", claudeJson,
    "--claude-skills-dir", join(dir, "skills"),
  ], { AGENT_TOOLS_HOME: home });

  const installed = JSON.parse(readFileSync(claudeJson, "utf8")).mcpServers["agent-tools-vision"];
  assert.deepEqual(installed.args, [runtimeServerPath(home)]);
});

// ---- codex ----

test("codex vision manages a marker block in config.toml without touching other content", () => {
  const dir = tmp();
  const codexConfig = join(dir, "config.toml");
  const skillsDir = join(dir, "skills");
  const original = 'model = "gpt-5"\n\n[mcp_servers.existing]\ncommand = "keep"\n';
  writeFileSync(codexConfig, original);
  const args = ["vision", "-a", "codex", "--codex-config", codexConfig, "--codex-skills-dir", skillsDir];

  runInstall(args);
  let text = readFileSync(codexConfig, "utf8");
  assert.match(text, /model = "gpt-5"/);
  assert.match(text, /\[mcp_servers\.existing\]/);
  assert.match(text, /# >>> agent-tools vision >>>/);
  assert.match(text, /\[mcp_servers\.agent-tools-vision\]/);
  assert.match(text, /vision-runtime[/\\]mcp-server\.mjs/);
  assert.ok(existsSync(join(skillsDir, "at-vision", "SKILL.md")));

  // Reinstall does not duplicate the block.
  runInstall(args);
  text = readFileSync(codexConfig, "utf8");
  assert.equal(text.match(/agent-tools vision >>>/g).length, 1);

  runInstall([...args, "--uninstall"]);
  text = readFileSync(codexConfig, "utf8");
  assert.doesNotMatch(text, /agent-tools-vision/);
  assert.match(text, /model = "gpt-5"/);
  assert.match(text, /\[mcp_servers\.existing\]/);
  assert.ok(!existsSync(join(skillsDir, "at-vision")));
});

test("codex vision installs the skill into ~/.agents/skills by default", () => {
  const dir = tmp();
  const codexConfig = join(dir, "config.toml");
  const skill = join(dir, ".agents", "skills", "at-vision", "SKILL.md");
  const args = ["vision", "-a", "codex", "--codex-config", codexConfig];
  const env = { HOME: dir, USERPROFILE: dir };

  runInstall(args, env);
  assert.ok(existsSync(skill));

  runInstall([...args, "--uninstall"], env);
  assert.ok(!existsSync(join(dir, ".agents", "skills", "at-vision")));
});

test("vision refuses to overwrite an unowned skill and preserves it on uninstall", () => {
  const dir = tmp();
  const codexConfig = join(dir, "config.toml");
  const skillsDir = join(dir, "skills");
  const skillDir = join(skillsDir, "at-vision");
  const manual = join(skillDir, "manual.txt");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(manual, "user-owned\n");
  const args = [
    "vision", "-a", "codex",
    "--codex-config", codexConfig,
    "--codex-skills-dir", skillsDir,
  ];
  const env = {
    ...process.env,
    AGENT_TOOLS_HOME: join(dir, "agent-tools-home"),
  };

  const install = spawnSync(process.execPath, [INSTALL_SCRIPT, ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  assert.notEqual(install.status, 0);
  assert.match(install.stderr, /Refusing to overwrite existing unowned skill directory/);
  assert.equal(readFileSync(manual, "utf8"), "user-owned\n");

  runInstall([...args, "--uninstall"], env);
  assert.equal(readFileSync(manual, "utf8"), "user-owned\n");
});

test("vision adopts a legacy installer-owned skill without a marker", () => {
  const dir = tmp();
  const skillsDir = join(dir, "skills");
  const skillDir = join(skillsDir, "at-vision");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: at-vision
description: legacy
---
# Visual Reasoning Policy
The \`inspect_image\` MCP tool (server \`agent-tools-vision\`) sends one image plus narrow factual questions.
`
  );

  const result = runInstall([
    "vision", "-a", "codex",
    "--codex-config", join(dir, "config.toml"),
    "--codex-skills-dir", skillsDir,
  ], { AGENT_TOOLS_HOME: join(dir, "agent-tools-home") });

  assert.match(result.stdout, /adopting legacy managed skill/);
  assert.ok(existsSync(join(skillDir, SKILL_MARKER)));
  assert.match(readFileSync(join(skillDir, "SKILL.md"), "utf8"), /--request-file/);
});

test("vision skill embeds the installed CLI path for a custom runtime home", () => {
  const dir = tmp();
  const home = join(dir, "custom runtime home");
  const skillsDir = join(dir, "skills");
  runInstall([
    "vision", "-a", "codex",
    "--codex-config", join(dir, "config.toml"),
    "--codex-skills-dir", skillsDir,
  ], { AGENT_TOOLS_HOME: home });

  const skill = readFileSync(join(skillsDir, "at-vision", "SKILL.md"), "utf8");
  const expected = join(home, "vision-runtime", "cli.mjs").replace(/\\/g, "/");
  assert.match(skill, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(skill, /\{\{VISION_CLI_PATH\}\}/);
});

test("vision update atomically replaces the bundled runtime", () => {
  const dir = tmp();
  const home = join(dir, "agent-tools-home");
  const skillsDir = join(dir, "skills");
  const args = [
    "vision", "-a", "codex",
    "--codex-config", join(dir, "config.toml"),
    "--codex-skills-dir", skillsDir,
  ];
  runInstall(args, { AGENT_TOOLS_HOME: home });

  const staleRuntime = join(home, "vision-runtime", "removed-in-update.mjs");
  const staleSkill = join(skillsDir, "at-vision", "removed-in-update.md");
  for (const file of [staleRuntime, staleSkill]) {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "stale\n");
  }

  runInstall(args, { AGENT_TOOLS_HOME: home });
  assert.ok(!existsSync(staleRuntime));
  assert.ok(!existsSync(staleSkill));
  assert.ok(existsSync(join(home, "vision-runtime", "mcp-server.mjs")));
});

test("vision runtime rollback preserves the previous install when the atomic swap fails", () => {
  const dir = tmp();
  const home = join(dir, "agent-tools-home");
  const args = [
    "vision", "-a", "codex",
    "--codex-config", join(dir, "config.toml"),
    "--codex-skills-dir", join(dir, "skills"),
  ];
  runInstall(args, { AGENT_TOOLS_HOME: home });
  const sentinel = join(home, "vision-runtime", "previous-runtime.txt");
  writeFileSync(sentinel, "still working\n");

  const failed = spawnSync(process.execPath, [INSTALL_SCRIPT, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      AGENT_TOOLS_HOME: home,
      AGENT_TOOLS_VISION_TEST_FAIL_SWAP: "1",
    },
    encoding: "utf8",
  });
  assert.notEqual(failed.status, 0);
  assert.equal(readFileSync(sentinel, "utf8"), "still working\n");
  assert.ok(existsSync(join(home, "vision-runtime", "mcp-server.mjs")));
});

test("codex vision refuses to install over a manually configured same-name table", () => {
  const dir = tmp();
  const codexConfig = join(dir, "config.toml");
  const manual = '[mcp_servers.agent-tools-vision]\ncommand = "my-own-thing"\n';
  writeFileSync(codexConfig, manual);
  const result = spawnSync(
    process.execPath,
    [
      INSTALL_SCRIPT, "vision", "-a", "codex",
      "--codex-config", codexConfig,
      "--codex-skills-dir", join(dir, "skills"),
    ],
    {
      cwd: ROOT,
      env: { ...process.env, AGENT_TOOLS_HOME: FALLBACK_HOME },
      encoding: "utf8",
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not\s+written by this installer/);
  assert.equal(readFileSync(codexConfig, "utf8"), manual);
});

test("codex vision creates config.toml when absent and empties it on uninstall", () => {
  const dir = tmp();
  const codexConfig = join(dir, "config.toml");
  const args = [
    "vision", "-a", "codex",
    "--codex-config", codexConfig,
    "--codex-skills-dir", join(dir, "skills"),
  ];
  runInstall(args);
  assert.match(readFileSync(codexConfig, "utf8"), /agent-tools-vision/);
  runInstall([...args, "--uninstall"]);
  assert.equal(readFileSync(codexConfig, "utf8").trim(), "");
});

// ---- opencode ----

test("opencode vision edits opencode.json in place, preserving comments", () => {
  const dir = tmp();
  const file = join(dir, "opencode.json");
  writeFileSync(
    file,
    '{\n  // user comment stays\n  "theme": "dark",\n  "mcp": {\n    "other": { "type": "local", "command": ["keep"] }\n  }\n}\n'
  );
  const home = join(dir, "agent-tools-home");
  const args = ["vision", "-a", "opencode", "--opencode-config-dir", dir];

  runInstall(args, { AGENT_TOOLS_HOME: home });
  let text = readFileSync(file, "utf8");
  assert.match(text, /\/\/ user comment stays/);
  let cfg = parseJsonc(text);
  assert.deepEqual(cfg.mcp["agent-tools-vision"], {
    type: "local",
    command: ["node", runtimeServerPath(home)],
    enabled: true,
  });
  assert.deepEqual(cfg.mcp.other.command, ["keep"]);
  assert.equal(cfg.theme, "dark");
  assert.ok(existsSync(join(dir, "skills", "at-vision", "SKILL.md")));

  runInstall([...args, "--uninstall"], { AGENT_TOOLS_HOME: home });
  text = readFileSync(file, "utf8");
  assert.match(text, /\/\/ user comment stays/);
  cfg = parseJsonc(text);
  assert.equal(cfg.mcp["agent-tools-vision"], undefined);
  assert.deepEqual(cfg.mcp.other.command, ["keep"]);
  assert.ok(!existsSync(join(dir, "skills", "at-vision")));
  assert.ok(!existsSync(join(home, "vision-runtime")));
});

test("opencode vision preserves an unmanaged same-name MCP entry", () => {
  const dir = tmp();
  const home = join(dir, "agent-tools-home");
  const file = join(dir, "opencode.json");
  const manual = { type: "local", command: ["node", "custom-server.mjs"], enabled: true };
  writeFileSync(file, JSON.stringify({ mcp: { "agent-tools-vision": manual } }));
  const args = ["vision", "-a", "opencode", "--opencode-config-dir", dir];

  const install = spawnSync(process.execPath, [INSTALL_SCRIPT, ...args], {
    cwd: ROOT,
    env: { ...process.env, AGENT_TOOLS_HOME: home },
    encoding: "utf8",
  });
  assert.notEqual(install.status, 0);
  assert.deepEqual(parseJsonc(readFileSync(file, "utf8")).mcp["agent-tools-vision"], manual);

  runInstall([...args, "--uninstall"], { AGENT_TOOLS_HOME: home });
  assert.deepEqual(parseJsonc(readFileSync(file, "utf8")).mcp["agent-tools-vision"], manual);
});

test("opencode vision migrates the installer-owned legacy runtime path", () => {
  const dir = tmp();
  const home = join(dir, "agent-tools-home");
  const file = join(dir, "opencode.json");
  const legacy = join(home, "vision-runtime", "plugins", "vision", "mcp-server.mjs").replace(/\\/g, "/");
  writeFileSync(
    file,
    JSON.stringify({ mcp: { "agent-tools-vision": { type: "local", command: ["node", legacy], enabled: true } } })
  );

  runInstall(["vision", "-a", "opencode", "--opencode-config-dir", dir], {
    AGENT_TOOLS_HOME: home,
  });

  const installed = parseJsonc(readFileSync(file, "utf8")).mcp["agent-tools-vision"];
  assert.deepEqual(installed.command, ["node", runtimeServerPath(home)]);
});

// ---- combined ----

test("one command installs all three agents", () => {
  const dir = tmp();
  const result = runInstall([
    "vision", "-a", "codex", "claude", "opencode",
    "--claude-json", join(dir, "claude.json"),
    "--claude-skills-dir", join(dir, "claude-skills"),
    "--codex-config", join(dir, "config.toml"),
    "--codex-skills-dir", join(dir, "codex-skills"),
    "--opencode-config-dir", join(dir, "opencode"),
  ], { AGENT_TOOLS_HOME: join(dir, "agent-tools-home") });
  assert.match(result.stdout, /claude vision:/);
  assert.match(result.stdout, /codex vision:/);
  assert.match(result.stdout, /opencode vision:/);
  assert.ok(existsSync(join(dir, "claude.json")));
  assert.ok(existsSync(join(dir, "config.toml")));
  assert.ok(existsSync(join(dir, "opencode", "opencode.json")));
});

test("vision uninstall keeps the shared runtime until its last agent reference is removed", () => {
  const dir = tmp();
  const home = join(dir, "agent-tools-home");
  const codexConfig = join(dir, "config.toml");
  const claudeJson = join(dir, "claude.json");
  const common = [
    "--codex-config", codexConfig,
    "--codex-skills-dir", join(dir, "codex-skills"),
    "--claude-json", claudeJson,
    "--claude-skills-dir", join(dir, "claude-skills"),
  ];
  const env = { AGENT_TOOLS_HOME: home };

  runInstall(["vision", "-a", "codex", "claude", ...common], env);
  mkdirSync(join(home, "cache"), { recursive: true });
  writeFileSync(join(home, "cache", "vision-rate-limit.json"), "{}\n");
  runInstall(["vision", "-a", "claude", ...common, "--uninstall"], env);
  assert.ok(existsSync(join(home, "vision-runtime")));
  assert.ok(existsSync(join(home, "cache", "vision-rate-limit.json")));

  runInstall(["vision", "-a", "codex", ...common, "--uninstall"], env);
  assert.ok(!existsSync(join(home, "vision-runtime")));
  assert.ok(!existsSync(join(home, "cache", "vision-rate-limit.json")));
});

test("vision cleanup recognizes a remaining Codex legacy runtime reference", () => {
  const dir = tmp();
  const home = join(dir, "agent-tools-home");
  const codexConfig = join(dir, "config.toml");
  const claudeJson = join(dir, "claude.json");
  const common = [
    "--codex-config", codexConfig,
    "--codex-skills-dir", join(dir, "codex-skills"),
    "--claude-json", claudeJson,
    "--claude-skills-dir", join(dir, "claude-skills"),
  ];
  const env = { AGENT_TOOLS_HOME: home };

  runInstall(["vision", "-a", "codex", "claude", ...common], env);
  const current = join(home, "vision-runtime", "mcp-server.mjs").replace(/\\/g, "/");
  const legacy = join(home, "vision-runtime", "plugins", "vision", "mcp-server.mjs").replace(
    /\\/g,
    "/"
  );
  writeFileSync(codexConfig, readFileSync(codexConfig, "utf8").replace(current, legacy));

  runInstall(["vision", "-a", "claude", ...common, "--uninstall"], env);
  assert.ok(existsSync(join(home, "vision-runtime")));

  runInstall(["vision", "-a", "codex", ...common, "--uninstall"], env);
  assert.ok(!existsSync(join(home, "vision-runtime")));
});

test("dry-run writes nothing", () => {
  const dir = tmp();
  const home = join(dir, "agent-tools-home");
  const claudeJson = join(dir, "claude.json");
  runInstall([
    "vision", "-a", "claude",
    "--claude-json", claudeJson,
    "--claude-skills-dir", join(dir, "skills"),
    "--dry-run",
  ], { AGENT_TOOLS_HOME: home });
  assert.ok(!existsSync(claudeJson));
  assert.ok(!existsSync(join(dir, "skills")));
  assert.ok(!existsSync(join(home, "vision-runtime")));
});
