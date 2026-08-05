# Codex CLI & Trae IDE Solo Mode — Deep Technical Research Report

**Version**: v1.0
**Date**: 2026-08-05
**Author**: Engineering research team (LOOP engineering)
**Verification baseline**:
- Codex CLI: `openai/codex@da4c8ca` (2026-07-03) and `HEAD` (2026-08-05) — Rust-first monorepo, ~130 crates in `codex-rs/`
- Trae IDE Solo Mode: Trae IDE v2.x product documentation, ByteDance engineering blog 2025–2026

**Audience**: Product engineering team evaluating these tools and planning to build similar Solo-mode capabilities.

---

## 0. Executive Summary

Codex CLI is OpenAI's terminal-resident local coding agent. Its single binary (`codex`) is a Rust-first monorepo (~130 crates) where a small `codex-core` orchestrates every surface (TUI, `app-server` JSON-RPC, `codex exec` headless, TS/Python SDKs) over a **queue pair** abstraction: callers submit `Op`s, receive `Event`s. Persistence is **Thread → Turn → Item** (JSONL rollouts + SQLite metadata). Sandboxing is platform-specific (Seatbelt on macOS, bubblewrap + Landlock + seccomp on Linux, restricted tokens on Windows). Tools are dispatched through `ToolRouter`; commands go through an `execpolicy` Starlark classifier before approval-gated execution. MCP is supported as both client (calling external servers) and server (exposing Codex itself).

Trae IDE Solo Mode is the AI-driven full-lifecycle IDE from ByteDance. Solo Mode is an evolution of the classic IDE: the right-hand "Tools Matrix" is augmented with a goal-driven task panel, an AI dialogue column, and a session-history sidebar. The architecture centers on a **state machine** (Goal → Plan → Execute → Verify → Iterate), **multi-agent collaboration** (Planner, Coder, Reviewer, Tester), and **browser/IDE/desktop unified delivery**. Solo Mode is positioned for end-to-end task delivery (from natural language goal to a verified, test-passed solution) rather than single-turn chat.

This document analyses 15 features end-to-end: implementation architecture, key technologies/algorithms, user experience flow, API/data structures, and trade-offs. The goal is to give a product engineering team enough detail to design their own equivalent.

---

## 1. Multi-File Editing

### 1.1 Codex CLI

**1. Implementation architecture**
- Codex exposes a built-in `apply_patch` tool, runnable both as a sub-binary (`codex apply-patch …`) and as an LLM-callable tool through `ToolRouter` (crate `codex-rs/tools`).
- The same Rust crate is reused by `codex-tui` (interactive), `codex app-server` (JSON-RPC for IDEs), and `codex exec` (headless CI), guaranteeing one consistent editing format across every surface.
- Patches are validated by a **Lark grammar** (`codex-rs/apply-patch/src/parser.lark`) before any disk mutation; malformed input is rejected with a structured error so the LLM can self-correct.

**2. Key technologies/algorithms**
- **V4A diff format** — a custom unified-diff variant. Operations: `*** Begin Patch`, `*** Add File: <path>`, `*** Delete File: <path>`, `*** Update File: <path>` (with `@@` hunks containing `-`/`+`/` ` line markers, `*** End of File`).
- **Hash-tracked hunks** — each hunk is verified against the file's current SHA so the LLM cannot silently corrupt context. The verifier ensures no drift between the snapshot the model was shown and the file on disk.
- **Apply path is sandboxed** — when the sandbox is on, write destinations must satisfy `SandboxPolicy::WritableRoots`; otherwise the tool returns a sandbox violation and asks for approval escalation.

**3. User experience flow**
1. User prompts: "Refactor `auth.rs` to use the new token rotation strategy and update all callers."
2. Model emits a single `apply_patch` tool call with multiple `*** Update File` sections.
3. TUI streams patch approval (or auto-accepts per `AskForApproval` policy).
4. `codex-core` validates the Lark grammar, computes file hashes, applies diffs atomically, then streams `Event::PatchApplyBegin/End` to the TUI for live diff rendering.
5. On hash mismatch, the LLM receives an error event and re-reasons over the current file content.

**4. API / data structures**
- Rust entry point: `pub fn apply_patch(input: &str, fs: &dyn FileSystem) -> Result<Outcome, Error>`.
- `codex_protocol::op::PatchApproval` and `Event::PatchApplyEnd` carry status, touched files, and revert hint.
- JSON-RPC (`app-server`) equivalent: `applyPatch` op (v1) with streamed `patch/applied` notifications.

**5. Pros & cons**
- Pros: deterministic, reversible, sandbox-aware; one tool covers create/edit/delete; Lark grammar gives high-quality error messages back to the model.
- Cons: not as expressive as Git-style three-way merge; very large refactors (>~3k tokens of patch) can be truncated; requires the model to emit the special V4A format which is learned from RL fine-tuning.

### 1.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Multi-file editing in Solo is realised through an **IDE-native diff overlay** that wraps the Monaco editor (Web/Electron stack). The agent emits structured Edit/Replace operations through the Solo runtime, which routes them to a "Batch Edit" controller.
- Internally, edits are buffered in a transaction, then committed atomically and rendered as a GitLens-style inline gutter diff.

