#!/usr/bin/env node
// Local CLI used by the managed at-usage skills.

import { queryAgentProviderUsage } from "./core.mjs";

function parseAgent(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--agent" && argv[index + 1]) return argv[index + 1];
    if (arg.startsWith("--agent=")) return arg.slice("--agent=".length);
  }
  return null;
}

const agent = parseAgent(process.argv.slice(2));
if (agent !== "claude" && agent !== "codex") {
  process.stderr.write(agent ? `Unsupported agent: ${agent}\n` : "Missing --agent <claude|codex>\n");
  process.exitCode = 2;
} else {
  try {
    const result = await queryAgentProviderUsage(agent);
    if (result?.text) process.stdout.write(`${result.text}\n`);
  } catch {
    // Usage is informational. Leave stdout empty so the skill can report the
    // provider as unavailable without exposing endpoint or credential details.
  }
}
