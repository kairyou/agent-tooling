# Agent Tools

Reusable Agent Skills, plus runtime integrations for Codex, Claude Code, and opencode.

[中文](README.zh-CN.md)

## Repository Structure

```text
agent-tools/
├── .claude-plugin/    # Claude Code/plugin ecosystem manifest.
├── .codex-plugin/     # Codex plugin manifest.
├── integrations/      # Installable capabilities, one directory each; files named by agent + form.
│   ├── statusline/    # Claude Code command-backed statusLine script.
│   ├── usage/         # Provider usage (query core + codex hook, opencode plugins, CLI, at-usage skill template).
│   └── vision/        # Cross-model image understanding (inspect_image MCP server + at-vision skill).
├── skills/            # Reusable Agent Skills for CLI discovery and plugin manifests.
│   ├── workflow/      # Workflow-oriented skills.
│   │   ├── at-commit/   # Conventional Commit message skill.
│   │   ├── at-review/   # Review changes for bugs and regressions.
│   │   └── at-simplify/ # Reduce complexity and duplication in changes.
│   └── integrations/  # Skills that integrate external systems.
│       └── at-zentao/   # ZenTao bug/task fixing workflow.
└── scripts/           # Install, sync, validation, and maintenance scripts.
```

## Skills

### Install

```bash
# List available skills
npx -y skills@latest add kairyou/agent-tools --list

# Install globally (pass one or more names after --skill)
npx -y skills@latest add kairyou/agent-tools --skill <name...> -g -y
```

### at-commit

Generate a Conventional Commits message from staged changes and wait for user confirmation before committing.

```bash
npx -y skills@latest add kairyou/agent-tools --skill at-commit -g -y
```

- Usage: `/at-commit [<language>]` — language for the commit description (Conventional Commits tokens stay in English)

### at-review

Review changes for correctness bugs, regressions, convention violations, and high-value cleanup findings.

```bash
npx -y skills@latest add kairyou/agent-tools --skill at-review -g -y
```

- Usage: `/at-review [--fix] [<pr|branch|path>]` — reports findings; `--fix` also applies them

### at-simplify

Refactor changes to reduce duplication, lower complexity, and improve code quality.

```bash
npx -y skills@latest add kairyou/agent-tools --skill at-simplify -g -y
```

- Usage: `/at-simplify [<pr|branch|path>]`

### at-zentao

Work ZenTao (禅道) bugs/tasks end to end: fix, verify, stage; asks before committing and before writing status back.

```bash
npx -y skills@latest add kairyou/agent-tools --skill at-zentao -g -y
```

Usage:

- `/at-zentao bugs` — list bugs assigned to you (the configured account); pick one or several (several = batch mode)
- `/at-zentao tasks` — same, for tasks
- `/at-zentao bug <id>` — work a specific bug
- `/at-zentao task <id>` — work a specific task

Config: `~/.agent-tools/config.jsonc` → `"zentao": { "url", "account", "password" }`. First run guides you; fill `password` in the file yourself (or env `ZENTAO_PASSWORD`), never in chat.

## Integrations

Runtime capabilities, installed per agent:

```bash
npx -y @kairyou/agent-tools@latest <capability> -a <agent...>
```

`--dry-run` previews, `--uninstall` removes, and re-running the install command
updates.

| Capability | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| `statusline` | ✓ | – | – |
| `usage` | `/at-usage` skill | hook + `$at-usage` skill | toast + `/at-usage` command |
| `vision` | ✓ | ✓ | ✓ |

### Statusline

```bash
npx -y @kairyou/agent-tools@latest statusline -a claude
```

The installer writes `statusLine` to `~/.claude/settings.json`. The default
output is:

```text
⎇ main | Opus 4.8 | 5h 7% ⟳2h54m | w 41% ⟳3d1h
```

Here `5h` and `w` are Claude's rolling usage windows; `⟳` is the reset countdown.
When a compatible API relay is active, the statusline also appends provider usage.

To choose what appears, edit `statusline.fields` in
`~/.agent-tools/config.jsonc`. The installer may add new default keys on update;
it preserves top-of-file comments and existing values.

### Provider usage

Shows the active API provider's balance / quota inside each agent.

```bash
npx -y @kairyou/agent-tools@latest usage -a claude
npx -y @kairyou/agent-tools@latest usage -a codex
npx -y @kairyou/agent-tools@latest usage -a opencode
```