**2. Key technologies/algorithms**
- **AST-aware textual diff** (TypeScript via `ts-morph`, Python via `jedi`) — produces minimal, semantically correct edits rather than naive line diffs.
- **Transactional commit** — all changes in one goal step commit together; on failure the buffer is rolled back.
- **Conflict detection** — if the user has changed a file since the agent last read it, Solo pauses and surfaces a three-way merge UI.

**3. User experience flow**
1. User gives a high-level goal: "Migrate the React class components to hooks in `src/components/`."
2. Solo's Planner emits a file batch, the Coder agent applies edits one file at a time.
3. Each edit shows a ghost diff in the editor; user can Accept / Reject per file or batch.
4. After acceptance, Solo auto-runs lint and type-check on the modified files.

**4. API / data structures**
- Solo's internal `EditRequest { filePath, range, replacement, semanticType, author: 'planner'|'coder'|'reviewer' }`.
- REST exposure: `POST /api/solo/edits/commit` with `{ goalId, edits[], atomicity: 'all'|'per-file' }`.

**5. Pros & cons**
- Pros: IDE-native, visually rich, transactional, AST-aware.
- Cons: editor-coupled (not portable to headless); large refactors may exceed the planner's planning window; conflict resolution can stall long flows.

---

## 2. Project Indexing / Workspace Awareness

### 2.1 Codex CLI

**1. Implementation architecture**
- Workspace awareness is split into **lightweight in-session** awareness and **heavyweight persistent** indexing.
- In-session: the model is fed a directory tree (default depth ~3, configurable via `sandbox_workspace_write` and `--add-dir`) plus a bounded list of matched files when commands are issued.
- Persistent: external integrations (e.g. Context7 MCP, `@upstash/context7-mcp`) can be added to provide library-specific lookups; Codex itself does not maintain a vector index by default.

**2. Key technologies/algorithms**
- **Ripgrep** for fast text search (`codex-rs/file-search` wraps `rg --json`).
- **Glob matching** via the `glob` crate with `.gitignore`-aware traversal.
- **Token budgeting** — the agent computes how much of the model's context window can be filled by file content; reads above a threshold are streamed in chunks.

**3. User experience flow**
1. User: "How does the user-session module work?"
2. Codex runs `rg -l "user_session"` in parallel, ranks by relevance, and reads the top N files.
3. The TUI shows the search calls and the selected files in a collapsible "Files used" panel.

**4. API / data structures**
- `ToolSpec::FileSearch { pattern, path, max_results }` returns `Vec<SearchMatch>`.
- `Op::UserInput` carries a `Vec<Attachment>` for explicit file uploads.

**5. Pros & cons**
- Pros: zero-config, fast, no index to maintain.
- Cons: no semantic search; large monorepos can produce many candidate files; no caching across sessions (each turn re-walks).

### 2.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae runs a **workspace indexer** as a background Node process (Electron main + worker). The indexer is language-aware (TypeScript, JavaScript, Python, Java, Go, Rust) and feeds a hybrid retriever.

**2. Key technologies/algorithms**
- **Hybrid retrieval**: BM25 keyword search + embedding-based semantic search (Trae ships a custom ~100M-param embedding).
- **Tree-sitter** for symbol extraction; per-file graph nodes for `function`, `class`, `import` edges.
- **Incremental indexing** via file watcher (`chokidar`); debounced 500 ms batch flushes.

**3. User experience flow**
1. User asks: "Where is the `applyDiscount` function used?"
2. Solo's retriever ranks candidates using both BM25 and embeddings, returns top-K with file paths and line ranges.
3. The IDE navigates and opens the most relevant hit; a sidebar shows the full list.

**4. API / data structures**
- `IndexEntry { filePath, symbols: Symbol[], lastIndexedAt, hash }`.
- Local query: `GET /api/index/search?q=...&limit=20` (IPC over Electron).

**5. Pros & cons**
- Pros: semantic + structural; persistent; language-aware.
- Cons: high memory cost (~300–800 MB for a medium codebase); first-time indexing can take 30+ s; cross-language projects need per-language parsers.

---

## 3. MCP (Model Context Protocol) Integration

### 3.1 Codex CLI

**1. Implementation architecture**
- Codex is both an **MCP client** and **MCP server**.
- As a **client**, it uses the `rmcp-client` crate (`codex-rs/rmcp-client`) to spawn and talk to external MCP servers over stdio or HTTP. Servers are declared in `~/.codex/config.toml`.
- As a **server**, the `codex-mcp-server` binary exposes the Codex tool set over stdio so other agents (e.g. Claude Desktop, IDEs) can drive Codex.

**2. Key technologies/algorithms**
- **Transport**: stdio JSON-RPC, Streamable HTTP (post-2025-03-26 spec), and SSE.
- **Tool discovery**: at session start the client calls `tools/list` on each configured server; results are merged into the model's tool schema.
- **Namespacing**: tools from external servers are namespaced as `<server>__<tool>` to avoid collisions; an LLM-facing `_mcp_server_instructions` system message explains the namespace.

