# Claude Code Oversight — Workbench

**Owner:** Billy
**Started:** 2026-04-11
**Status:** 🟡 Research complete — awaiting Billy's answers to 4 clarifying questions + permission to clean up OpenClaw

---

## Problem

Billy is committed to Claude Code Desktop on macOS as the work engine. The harness works well at the model level, but the UX has real friction for someone running 5-8 long-running projects in parallel:

1. **File gap** — Claude creates files, but navigating them means folder-digging through Dropbox, and Claude occasionally puts things in wrong places
2. **Session gap** — No cross-session view of what Claude is actively working on, scheduled to work on, or did yesterday
3. **Status gap** — No cross-project rollup: what's in-progress, what's waiting on Billy, what's blocked, what's done

Requirements for the solution:
- Claude can follow instructions to set it up
- Billy can edit individual parts of the process over time (not a black box)
- Multi-model support preferred but not a dealbreaker
- **Stability is critical** — OpenClaw disqualified for breaking too often
- Prefers file-based / editable systems over opaque apps

---

## The reframe that unlocked everything

**Oversight ≠ orchestration.** OpenClaw's category error was running its own agent stack *alongside* Claude Code rather than *watching* Claude Code. The right shape is a passive observation layer that reads Claude Code's existing session/file state and surfaces it — not a second agent runtime. This reframing disqualifies a large category of tools (Paperclip, Goose, OpenClaw itself) and points toward hooks + file viewers + passive dashboards.

---

## 🚨 Urgent: OpenClaw is actively running and breaking

Research turned up a live, crashing OpenClaw install on Billy's Mac that needs attention regardless of the oversight decision:

- **Install location:** `/Users/billylitmer/.openclaw/`
- **Version:** 2026.4.2, installed 2026-04-03 (~8 days of real use)
- **Workspace:** `/Users/billylitmer/Dropbox/Santa Claude/projects/openclaw-workspace/` (full of setup docs: SETUP-INSTRUCTIONS.md, SOUL.md, IDENTITY.md, HEARTBEAT.md, USER.md, AGENTS.md, TOOLS.md, WORKBENCH.md)
- **Agents configured:** Cletus (orchestrator, Opus 4.6), research/draft (Sonnet 4.6), code (GPT-4o), local (Ollama qwen3:8b), local-heavy (MLX gemma-3-27b-it-4bit)
- **Integrations:** Telegram (@Honestbilly_bot), Google Workspace (gogcli), Apple Notes (memo), Reminders (remindctl), embedded Chromium, built-in cron

**Current failure state (verified 2026-04-11 21:33):**
- `~/.openclaw/logs/gateway.err.log` is **27MB / 363,338 lines**, still actively being written to tonight
- Log is overwhelmingly the port-collision loop: gateway can't start because another instance is already on `ws://127.0.0.1:18789`, fires every 3-5 seconds for days
- **Config drift incident 2026-04-04:** Cletus's model was rewritten to `openai/gpt-5.3` (non-existent model ID) — every run failed with OpenAI 400s until Billy hand-edited openclaw.json
- **7 config backup files** sitting next to the live config (sprawl is itself a tell)
- **18 plaintext secrets in config** per Billy's own workbench notes, Keychain migration pending

**Cleanup plan (Phase 0 below).**

---

## Findings by axis

### 1. Paperclip (paperclipai/paperclip) — Wait, not now

**What it is:** Open-source multi-agent orchestrator launched March 2026 by @dotta. Node.js + React dashboard. Agents = Claude Code sessions (or other). "Zero-human company" framing — you define companies, hire agents, assign tickets, they execute. Tracks budgets, tool calls, decisions, full audit log, threaded conversations across reboots. **Multi-company isolation: one install can run multiple isolated projects with zero cross-visibility — directly relevant to Billy's Honest Eco + boldSQUID + Haldo separation.**

**Concept fit:** Strong. Actually matches Billy's described needs almost exactly.

