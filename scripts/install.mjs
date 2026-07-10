#!/usr/bin/env node
// agent-tools installer: wires statusline / usage into each agent's config.
// Skills are NOT handled here — install those with `npx skills add`.
//
// Capabilities (all global for now — they target the user-level config):
//   statusline  Claude Code statusLine script (claude only).
//   usage       Codex hook showing active API provider quota/balance.
//
// Targets:
//   claude -> ~/.claude/settings.json (statusLine key)
//   codex  -> ~/.codex/hooks.json     (standalone hooks file)
// Runtime scripts are copied into ~/.agent-tools so this installer can be
// run via npx from GitHub without requiring a persistent local clone.
//
// NOTE: Codex will not run a freshly-installed hook until you trust it — run
// `/hooks` inside Codex and approve the agent-tools usage hooks.
//
// Usage:
//   agent-tools <capabilities> [options]
//
// Options:
//   -a, --agent <names>       Target agents: claude | codex.
//                             Default: claude.
//   --settings <path>         Override the Claude settings.json (for testing).
//   --codex-hooks <path>      Override the Codex hooks.json (for testing).
//   --uninstall               Remove what this installer added, restoring backups.
//   --dry-run                 Print planned changes without writing anything.
//   -h, --help                Show this help.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_ROOT =
  process.env.AGENT_TOOLS_HOME || path.join(os.homedir(), ".agent-tools");
const META_KEY = "_agentTools";
const META_VERSION = 1;
const SOURCE = {
  codexUsageHook: path.join(REPO_ROOT, "hooks", "codex", "usage-hook.mjs"),
  usageScript: path.join(REPO_ROOT, "lib", "usage.mjs"),
  config: path.join(REPO_ROOT, "config.default.jsonc"),
  claudeStatusline: path.join(REPO_ROOT, "statusline", "claude", "statusline.mjs"),
};
const RUNTIME = {
  codexUsageHook: path.join(INSTALL_ROOT, "hooks", "codex", "usage-hook.mjs"),
  usageScript: path.join(INSTALL_ROOT, "lib", "usage.mjs"),
  config: path.join(INSTALL_ROOT, "config.jsonc"),
  claudeStatusline: path.join(INSTALL_ROOT, "statusline", "claude", "statusline.mjs"),
};
const ALL_CAPS = ["statusline", "usage"];
const ALL_AGENTS = ["claude", "codex"];
const AGENT_CAPS = {
  claude: ["statusline"],
  codex: ["usage"],
};

function fwd(p) {
  return p.replace(/\\/g, "/");
}

function nodeCmd(absScript) {
  return `node "${fwd(absScript)}"`;
}

function stripJsonComments(input) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (inString) {
      out += ch;
      escaped = ch === "\\" ? !escaped : false;
      if (ch === "\"" && !escaped) inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function readJsonc(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return raw.trim() ? JSON.parse(stripJsonComments(raw)) : {};
}

function headerComments(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = [];
  for (const line of lines) {
    if (/^\s*(?:\/\/.*)?$/.test(line)) {
      header.push(line);
      continue;
    }
    break;
  }
  return header.length ? header.join("\n").replace(/\s+$/, "") + "\n" : "";
}

function mergeDefaults(target, defaults) {
  if (Array.isArray(defaults)) return target === undefined ? defaults : target;
  if (!defaults || typeof defaults !== "object") {
    return target === undefined ? defaults : target;
  }
  const out = target && typeof target === "object" && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(defaults)) {
    out[key] = mergeDefaults(out[key], value);
  }
  return out;
}