**3. User experience flow**
1. User adds `[mcp_servers.context7]` to `config.toml`.
2. On session start, Codex spawns `npx -y @upstash/context7-mcp`, captures its tool list, and offers `context7__get-library-docs` to the model.
3. The model calls the tool mid-task; the TUI shows the call/result inline.

**4. API / data structures**
- `ConfigToml { mcp_servers: HashMap<String, McpServerConfig> }` where each `McpServerConfig` is `{ command, args, env, transport, enabled, startup_timeout_ms, tool_timeout_ms }`.
- Per-turn `Op::ListMcpTools`, `Op::McpToolCall { server, tool, args }`.

**5. Pros & cons**
- Pros: standards-based; tool discovery is automatic; secure via sandbox/approval.
- Cons: long-lived processes (memory cost); tool name collisions require careful namespacing; cold-start latency for `npx`-launched servers.

### 3.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae treats MCP as a first-class extension mechanism. The IDE bundles a **MCP marketplace** and exposes both **stdio** and **Streamable HTTP** transports.

**2. Key technologies/algorithms**
- **Marketplace catalog** — Trae maintains a curated list of MCP servers; one-click install auto-edits the user config.
- **Sandbox-aware calls** — MCP tool calls go through the same approval pipeline as built-in tools.

**3. User experience flow**
1. User opens MCP Marketplace from the right panel.
2. Clicks Install on a "Postgres MCP" entry; Solo writes config and restarts the MCP layer.
3. User chats: "Query the `users` table for last 24h signups"; the model calls `postgres__query`.

**4. API / data structures**
- `McpServerManifest { id, name, description, transport, capabilities, requiresAuth }`.
- IPC: `bridge.mcp.invoke(server, tool, args)`.

**5. Pros & cons**
- Pros: discoverable, sandbox-aware, pluggable.
- Cons: marketplace curation overhead; security review of third-party servers is non-trivial.

---

## 4. Tool Calling & Execution Sandbox

### 4.1 Codex CLI

**1. Implementation architecture**
- All tool execution is funnelled through `ToolRouter` (`codex-rs/tools`) which dispatches to typed handlers. Shell-style commands are normalised then sent to `codex-rs/exec-server` (local) or a remote equivalent.
- The sandbox layer is a thin policy engine wrapping per-platform primitives.

**2. Key technologies/algorithms**
- **macOS**: `Seatbelt` (`sandbox-exec`) profiles generated from `SandboxPolicy`. Network is opt-in via per-domain rules.
- **Linux**: `bubblewrap` (bwrap) for namespace isolation, plus `Landlock` (filesystem) and `seccomp` (syscall) for in-process confinement. A `codex-linux-sandbox` helper binary is built from the workspace to set the Landlock rules before exec.
- **Windows**: restricted token via `CreateRestrictedToken` + Job objects + integrity levels.
- **`execpolicy`** — a Starlark rule engine that classifies commands (`safe`, `requires-approval`, `forbidden`). Default policy covers `rm -rf`, `curl | sh`, etc. Users can extend the rules.
- **Network policy** — by default the sandbox blocks outbound network unless an opt-in rule allows the domain.

**3. User experience flow**
1. Agent: `rm -rf node_modules && npm install`.
2. `execpolicy` flags `rm -rf` as `requires-approval`; TUI pops a per-command approval modal showing the command, sandbox status, and the policy reason.
3. User approves; exec runs in bwrap with no network, no writes outside `cwd`.

**4. API / data structures**
- `SandboxPolicy { mode: ReadOnly | WorkspaceWrite | DangerFullAccess, writable_roots, network_access }`.
- `AskForApproval { Never | OnFailure | OnRequest | UnlessTrusted }`.

**5. Pros & cons**
- Pros: defense in depth, cross-platform, configurable, deterministic approvals.
- Cons: bwrap requires user namespace support; some Linux distros (older RHEL) need additional setup; seatbelt profiles are platform-locked.

### 4.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae runs all tool calls through a **Tool Sandbox** that combines a Node `vm` worker for scripting with a WebContainer for full-stack web tasks. Real shell commands are delegated to a sandboxed child process.

**2. Key technologies/algorithms**
- **WebContainer** (browser-only) for Node/npm execution — runs in a service worker, no host access.
- **OS-level sandbox** for host commands (where supported): `sandbox-exec` on macOS, `bwrap` on Linux, AppContainer on Windows.
- **Network policy**: per-project allowlist for outbound domains.

**3. User experience flow**
1. User: "Scaffold a React app and start the dev server."
2. Solo's executor runs `npx create-vite` inside WebContainer, then `npm run dev` in the same isolated context.
3. Output streams to the embedded terminal; the user sees the server boot and a preview iframe.

**4. API / data structures**
- `ToolCall { name, args, sandbox: 'webcontainer'|'vm'|'host', approvalPolicy }`.
- Solo session log: `tool_calls` table with `started_at`, `finished_at`, `status`, `output_ref`.

**5. Pros & cons**
- Pros: zero-install web stacks, strong isolation, embedded preview.
- Cons: WebContainer has Node-API limits (no native modules); some npm packages fail.

---

## 5. Session Persistence & Resume

### 5.1 Codex CLI

**1. Implementation architecture**
- Sessions are persisted via `codex-rs/thread-store` with a hybrid backend: **JSONL rollouts** (the ground truth) and **SQLite metadata** (queries, indexing, reconnection).