**Current build reality (the load-bearing finding):**
- 5 weeks old as of 2026-04-11
- ~30-38k GitHub stars but ~2,000+ open issues
- **Issue #24** — M-series Macs not supported (missing `@embedded-postgres/darwin-arm64`)
- **Issue #2273** — silent failure on macOS when Homebrew `libvips` is installed (breaks `sharp` dependency)
- **Issue #1248** — onboarding throws 500s even after wiping install directories
- **Issue #2301** — literally titled "This thing is another AI DISASTER"
- **Issue #1569** — install completes but nothing actually runs

**Verdict:** Right concept, wrong time. Revisit in 2-3 months after install path stabilizes on Apple Silicon. Watchlist item. Do NOT install now.

Sources: paperclipai/paperclip GitHub, paperclip.ing, issues #24/#2273/#1248/#2301/#1569

### 2. OpenClaw — Disqualified (see Urgent section above)

**Category:** Local agent orchestrator / personal AI OS. Closest neighbors: LangGraph, CrewAI, Open Interpreter, Goose.

**Lessons for the replacement (must satisfy):**
1. **No persistent background daemon holding a single port.** Should be (a) read-only filesystem observer, (b) menu-bar app with ephemeral processes, or (c) something inside Claude Code (skill/plugin/MCP)
2. **Read-only by default.** Should observe Claude Code state without mutating configs/credentials/workspaces
3. **Zero secrets in config files.** Use macOS Keychain or Claude's existing auth
4. **Self-healing or stateless.** Crash → restart Claude Code → fine. No lsof, no kill -9
5. **Visibility into Claude Code's actual sessions, not a parallel stack.** Hook `~/.claude/sessions/`, `~/.claude/history.jsonl`, `~/.claude/projects/`, `~/.claude/telemetry/` — don't run your own agents

### 3. Native Claude Code oversight features — The big finding

**Claude Code harness (2026) already has the primitives to close all three gaps without any third-party app.**

**What exists natively:**
- Projects/Workspaces feature: **does not exist as cross-directory dashboard** — sessions are scoped to the currently-selected folder
- Session history: **per-directory only**, JSONL transcripts under `~/.claude/projects/<encoded-dir>/<session-id>.jsonl`, no global "all sessions all projects" browser
- **Schedule page: the closest native "what Claude is working on" view** — shows both local and remote tasks in one grid, per-task history, full past run output clickable
- claude.ai/code web view: only shows **cloud** sessions, not local desktop sessions
- Activity log: plaintext JSONL transcripts exist but no UI reads them as a feed
- Skill/plugin UIs: **all chat-based**, no panel/dashboard API
- File tracking per session: **yes, per-session only** (+12 -1 indicator, diff view on click), no cross-session rollup
- `/tasks`: cloud background sessions only