function writeText(file, text, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] would write ${file}:`);
    console.log(text.split("\n").map((l) => "    " + l).join("\n"));
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`  wrote ${file}`);
}

function mergeJsoncFile(src, dest, dryRun) {
  const defaults = readJsonc(src);
  const defaultHeader = headerComments(fs.readFileSync(src, "utf8"));
  if (!fs.existsSync(dest)) {
    writeText(dest, fs.readFileSync(src, "utf8"), dryRun);
    return;
  }
  const currentText = fs.readFileSync(dest, "utf8");
  const current = readJsonc(dest);
  const merged = mergeDefaults(current, defaults);
  const currentHeader = headerComments(currentText) || defaultHeader;
  const mergedText = currentHeader + JSON.stringify(merged, null, 2) + "\n";
  if (stripJsonComments(currentText).trim() === JSON.stringify(merged, null, 2)) {
    console.log(`  kept existing ${dest}`);
    return;
  }
  writeText(dest, mergedText, dryRun);
}

function copyRuntimeFile(src, dest, dryRun, options = {}) {
  if (options.mergeJsonc) {
    mergeJsoncFile(src, dest, dryRun);
    return;
  }
  if (dryRun) {
    console.log(`  [dry-run] would copy ${src} -> ${dest}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function installRuntimeAssets(opts) {
  if (opts.uninstall) return;
  const files = [];
  function addFile(src, dest, options) {
    if (!files.some(([, existingDest]) => existingDest === dest)) files.push([src, dest, options]);
  }
  if (wants(opts, "statusline")) {
    addFile(SOURCE.claudeStatusline, RUNTIME.claudeStatusline);
    addFile(SOURCE.usageScript, RUNTIME.usageScript);
    addFile(SOURCE.config, RUNTIME.config, { mergeJsonc: true });
  }
  if (wants(opts, "usage")) {
    addFile(SOURCE.codexUsageHook, RUNTIME.codexUsageHook);
    addFile(SOURCE.usageScript, RUNTIME.usageScript);
    addFile(SOURCE.config, RUNTIME.config, { mergeJsonc: true });
  }
  if (files.length === 0) return;
  console.log(`runtime: ${INSTALL_ROOT}`);
  for (const [src, dest, options] of files) copyRuntimeFile(src, dest, opts.dryRun, options);
}

function parseArgs(argv) {
  const opts = {
    agents: [],
    capabilities: [],
    settings: null,
    codexHooks: null,
    uninstall: false,
    dryRun: false,
    help: false,
  };
  function readAgentValues(index, option) {
    const values = [];
    let i = index + 1;
    while (i < argv.length && ALL_AGENTS.includes(argv[i])) {
      values.push(argv[i]);
      i++;
    }
    if (values.length === 0) {
      console.error(`Missing value for ${option}`);
      process.exit(2);
    }
    return { values, next: i - 1 };
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-a":
      case "--agent": {
        const parsed = readAgentValues(i, a);
        opts.agents.push(...parsed.values);
        i = parsed.next;
        break;
      }
      case "--settings": opts.settings = argv[++i]; break;
      case "--codex-hooks": opts.codexHooks = argv[++i]; break;
      case "--uninstall": opts.uninstall = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "-h":
      case "--help": opts.help = true; break;
      default:
        if (a.startsWith("-")) {
          console.error(`Unknown option: ${a}`);
          process.exit(2);
        }
        opts.capabilities.push(a);
    }
  }
  if (opts.agents.length === 0) opts.agents = ["claude"];
  if (!opts.help && opts.capabilities.length === 0) {
    console.error(`Missing capability (available: ${ALL_CAPS.join(", ")})`);
    process.exit(2);
  }
  for (const name of opts.capabilities) {
    if (!ALL_CAPS.includes(name)) {
      console.error(`Unknown capability: ${name} (available: ${ALL_CAPS.join(", ")})`);
      process.exit(2);
    }
  }
  return opts;
}

function wants(opts, cap) {
  return opts.capabilities.length === 0 || opts.capabilities.includes(cap);
}

function validateAgentCapabilities(opts) {
  const invalid = [];
  for (const agent of opts.agents) {
    const supported = AGENT_CAPS[agent] || [];
    for (const cap of opts.capabilities) {
      if (!supported.includes(cap)) invalid.push(`${cap} -a ${agent}`);
    }
  }
  if (invalid.length === 0) return;

  console.error(`Unsupported capability/agent combination: ${invalid.join(", ")}`);
  console.error("Supported combinations:");
  for (const agent of ALL_AGENTS) {
    console.error(`  ${agent}: ${AGENT_CAPS[agent].join(", ")}`);
  }
  console.error("Claude API usage is refreshed by the statusline capability; use `statusline -a claude`.");
  process.exit(2);
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  // Strip a UTF-8 BOM (common on Windows-authored files) before parsing.
  let raw = fs.readFileSync(file, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip UTF-8 BOM
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Cannot parse ${file} as JSON: ${err.message}`);
  }
}

function writeJson(file, data, dryRun) {
  const text = JSON.stringify(data, null, 2) + "\n";
  if (dryRun) {
    console.log(`  [dry-run] would write ${file}:`);
    console.log(text.split("\n").map((l) => "    " + l).join("\n"));
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`  wrote ${file}`);
}

function removeFile(file, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] would remove now-empty ${file}`);
    return;
  }
  fs.rmSync(file, { force: true });
  console.log(`  removed now-empty ${file}`);
}

function usageEntry() {
  return {
    hooks: [
      {
        type: "command",
        command: nodeCmd(RUNTIME.codexUsageHook),
        timeout: 5,
        statusMessage: "Refreshing API usage",
      },
    ],
  };
}