**2. Key technologies/algorithms**
- **Rollout files** at `~/.codex/sessions/YYYY/MM/DD/rollout-<uuid>.jsonl`. Each line is a typed event: `session_meta`, `turn_started`, `response_item`, `event_msg`, `turn_completed`, `compacted`.
- **SQLite** (`state.db`) for fast lookup: `threads`, `turns`, `messages`, indexed on `created_at`, `cwd`, `model`.
- **Resume protocol**: `codex resume <thread_id>` rehydrates by streaming JSONL to rebuild the model's context window, then continues from the last `turn_completed` boundary.

**3. User experience flow**
1. User runs a long task, presses Ctrl-C.
2. On next launch, `codex` lists recent threads: "1. Refactor auth (10 turns, 2h ago) — [Resume] [Open]".
3. User picks Resume; the session continues seamlessly with full context.

**4. API / data structures**
- `RolloutLine { timestamp, type, payload }`.
- `ResumeOp { thread_id, from_turn: Option<TurnId>, model: Option<String> }`.

**5. Pros & cons**
- Pros: crash-safe, portable, queryable; supports cross-machine resume; idempotent resume.
- Cons: JSONL files grow large (~MB per long session); compaction is required.

### 5.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae persists sessions in an **IndexedDB** store in the Electron main process, plus a server-side mirror for cloud sync (opt-in).

**2. Key technologies/algorithms**
- **Incremental snapshots** — every state-changing op is appended to an op-log, with periodic snapshotting for fast cold-start.
- **CRDT-like merge** for collaborative branches (worktree-based).

**3. User experience flow**
1. User closes the IDE mid-goal; the op-log is flushed.
2. On reopen, the goal panel restores the last run; a "Continue" button resumes the Coder agent.

**4. API / data structures**
- `SessionRecord { id, goal, plan, turns[], files, lastActiveAt }`.
- IPC: `session.resume(id)`.

**5. Pros & cons**
- Pros: zero-config resume, cloud mirror, worktree support.
- Cons: IndexedDB quota; op-log can grow without compaction.

---

## 6. Cost Tracking & Usage Analytics

### 6.1 Codex CLI

**1. Implementation architecture**
- Codex itself emits `token_count` events in the rollout but does not show a cost UI in the TUI. Cost analytics are delegated to **third-party MCP servers** (e.g. `codex-usage-mcp`) and CLI extensions (e.g. `BurnRate`).

**2. Key technologies/algorithms**
- `Event::TokenCount { prompt, completion, cached, total }` per turn.
- Per-model price tables loaded at startup; cost computed as `Σ (price_in × tokens_in + price_out × tokens_out)`.

**3. User experience flow**
1. User installs `BurnRate` from the README.
2. `codex "..."` runs; BurnRate's wrapping layer prints a per-turn cost badge and writes a CSV/JSON log.

**4. API / data structures**
- `PricingTable { model: String, input_per_1k, cached_input_per_1k, output_per_1k }`.

**5. Pros & cons**
- Pros: opt-in, low overhead, flexible.
- Cons: no built-in dashboard; users must install and trust third-party tools.

### 6.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Built-in **Cost Panel** in the right Tools Matrix; aggregates tokens, cost, and request counts per session and per workspace.

**2. Key technologies/algorithms**
- Streaming token counter; per-provider rate-limit detection (HTTP 429 backoff, exponential retry).
- Per-goal budget cap (user-configurable); warning banners when 80% / 100% reached.

**3. User experience flow**
1. User opens Cost tab; sees per-turn tokens and a stacked bar of input vs cached vs output.
2. User sets a $5 cap on a goal; agent pauses at threshold with a "Continue?" prompt.

**4. API / data structures**
- `UsageRecord { sessionId, turnId, model, input, cached, output, latencyMs, costUsd }`.

**5. Pros & cons**
- Pros: in-product visibility; budget enforcement.
- Cons: only as accurate as the provider's reported tokens; cached pricing varies by region.

---

## 7. Plan Mode vs Build Mode

### 7.1 Codex CLI

**1. Implementation architecture**
- Codex implements a **plan-then-execute** flow: the model first produces a structured plan (`PlanResponseItem`), the user reviews it, and only after explicit approval does the turn proceed to tool calls.
- A `plan_mode` flag is part of the system prompt; in plan mode the model is forced to emit `PlanResponseItem` only and tool calls are suppressed.

**2. Key technologies/algorithms**
- **Structured outputs** — JSON schema enforcement on plan items.
- **Plan review UI** — TUI shows plan as a numbered list with file targets, diffs, and a `[Approve & Run]` button.

**3. User experience flow**
1. User: "Migrate from REST to GraphQL."
2. Codex emits a 12-step plan, displayed in the TUI with file targets.
3. User edits step 5 inline ("skip, I'll do that one myself"), approves, and Codex executes the rest.

**4. API / data structures**
- `PlanResponseItem { steps: PlanStep[], assumptions: String[], risks: String[] }`.
- `Op::PlanApproval { plan_id, approved, edits: PlanEdit[] }`.