**The lever: Hooks.** `~/.claude/settings.json` hooks fire on:
- Session lifecycle: `SessionStart`, `SessionEnd`, `InstructionsLoaded`
- Per turn: `UserPromptSubmit`, `Stop`, `StopFailure`
- Per tool call: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`
- File-level: `FileChanged`, `CwdChanged`, `WorktreeCreate`, `WorktreeRemove`
- Tasks: `TaskCreated`, `TaskCompleted`, `SubagentStart`, `SubagentStop`

Each hook receives JSON on stdin with `session_id`, `transcript_path`, `cwd`, `tool_name`, `tool_input`, `tool_response`. Can be `async: true`. **Hooks can write any file on disk.**

**Community projects confirming the pattern works:**
- `disler/claude-code-hooks-multi-agent-observability` — hooks → SQLite → React dashboard via WebSocket
- `hoangsonww/Claude-Code-Agent-Monitor` — Kanban status board of sessions and tool usage
- `simple10/agents-observe` — real-time multi-agent observability
- Claude HUD plugin — "htop for Claude Code" showing context health, active tools, task status

**Layer 1 architecture — zero third-party app needed:**

| Gap | Mechanism | Output file Billy reads |
|---|---|---|
| File gap | Global PostToolUse hook matching `Write|Edit|NotebookEdit` → append JSONL row | `~/Dropbox/Santa Claude/oversight/file-ledger.jsonl` |
| Session gap | Global SessionStart/Stop/SessionEnd hooks → append markdown | `~/Dropbox/Santa Claude/oversight/session-journal.md` |
| Status gap | Daily Desktop scheduled task 8am, folder=Santa Claude root, prompt reads ledger+journal+all workbenches, writes status | `~/Dropbox/Santa Claude/oversight/status-today.md` |
| On-demand refresh | `~/.claude/skills/santa-dashboard/SKILL.md` — trigger `/santa-dashboard` from any session | Opens status-today.md in Finder |

All files plain, editable, in Dropbox. No daemons. No Electron apps. No databases. Matches Billy's existing workbench convention.

Sources: code.claude.com/docs/en/hooks, desktop, desktop-scheduled-tasks, claude-directory, how-claude-code-works

### 4. Landscape scan — Filtered

**Verdict by tool:**

| Tool | Verdict | Rationale |
|---|---|---|
| **ccboard** (FlorianBruniaux) | ✅ Strong candidate | Rust single binary, reads Claude Code session files directly, 492 tests, 0 clippy warnings, 9-tab TUI + web UI, budget alerts, 30-day cost forecasting. Purpose-built for this problem. |
| **Zed + ACP** | ✅ Strong candidate | Zed embeds Claude Code via Agent Client Protocol (first-class, not plugin). Opens `Dropbox/Santa Claude/projects/` as workspace with fast persistent file tree. Solves file-digging pain directly. |
| **Obsidian + Bases core plugin + mcpvault MCP** | ⚠️ Conditional | Bases is now a core plugin (2026), builds auto-updating table/card views over workbench markdown using frontmatter filters. No import — reads plain folders. mcpvault MCP lets Claude read/write vault without Obsidian running. **RISK: vault corruption if Claude writes. Mitigation: git-per-vault with commit-on-every-edit. Viable only if Billy commits to that habit.** |
| **Notion (official MCP)** | ✅ Already configured | Vendor-hosted remote MCP, OAuth one-click, v2.0.0 on API 2025-09-03. `mcp__claude_ai_Notion__*` tools already present in environment. Best fit for narrative project hubs. |
| **Linear (official MCP)** | ✅ If team-shared | HTTP streams, Feb 2026 update added initiatives/milestones/project updates. Only choice if Oskar/Jean need shared visibility. |
| **Raycast + ClaudeCast/Skills Browser** | ⚠️ Optional augment | Rock-solid launcher, Claude-aware extensions exist, good for quick-jump. Nice-to-have, not load-bearing. |
| **Airtable MCP** | Partial | Stable vendor-hosted, but database not project hub. Use for structured data only if needed. |
| **Cursor / Windsurf** | ❌ Wrong posture | Replace Claude Code rather than surround it. |
| **Reflect / Tana / Heptabase** | ❌ Wrong category | Cloud databases, no file access, no MCP. |
| **Logseq + ergut/mcp-logseq** | ❌ Weaker than Obsidian | Smaller community, competing forks. |
| **TypingMind / LibreChat / LobeChat / Jan / Msty** | ❌ Wrong problem | Alternative chat UIs, not oversight. |
| **Goose (Block)** | ❌ Wrong scale | Agent runtime for production, not solo oversight. |
| **n8n / Temporal / Langfuse** | ❌ Wrong scale | Production orchestration / LLM telemetry for developers. |
| **runCLAUDErun** | ❌ Redundant | GUI scheduler; Claude Code has built-in scheduling. |
| **Height / Basecamp / Trello / ClickUp** | ❌ No mature MCP | Wait, not now. |
| **Alfred / LaunchBar** | ❌ No Claude extensions | Generic launchers, not Claude-aware. |
| **Paperclip** | ❌ Too new | See Paperclip section above. |
| **OpenClaw** | ❌ Disqualified | See Urgent section above. |

---

## Three architecture options

**All three include Layer 1 (hooks + briefing + skill).** The difference is the visual layer on top.

| Axis | **Stack A — Minimal** | **Stack B — File-first** | **Stack C — Team-shared** |
|---|---|---|---|
| Visual layer | Notion (have) + ccboard + Zed | Obsidian + Bases + mcpvault MCP + ccboard | Linear + Notion + ccboard |
| File tree visible | Zed | Obsidian vault view | Notion page hierarchy (weaker) |
| Session activity | ccboard | ccboard | ccboard |
| Status dashboard | Notion pages via MCP | Obsidian Bases tables over frontmatter | Linear issues + Notion narrative |
| New apps to install | 2 (ccboard + Zed) | 2 (Obsidian + ccboard) | 1 (ccboard) |
| Claude can fully auto-configure | Mostly (Zed needs 1 GUI click) | Yes | Mostly (Linear MCP auth) |
| Oskar/Jean see same view | No | No | **Yes** |
| Risk if Claude writes wrong place | Low | Medium (vault) | Low |
| Monthly cost | $0 | $0 | ~$10/mo Linear |
| Best for | Solo + narrative oversight, minimal surface | Solo + file-based PKM style | Team visibility with dev team |

---

## Four clarifying questions for Billy

1. **Team visibility** — Do Oskar and Jean need to see the same status dashboard you see, or is this purely for your own oversight? (Yes → Stack C. No → A or B.)

2. **Narrative or table** — When you look at a project, do you want to read "what's happening, what's blocked" (narrative) or see "X tasks open, Y done, Z waiting" (table)? (Narrative → Stack A. Table → Stack B.)

3. **Git-per-vault habit** — Would you commit to git-committing your vault every time a workbench gets edited, in exchange for letting Claude Code write to it? (No → Stack B disqualified. Yes → B viable.)

4. **Cost forecasting** — Do you want "how much am I spending on Claude tokens per project per week" in your oversight view, or is "what is Claude working on right now" enough? (Yes → ccboard mandatory. No → lighter-weight options possible.)

---

## Phased plan

| Phase | What | Blast radius | Billy action |
|---|---|---|---|
| **0. OpenClaw cleanup** | Stop gateway, archive `~/.openclaw/`, rotate leaked keys, move openclaw-workspace to `archived/`, add to memory as disqualified. Preserve incident notes as evidence. | Stops active crash loop, reclaims disk, removes plaintext secret exposure | Approve |
| **1. Layer 1 setup** | Hooks (PostToolUse file ledger + SessionStart/Stop/SessionEnd journal), morning briefing scheduled task, `/santa-dashboard` skill | Additive only, no risk | Approve |
| **2. Answer 4 questions** | Pick Stack A/B/C | None | 5 min |
| **3. Visual layer install** | ccboard + (Zed OR Obsidian OR Linear) per answer | Low for A/C, medium for B | Approve |
| **4. Shakedown** | 2 weeks, tune hooks, refine briefing prompt, workbench frontmatter conventions | None | Use it |
| **5. Revisit Paperclip** | Check if install path stabilized on Apple Silicon | None | Re-evaluate |

---

## Decisions (pending)

- [ ] Approve Phase 0 OpenClaw cleanup
- [ ] Answer 4 clarifying questions
- [ ] Pick Stack A/B/C
- [ ] Approve Layer 1 setup
- [ ] Approve visual layer setup

## Open questions

- Exact cleanup steps for OpenClaw (need to check LaunchAgent, verify no Keychain entries, identify any actively-used agent outputs worth preserving)
- Whether any of the 18 plaintext OpenClaw secrets need to be rotated at their source (check openclaw.json for which providers are keyed)
- Exact Bases plugin frontmatter schema if Stack B wins
- Whether ccboard's "30-day cost forecasting" needs Claude API account data Billy doesn't have on his subscription

## To-do

- [ ] Billy reads this workbench
- [ ] Billy approves Phase 0 cleanup OR asks for more info first
- [ ] Billy answers 4 clarifying questions
- [ ] Santa drafts Phase 0 cleanup step-by-step plan
- [ ] Santa drafts Layer 1 setup prompts
- [ ] Santa drafts chosen-stack setup prompts
- [ ] Execute in sequence

## Change log

- **2026-04-11** — Workbench created. Four-axis research complete (Paperclip, OpenClaw, native Claude Code features, landscape scan). Key reframe: "oversight ≠ orchestration." OpenClaw confirmed live-running and crashing on Billy's Mac (27MB err log, 363K lines, 7 config backups, 18 plaintext secrets). Layer 1 hooks-based architecture identified as zero-app solution for 80% of the problem. Three visual-layer stacks (A Minimal / B File-first / C Team-shared) drafted with 4 clarifying questions to pick between them. Paperclip wait-list until install path stabilizes. All non-Claude-Code-aware tools disqualified.