- **Claude Code** — installs the `at-usage` skill into `~/.claude/skills`; invoke
  `/at-usage` to show the current usage in the conversation.
- **Codex** — adds a hook to `UserPromptSubmit` and `Stop` in `~/.codex/hooks.json`
  and the `at-usage` skill to `~/.agents/skills`. Run `/hooks` inside Codex once
  to approve it. Hook output only appears in the Codex CLI; in clients that do
  not show it (e.g. Paseo), invoke `$at-usage`.
- **OpenCode** — adds server and TUI plugins: usage refreshes when the session
  goes idle and shows as a toast, and `/at-usage` shows the latest cached value.
  Restart opencode after installing or updating.

Output examples:

```text
# Subscription / plan quota.
API | D $0.0/$100 | W $0.0/$300 | Exp 07-08

# Wallet balance.
API | balance $362 | today $61.7 | 30d $566
```

Fields: `D/W/M` are daily/weekly/monthly spend against plan limits; `Exp` is
the plan expiry; `balance` is wallet credit; `today` and `30d` are API spend.

#### Supported gateways

Balance, quota, and plan usage queries support compatible Sub2API-like,
NewAPI/OneAPI/OneHub/DoneHub/Veloera/AnyRouter-like, and OpenRouter gateways.

### Vision (cross-model image understanding)

Lets a main model that cannot see images ask a multimodal model specific questions about an image (local path or http(s) URL) and reason on from the answers. Typical uses: reading error screenshots, implementing UI from design mockups, locating the glitch in a bug-report screenshot. One installer capability bundling three parts: the `inspect_image` MCP stdio server, the `at-vision` policy skill, and a human diagnostic CLI.

#### Install

```bash
npx -y @kairyou/agent-tools@latest vision -a claude
npx -y @kairyou/agent-tools@latest vision -a codex claude opencode
```

Uninstalling keeps your vision provider config. The installer registers the
`inspect_image` MCP server for each agent (Claude Code: `~/.claude.json`; Codex:
`~/.codex/config.toml`; OpenCode: `opencode.json`) and installs the `at-vision`
skill into the agent's skills directory.

#### Configure

`~/.agent-tools/config.jsonc` is the only config entry point:

```jsonc
{
  "vision": {
    "provider": "openai-compatible",       // or "anthropic-compatible"
    "baseUrl": "https://gateway.example.com/v1",  // anthropic-compatible: gateway root, /v1/messages is appended
    "model": "internal-vlm",
    "apiKey": { "env": "OPENAI_API_KEY" }  // reuse an existing env var, or the key itself
    // optional: "timeoutMs": 30000, "maxImageBytes": 20971520, "maxOutputTokens": 8192,
    //           "maxConcurrentRequests": 2, "maxRequestsPerMinute": 30
  }
}
```

`apiKey` takes the key itself, or `{ "env": "VARIABLE_NAME" }` to reuse an existing environment variable; omit it if your gateway needs no key.
The runtime sends provider requests directly, so the API key never enters a shell command; user-facing errors redact it as `***`. `maxConcurrentRequests` and `maxRequestsPerMinute` are shared across local MCP and CLI processes.
Image bytes are streamed into the provider's base64 JSON request without recompression; URL inputs use a private temporary file that is removed after each request.

#### Use

Pass images as file paths or URLs in your message. The agent prefers the `inspect_image` MCP tool and falls back to the installed local vision CLI when its model gateway cannot invoke MCP namespace tools. Do not paste screenshots directly: with a non-vision main model the paste fails with an API 400 before any tool runs — save the image and give its path instead.

To diagnose the provider setup or test recognition quality manually:

```bash
npx -y @kairyou/agent-tools@latest inspect-image <path|url> -q "What are the navbar background color and height?"
```

## Run from Git

To run directly from the repository, replace the npm package name with
`github:kairyou/agent-tools` (Git required):

```bash
npx -y github:kairyou/agent-tools usage -a codex
```

## FAQ

### Why does global installation fail for PromptScript?

`PromptScript does not support global skill installation` means that the
PromptScript agent does not support global installation. It does not affect
other agents and can be ignored. See [`skills` issue #1352](https://github.com/vercel-labs/skills/issues/1352).

## References

- [OpenCommit](https://github.com/di-sukharev/opencommit)
- [GitLens](https://github.com/gitkraken/vscode-gitlens)
- [claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)

## Notes

- The installer marks and removes only the config entries it owns.
- Run local checks with `npm test`.