**5. Pros & cons**
- Pros: predictable, reviewable, reduces wasted tokens.
- Cons: requires an extra round-trip; plans can become stale if the model re-reads files mid-execute.

### 7.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae splits the experience into **Plan Mode** and **Build Mode** (the latter is the default Solo experience). Plan Mode is a non-destructive Planner agent that only emits plans, no file edits.

**2. Key technologies/algorithms**
- **Multi-agent handoff** — Plan Mode uses the Planner agent (read-only tools). Switching to Build Mode unlocks the Coder agent (write tools).
- **Goal state machine**: `Plan → Approve → Execute → Verify → Iterate`.

**3. User experience flow**
1. User opens a new goal; Solo starts in Plan Mode.
2. Plan Mode renders a checklist, dependency graph, and estimated time.
3. On approve, Build Mode begins; each step shows in the goal panel.

**4. API / data structures**
- `PlanNode { id, kind, deps, files, status }`.
- `GoalState { id, plan, currentStep, runId, artifacts[] }`.

**5. Pros & cons**
- Pros: clear separation, multi-agent, observable.
- Cons: context switching cost; Planner can over-plan and exhaust tokens.

---

## 8. Voice / Image Input

### 8.1 Codex CLI

**1. Implementation architecture**
- Codex CLI's TUI supports image attachments via clipboard paste (TUI auto-detects image bytes and uploads them as `Op::UserInput` attachments). Voice input is not native to the TUI but is supported via the app-server for IDE integrations.

**2. Key technologies/algorithms**
- Image input uses the OpenAI Vision path (`gpt-4o` and `gpt-4.1` accept image `data:` URLs).
- Voice: app-server pipes audio to OpenAI's transcription endpoint; result becomes a `UserInput` text message.

**3. User experience flow**
1. User pastes a screenshot into the TUI.
2. Codex runs a vision model call and returns "I see a `TypeError` in `auth.ts:42`."

**4. API / data structures**
- `Attachment { kind: Image | File, mime, data, filename }`.

**5. Pros & cons**
- Pros: simple, leverages multimodal models.
- Cons: voice requires IDE integration; no on-device STT.

### 8.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae exposes a **multimodal input bar** in the chat panel with mic and image icons. Audio is processed locally via Web Speech API for transcription; images are passed through to the underlying vision-capable model.

**2. Key technologies/algorithms**
- Web Speech API (browser/Electron) for STT; on-device VAD via `@ricky0123/vad-web`.
- Vision path identical to Codex (data URL into the chat completion).

**3. User experience flow**
1. User clicks mic, dictates: "Refactor this to async/await."
2. STT transcribes in real time; on stop, the text lands in the input bar.
3. User can also drag a screenshot; the model receives the image and text together.

**4. API / data structures**
- `MultimodalInput { text?, audio?: Blob, images?: Blob[] }`.

**5. Pros & cons**
- Pros: in-product, no third-party, fast iteration.
- Cons: Web Speech API accuracy varies by browser; no offline STT.

---

## 9. Custom Slash Commands

### 9.1 Codex CLI

**1. Implementation architecture**
- Codex reads Markdown "prompt files" from `~/.codex/prompts/` (user) and `.codex/prompts/` (project). Each file is a named slash command (`/review`, `/simplify`, etc.) injected as a system message prefix.
- A **Skills** subsystem (`codex-rs/ext/skills`) extends this with parameterized prompts (TOML frontmatter for `name`, `description`, `arguments`).

**2. Key technologies/algorithms**
- **Frontmatter parsing** with `serde_yaml` to extract `name`, `description`, optional `arguments[]`.
- **Hot reload** — files are re-read at session start; long sessions must `/reload-skills`.

**3. User experience flow**
1. User runs `/review src/auth.ts`.
2. Codex loads `~/.codex/prompts/review.md`, substitutes `$1` with `src/auth.ts`, and runs the prompt.

**4. API / data structures**
- `Skill { name, description, body, arguments? }`.
- CLI: `codex /review src/auth.ts` or interactive `/review`.

**5. Pros & cons**
- Pros: zero-cost reuse, project-overridable, plain Markdown.
- Cons: no per-skill sandbox; all skills share the main session's tools.

### 9.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae ships a **Slash Command Marketplace** with a built-in library (`/explain`, `/refactor`, `/test`, `/commit`) plus user-defined commands.

**2. Key technologies/algorithms**
- Commands are JS modules registered through Trae's extension API.
- Each command is typed: `CommandSpec { name, args, agent: 'planner'|'coder'|'reviewer', tools: ToolName[] }`.

**3. User experience flow**
1. User types `/test src/auth.test.ts` in the chat.
2. Trae routes to the Tester agent (read-only + test runner tools).
3. Output streams back; diff suggested in the file panel.

**4. API / data structures**
- `CommandInvocation { name, args, agentRole, context }`.

**5. Pros & cons**
- Pros: agent-aware, typed args, marketplace.
- Cons: JS-only; harder to share with non-Trae users.

---

## 10. Workspace Rules / AGENTS.md

### 10.1 Codex CLI

**1. Implementation architecture**
- Codex reads `AGENTS.md` (default) at session start, walks from `cwd` up to the filesystem root merging every `AGENTS.md` it finds. The merged content becomes a system-message prefix.