function isOurProviderUsageEntry(entry) {
  return (
    entry &&
    Array.isArray(entry.hooks) &&
    entry.hooks.some(
      (h) =>
        typeof h?.command === "string" &&
        /(?:^|[/\\])(?:usage-hook|usage)\.mjs(?:["\s]|$)/.test(h.command)
    )
  );
}

function applyProviderUsage(cfg, { remove }) {
  cfg.hooks = cfg.hooks || {};
  const events = ["UserPromptSubmit", "Stop"];
  for (const event of events) {
    if (remove) {
      if (cfg.hooks[event]) {
        cfg.hooks[event] = cfg.hooks[event].filter((entry) => !isOurProviderUsageEntry(entry));
        if (cfg.hooks[event].length === 0) delete cfg.hooks[event];
      }
      continue;
    }
    cfg.hooks[event] = cfg.hooks[event] || [];
    cfg.hooks[event] = cfg.hooks[event].filter((entry) => !isOurProviderUsageEntry(entry));
    cfg.hooks[event].push(usageEntry());
  }
  if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
}

// ---- Claude: statusLine backed up in _agentTools. ----

function runClaude(opts) {
  const settings = opts.settings || path.join(os.homedir(), ".claude", "settings.json");
  console.log(`claude (global): ${settings}`);
  const cfg = readJson(settings);
  cfg[META_KEY] = cfg[META_KEY] || { version: META_VERSION, managed: {} };
  cfg[META_KEY].managed = cfg[META_KEY].managed || {};
  const managed = cfg[META_KEY].managed;

  if (wants(opts, "statusline")) {
    if (opts.uninstall) {
      if (managed.statusLine) {
        if (managed.statusLine.backup) {
          cfg.statusLine = managed.statusLine.backup;
          console.log("  - statusline (restored previous)");
        } else {
          delete cfg.statusLine;
          console.log("  - statusline");
        }
        delete managed.statusLine;
      }
    } else {
      const command = nodeCmd(RUNTIME.claudeStatusline);
      const alreadyOurs = Boolean(managed.statusLine);
      managed.statusLine = {
        backup: alreadyOurs ? managed.statusLine.backup ?? null : cfg.statusLine ?? null,
      };
      cfg.statusLine = { type: "command", command, padding: 0, refreshInterval: 60 };
      console.log("  + statusline");
    }
  }

  if (Object.keys(managed).length === 0) delete cfg[META_KEY];
  writeJson(settings, cfg, opts.dryRun);
}

// ---- Codex: hooks in a standalone hooks.json. No meta key is
// written (Codex validates hooks.json against a schema); our hook is found by
// command signature instead. ----

function runCodex(opts) {
  if (!wants(opts, "usage")) {
    console.log("codex: nothing to do (supports: usage).");
    return;
  }
  const file = opts.codexHooks || path.join(os.homedir(), ".codex", "hooks.json");
  console.log(`codex (global): ${file}`);
  const cfg = readJson(file);

  if (wants(opts, "usage")) {
    if (opts.uninstall) {
      applyProviderUsage(cfg, { remove: true });
      console.log("  - usage");
    } else {
      applyProviderUsage(cfg, { remove: false });
      console.log("  + usage (UserPromptSubmit + Stop)");
    }
  }

  if (opts.uninstall && Object.keys(cfg).length === 0 && fs.existsSync(file)) {
    removeFile(file, opts.dryRun);
    return;
  }

  writeJson(file, cfg, opts.dryRun);

  if (!opts.uninstall && !opts.dryRun) {
    console.log(
      "  NOTE: Codex will not run this hook until you trust it — run `/hooks` " +
        "inside Codex and approve the agent-tools hooks."
    );
  }
}

const AGENTS = { claude: runClaude, codex: runCodex };

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    // Print only the top-of-file header comment block (stop at the first
    // non-comment line so internal `// ----` section dividers don't leak).
    const help = [];
    for (const line of fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n")) {
      if (line.startsWith("#!")) continue;
      if (line.startsWith("//")) help.push(line.replace(/^\/\/ ?/, ""));
      else if (help.length) break;
    }
    console.log(help.join("\n"));
    return;
  }
  validateAgentCapabilities(opts);
  installRuntimeAssets(opts);
  for (const name of opts.agents) {
    const run = AGENTS[name];
    if (!run) {
      console.error(`Unsupported agent: ${name} (supported: ${Object.keys(AGENTS).join(", ")})`);
      process.exit(2);
    }
    run(opts);
  }
}

main();
