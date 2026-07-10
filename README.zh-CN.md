# Agent Tools

面向 Codex、Claude Code 与 opencode 的可复用 skills, 以及面向 Codex 与 Claude Code 的 runtime integrations. 本仓库把各项能力放在可预期的位置; 不同项目可以只安装自己需要的部分.

## 目录结构

```text
agent-tools/
├── .claude-plugin/    # Claude Code/plugin 生态的 manifest。
├── .codex-plugin/     # Codex plugin manifest。
├── hooks/             # 通用 hook 逻辑及各 agent 的适配实现。
├── scripts/           # 安装、同步、校验和仓库维护脚本。
├── skills/            # 可复用 Agent Skills，供 CLI 扫描和 plugin manifest 声明。
│   └── workflow/      # 工作流类 skills。
│       ├── at-commit/   # 生成 Conventional Commits message.
│       ├── at-review/   # 审查改动中的 bug 与回归风险.
│       └── at-simplify/ # 减少改动中的冗余和复杂度.
├── statusline/        # Statusline 配置片段/模板，按 agent 分组。
│   └── claude/        # Claude command-backed statusLine 脚本和示例配置。
└── lib/               # hooks、statusline、installer 复用的共享实现。
```

## 当前 Skills

- `at-commit`: 根据暂存区改动生成 Conventional Commits message, 并在提交前等待用户确认.
- `at-review`: 审查改动中的正确性 bug, 回归风险, 约定违规和高价值清理项.
- `at-simplify`: 重构改动, 减少冗余, 降低复杂度, 提升代码质量.

## 使用方式

查看可用 skills：

```bash
npx -y skills@latest add kairyou/agent-tools --list
```

全局安装 skill：

```bash
npx -y skills@latest add kairyou/agent-tools --skill at-commit -g -y
```

项目级安装：

```bash
# 如果安装结果可能提交到 Git，优先使用 --copy，不要提交 symlink。
npx -y skills@latest add kairyou/agent-tools --skill at-commit --copy -y
```

多个 skill 可以跟在 `--skill` 后面，例如 `--skill at-commit at-review at-simplify`。

## 安装 statusline 与 usage

用仓库内置安装器安装 runtime capabilities：

```bash
# Claude statusLine
npx -y github:kairyou/agent-tools statusline -a claude

# Codex API usage
npx -y github:kairyou/agent-tools usage -a codex

# 预览或卸载
npx -y github:kairyou/agent-tools usage -a codex --dry-run
npx -y github:kairyou/agent-tools usage -a codex --uninstall
```

安装器会把运行时脚本复制到 `~/.agent-tools/`，然后让各 agent 配置指向这里。

已接线能力：

- **Claude** —— `statusLine`，写入 `~/.claude/settings.json`。
- **Codex** —— `usage` hook，写入 `~/.codex/hooks.json`。

`usage` 会显示兼容 Sub2API-like、NewAPI/OneAPI/OneHub/DoneHub/
Veloera/AnyRouter-like 与 OpenRouter 网关的余额、额度或套餐用量；Codex 通过 hook
显示，Claude statusLine 在使用兼容中转时会自动追加。

显示效果示例：

```text
# 订阅/套餐额度。
warning: API | D $0.0/$100 | W $0.0/$300 | Exp 07-08

# 钱包余额。
warning: API | balance $362 | today $61.7 | 30d $566
```

字段含义：`D/W/M` 是日/周/月套餐消耗与上限，`Exp` 是套餐到期日，
`balance` 是钱包余额，`today` / `30d` 是今日与近 30 天 API 消耗。

安装 Codex hook 后，需要在 Codex 里运行 `/hooks` 并批准 agent-tools usage hooks。

Claude statusLine 默认显示：

```text
⎇ main | Opus 4.8 | 5h 7% ⟳2h54m | w 41% ⟳3d1h
```

其中 `5h` / `w` 是 Claude 的滚动用量窗口，`⟳` 后面是重置倒计时。

如需控制显示项，直接修改 `~/.agent-tools/config.jsonc` 里的 `statusline.fields`。
安装器更新时可能会补充新的默认键；文件顶部注释和已有值会保留。

## 说明

- `skills/` 放可复用的 `SKILL.md` 能力。项目可以只安装自己需要的 skills。
- `hooks/` 按通用逻辑和各 agent 适配实现划分目录。
- `statusline/claude/` 放 Claude command-backed statusLine 脚本。
- `lib/` 放 API usage 查询等共享实现。
- 安装器只标记并移除自己写入的配置项。

本地检查运行 `npm test`。