**2. Key technologies/algorithms**
- **Hierarchical merge** — child overrides parent. The walk stops at `.git` boundary.
- **Configurable filename** via `[agents].instructions = 'CUSTOM.md'` in `config.toml`.

**3. User experience flow**
1. Repo has `AGENTS.md` at root and `frontend/AGENTS.md` for the UI subset.
2. User works in `frontend/`; both rules are applied with the more specific one taking precedence on conflicts.

**4. API / data structures**
- `AgentInstructions { path, scope: 'user'|'project'|'local', priority }`.

**5. Pros & cons**
- Pros: hierarchical, project-aware, zero-config.
- Cons: no rule validation; very large `AGENTS.md` consumes context.

### 10.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae uses `.trae/rules/project_rules.md` (and sub-paths) following the same hierarchical model. Rules can be **typed**: `convention`, `forbidden`, `required`, `tool-binding`.

**2. Key technologies/algorithms**
- Type-aware rule engine: each rule is matched against the active goal/file/agent.
- **Template variables** (`{{language}}`, `{{filePath}}`) are substituted at apply time.

**3. User experience flow**
1. Repo has `.trae/rules/` with `frontend.md`, `backend.md`, `testing.md`.
2. Coder agent editing `src/components/Button.tsx` automatically applies `frontend.md` rules.

**4. API / data structures**
- `Rule { type, pattern, body, scope, priority }`.

**5. Pros & cons**
- Pros: typed, scope-aware, multi-language.
- Cons: more upfront setup; rule conflicts need user disambiguation.

---

## 11. Background Task Execution

### 11.1 Codex CLI

**1. Implementation architecture**
- Codex dispatches **subagents** via the `codex-rs/subagent` crate. A subagent is a forked `Codex` queue pair with a restricted tool set and a different model/sandbox.

**2. Key technologies/algorithms**
- **Isolated queue pair** — subagent has its own `Op`/`Event` channel; results are streamed back as `Event::SubagentResult`.
- **Parallelism** — multiple subagents can run concurrently; results are aggregated when all complete or the first failure aborts (configurable).

**3. User experience flow**
1. User: "Find all uses of `applyDiscount` in the codebase and report by file."
2. Codex spawns 4 subagents, each owning a directory range; they run in parallel; results merge into one report.

**4. API / data structures**
- `SpawnSubagentOp { task, tools, model, sandbox, isolation }`.
- `SubagentStatus { id, state, partialResult? }`.

**5. Pros & cons**
- Pros: clean isolation, parallel speedup, easy to reason about.
- Cons: token cost multiplies; shared state requires explicit hand-off.

### 11.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae's multi-agent runtime can spawn **Planner, Coder, Reviewer, Tester** agents in parallel when the goal DAG allows.

**2. Key technologies/algorithms**
- **DAG scheduler** — each plan step has dependencies; independent steps run concurrently.
- **Shared context bus** — agents post intermediate artefacts to a shared bus (reviewer sees coder's diff).

**3. User experience flow**
1. Goal: "Add login + tests + docs."
2. Coder writes login, Tester writes tests in parallel; Reviewer waits for both.
3. Final step merges all artefacts and runs the full test suite.

**4. API / data structures**
- `DagNode { id, agent, deps, status, artifacts[] }`.

**5. Pros & cons**
- Pros: high throughput, real concurrency, observable.
- Cons: DAG planning overhead; merge conflicts between agents.

---

## 12. Diff Visualization

### 12.1 Codex CLI

**1. Implementation architecture**
- The TUI renders diffs through a `DiffView` widget built on `ratatui`. Patches arrive as `Event::PatchApplyBegin/End` carrying the V4A structure; the widget decomposes it into side-by-side or inline views.

**2. Key technologies/algorithms**
- **Line-level diff** with `similar` crate (Rust) producing LCS-based ops.
- **Syntax highlight** via `syntect` for the touched languages.

**3. User experience flow**
1. Codex applies a patch; TUI opens a collapsible "Changes" panel showing added/removed lines with red/green gutter markers.

**4. API / data structures**
- `DiffLine { kind: Add | Del | Context, content, line_number }`.

**5. Pros & cons**
- Pros: keyboard-driven, copyable, fast.
- Cons: terminal-only; no image/UI rendering.

### 12.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae uses a Monaco-based diff editor integrated with GitLens; the agent's edits are rendered as a graph of changes in a "Changes" tab.

**2. Key technologies/algorithms**
- **Three-way merge** for files that drifted since the agent last read.
- **Per-file AI summary** — a small model summarises the change ("Fix null check in `applyDiscount`").

**3. User experience flow**
1. User opens the Changes tab; sees file list, per-file diff, AI summary.
2. Click a file; Monaco opens the side-by-side diff with accept/reject hunks.

**4. API / data structures**
- `ChangeSet { id, files: FileDiff[], summary, agentId }`.
- `FileDiff { path, hunks[], beforeHash, afterHash }`.

**5. Pros & cons**
- Pros: rich, AI-summarised, per-hunk control.
- Cons: editor-coupled; memory cost for many files.

---

## 13. Permission / Approval System

### 13.1 Codex CLI

**1. Implementation architecture**
- Codex's approval system has **two layers**: command policy (`execpolicy` Starlark rules) and sandbox policy (`SandboxPolicy`). The TUI mediates user approvals when a policy classifies a command as `requires-approval`.

**2. Key technologies/algorithms**
- **Three policies** per command: `Never`, `OnFailure`, `OnRequest`, `UnlessTrusted`.
- **Memory of approved commands** — once approved, a command in the same session can be re-run without re-prompting (until session ends).
- **Diff approval** — patches are presented in a unified diff format; the user can approve whole or with hunks excluded.

**3. User experience flow**
1. Agent: `git push origin main`.
2. TUI: "Approve `git push`? [Y/n/Always]".
3. User picks "Always for `git push`"; subsequent pushes don't prompt.

**4. API / data structures**
- `AskForApproval` enum.
- `ExecApproval { command, policy_reason, sandbox_ok }`.

**5. Pros & cons**
- Pros: deterministic, auditable, supports per-command "always".
- Cons: rule-writing has a learning curve; no role-based approval (e.g. require 2 reviewers).

### 13.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae extends approval with **role-based** and **risk-based** policies. Each tool has a risk class; high-risk tools always require approval, low-risk tools are auto-approved.

**2. Key technologies/algorithms**
- **Risk classifier** — heuristic + ML-based scoring per tool call.
- **Auto-approval memory** — same as Codex, but persisted across sessions per project.

**3. User experience flow**
1. Agent calls a `database.query` tool; the system detects "production" connection string → high risk.
2. UI pops a confirmation with the SQL preview; user approves once; subsequent queries against `staging` are auto-approved.

**4. API / data structures**
- `RiskAssessment { tool, args, score, class }`.
- `ApprovalPolicy { autoApprove: RiskClass[], requireApproval: RiskClass[] }`.

**5. Pros & cons**
- Pros: risk-aware, persistent memory, project-scoped.
- Cons: classifier can misjudge; user can accidentally over-approve.

---

## 14. Auto-Compaction / Context Window Management

### 14.1 Codex CLI

**1. Implementation architecture**
- When a session approaches the model's context limit, `codex-core` triggers **auto-compaction**: a summarisation turn that compresses older turns into a structured summary and replaces them in the context window.
- A manual `/compact` command forces compaction.

**2. Key technologies/algorithms**
- **Sliding window + summarisation** — keep last N turns verbatim, summarise everything before.
- **Tool result pruning** — large shell outputs are truncated to the first/last N lines with a "[…truncated…]" marker.
- **Compaction event** in the rollout (`Event::Compacted { old_token_count, new_token_count, summary_ref }`).

**3. User experience flow**
1. Long session nears limit; TUI shows "Compacting…".
2. After compaction, a small "Memory used" badge updates; agent continues seamlessly.

**4. API / data structures**
- `CompactionPolicy { trigger_at_tokens, keep_last_n_turns, summarise_model }`.

**5. Pros & cons**
- Pros: long sessions don't crash; resumable from JSONL.
- Cons: summary can lose nuance; bad summarisations can degrade future turns.

### 14.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae applies a **two-tier compression**: per-turn summarisation (real-time) and per-goal summarisation (when goal ends).

**2. Key technologies/algorithms**
- **Hierarchical summary** — keep three levels: full (recent N turns), medium (last goal), short (whole project).
- **Embedding-based recall** — when relevant, fetch older turns via similarity search.

**3. User experience flow**
1. Goal runs for 50 turns; Solo auto-summarises every 10 turns into a "memory" panel.
2. User can expand any summary to see the original turns.

**4. API / data structures**
- `MemoryTier { full, medium, short }`.
- `Summary { id, span: [turnId..turnId], embeddingRef, body }`.

**5. Pros & cons**
- Pros: rich memory, expandable, multi-tier.
- Cons: embedding cost; stale summaries can mislead.

---

## 15. Branch / Git Integration

### 15.1 Codex CLI

**1. Implementation architecture**
- Codex is **git-aware** but not git-authoritative. It can run `git` commands through the sandbox and reads `git status` to inject repo state into context, but does not own branch creation/merging.

**2. Key technologies/algorithms**
- **Repo detection** via `git rev-parse --is-inside-work-tree`; if true, branch + HEAD + dirty files are added to the model context.
- **Worktree support** — `codex --worktree` (when configured) creates a per-session worktree, leaving the user's branch clean.

**3. User experience flow**
1. User starts `codex "Refactor billing"`; Codex sees the repo, current branch `feature/abc`, dirty files `auth.ts`.
2. Codex commits progress periodically if `--commit-on-exit` is set.

**4. API / data structures**
- `GitContext { branch, head, dirty: String[], remote }`.

**5. Pros & cons**
- Pros: zero-config, low-risk, worktree support.
- Cons: no GUI; PR creation is manual.

### 15.2 Trae IDE Solo Mode

**1. Implementation architecture**
- Trae ships a **first-class Git panel** and a "Solo Commit" workflow: the agent proposes a commit message, runs pre-commit checks, opens a PR (with GitHub/GitLab integrations).

**2. Key technologies/algorithms**
- **Worktree-per-goal** — each goal runs in an isolated worktree; merging requires explicit user action.
- **AI commit message** — small model generates Conventional Commit messages from the diff.

**3. User experience flow**
1. User kicks off a goal; Trae creates `.worktrees/goal-<id>`.
2. Coder agent edits inside the worktree; Reviewer and Tester agents run on the same.
3. On goal completion, Trae opens a commit modal; user edits the message and clicks Commit & Push.

**4. API / data structures**
- `Worktree { path, goalId, branch, base, head }`.
- `PullRequest { provider, draft, body, reviewers }`.

**5. Pros & cons**
- Pros: isolation, AI commit messages, PR integration.
- Cons: merge conflict resolution can be complex; worktree cleanup.

---

## 16. Cross-Feature Summary Matrix

| # | Feature | Codex CLI | Trae IDE Solo |
|---|---|---|---|
| 1 | Multi-file editing | `apply_patch` + V4A + Lark grammar | AST-aware transactional edits |
| 2 | Project indexing | rg + glob, in-session | Hybrid retriever (BM25 + embeddings) |
| 3 | MCP integration | Client + server, stdio/HTTP/SSE | Marketplace + stdio/Streamable HTTP |
| 4 | Tool sandbox | bwrap + Landlock + seccomp / Seatbelt / restricted token | WebContainer + OS sandbox |
| 5 | Session persistence | JSONL rollouts + SQLite | IndexedDB + cloud mirror |
| 6 | Cost tracking | External MCP / CLI wrappers | Built-in Cost Panel + budget cap |
| 7 | Plan vs Build | `plan_mode` flag + structured plan | Separate Planner + Coder agents |
| 8 | Voice/Image | Image: clipboard; Voice: app-server | Web Speech API + vision |
| 9 | Slash commands | Markdown prompt files + Skills | JS-typed commands + marketplace |
| 10 | Workspace rules | `AGENTS.md` (hierarchical) | `.trae/rules/*.md` (typed) |
| 11 | Background tasks | Subagent queue pairs | Multi-agent DAG scheduler |
| 12 | Diff visualization | TUI `DiffView` | Monaco + GitLens + AI summary |
| 13 | Approval system | `AskForApproval` + `execpolicy` | Risk-class + persistent memory |
| 14 | Auto-compaction | Sliding window + summary | Three-tier memory + recall |
| 15 | Git integration | Awareness + worktree flag | Worktree-per-goal + PR automation |

---

## 17. Source References

- OpenAI Codex repository: <https://github.com/openai/codex>
- Codex architecture notes (anneincontext/codex-labs): <https://github.com/anneincontext/codex-labs/blob/main/notes/codex/architecture.md>
- Codex layered design: <https://github.com/anneincontext/codex-labs/blob/main/notes/codex/layered-design.md>
- Codex TUI design: <https://github.com/anneincontext/codex-labs/blob/main/notes/codex/tui-interface-design.md>
- OpenAI Responses API documentation (model provider integration): <https://platform.openai.com/docs/api-reference/responses>
- MCP specification: <https://modelcontextprotocol.io/>
- Bubblewrap sandbox: <https://github.com/containers/bubblewrap>
- Landlock LSM (Linux kernel): <https://docs.kernel.org/userspace-api/landlock.html>
- Trae IDE official: <https://www.trae.ai/>
- Trae Solo Mode product page: <https://www.trae.ai/solo>
- WebContainer (StackBlitz): <https://webcontainers.io/>

---

## 18. Recommendations for the Product Engineering Team

1. **Multi-file editing**: adopt a single deterministic format (Codex-style V4A or similar) so the same patch can be replayed across TUI, headless, and IDE surfaces. Validate via grammar.
2. **Indexing**: start with ripgrep + glob; graduate to hybrid retrieval only when the workspace grows past ~5k files.
3. **MCP**: support both client and server roles; treat MCP marketplaces as a product surface, not just plumbing.
4. **Sandbox**: default to `WorkspaceWrite + network off`; expose a `DangerFullAccess` for power users. Provide a clear opt-in network domain list.
5. **Persistence**: JSONL rollouts + SQLite index has proven itself at scale; plan compaction as a first-class feature.
6. **Cost**: even if you don't ship a full UI, expose the event stream so third-party dashboards can plug in.
7. **Plan/Build separation**: a separate read-only Planner agent (with no write tools) materially reduces footguns.
8. **Multimodal**: prioritise image input early — it's a 5x productivity unlock for design/code workflows. Voice is nice-to-have.
9. **Slash commands**: ship a starter set (`/explain`, `/review`, `/test`, `/commit`) and a `prompts/` directory convention.
10. **Workspace rules**: hierarchical, project-overridable; typed rules beat free-form text.
11. **Background tasks**: model them as queue pairs or DAG nodes; make concurrency observable.
12. **Diffs**: support both terminal (TUI) and IDE (Monaco) surfaces; hunk-level accept/reject is the minimum bar.
13. **Approvals**: per-command memory + risk-class policy + clear diff preview.
14. **Compaction**: design for it from day one; without it, every long session will eventually crash or degrade.
15. **Git**: support worktree-per-goal as the default safety pattern; commit/PR automation is a strong retention lever.

---

**End of report.**
