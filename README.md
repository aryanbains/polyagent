# Polyagent

> JavaScript-native multi-agent orchestration CLI for your terminal.
> Plan, debate, and run a swarm of agents locally.

[![npm version](https://img.shields.io/npm/v/@aryanbains/polyagent.svg)](https://www.npmjs.com/package/@aryanbains/polyagent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-%E2%89%A518-blue.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org)

Polyagent is an interactive, terminal-first multi-agent orchestration framework. It brings the multi-agent patterns pioneered in Python frameworks (CrewAI, AutoGen, LangGraph) to the Node.js and TypeScript ecosystem as an installable CLI that feels native to developer terminals.

The framework is built around a single workflow that no other CLI does in one place:

**Plan** an execution graph from a high-level task.
**Debate** the plan with a virtual advocate / skeptic / judge panel that proposes modifications.
**Edit** the plan interactively in the TUI before approving it.
**Execute** the plan with retries, timeouts, cancellation, and full session recording.

---

## Table of contents

- [Why Polyagent](#why-polyagent)
- [Install](#install)
- [Quickstart](#quickstart)
- [Commands](#commands)
- [Interactive TUI](#interactive-tui)
- [Multi-agent orchestration](#multi-agent-orchestration)
  - [Plans and strategies](#plans-and-strategies)
  - [Plan debate](#plan-debate)
  - [Plan graph editor](#plan-graph-editor)
  - [Execution resilience](#execution-resilience)
- [Tools](#tools)
- [LLM providers](#llm-providers)
- [Memory](#memory)
- [Configuration](#configuration)
  - [Environment variables](#environment-variables)
- [Examples](#examples)
- [Development](#development)
- [Project status](#project-status)
- [License](#license)

---

## Why Polyagent

- **Plan, debate, edit, then execute.** The only CLI where plans are reviewed by an advocate / skeptic / judge panel before any agent runs, and where you can edit the plan graph visually before approving it.
- **Native TypeScript.** No Python subprocess, no JSON-over-stdio. Everything is real async/await in a single ESM binary.
- **Real TUI.** Three-pane layout, mouse support, `@`-mention for agents, file path autocomplete, and up/down history recall.
- **Nine built-in tools.** File I/O, command execution, web search (Tavily + DuckDuckGo), URL fetch, and inter-agent messaging.
- **Secure by default.** AES-256-GCM encryption for API keys keyed to your machine identity, sandboxed file paths, opt-in tool approvals.
- **Replayable sessions.** Every multi-agent run is recorded with the full plan, debate transcript, agent messages, and execution events, and can be replayed from the CLI.

---

## Install

```bash
npm install -g @aryanbains/polyagent
polyagent --version
```

Requires Node.js 18 or newer. Linux, macOS, and Windows are all supported.

---

## Quickstart

Run the onboarding wizard to configure your provider and create a starter `agents.yaml`:

```bash
polyagent init
```

Then launch the terminal app:

```bash
polyagent
```

Type a request at the bottom prompt and press Enter:

```text
> read package.json and summarize this project
> list all TypeScript files in src
> create hello.txt with Hello World
> create a report at ./reports/summary.md
```

In multi-agent mode (`/multi`), the orchestrator first shows you a plan graph you can approve, edit, or reject. Plans can also be debated by a virtual advocate / skeptic / judge panel that proposes modifications before execution.

---

## Commands

| Command | Description |
|---|---|
| `polyagent` | Launch the interactive TUI dashboard. |
| `polyagent init` | Onboarding wizard (provider, API key, memory backend). |
| `polyagent init --yes ...` | Scripted init for CI and demos. |
| `polyagent status` | Print current local configuration summary. |
| `polyagent validate` | Validate `agents.yaml`, `agents.yml`, or `agents.json`. |
| `polyagent chat <agent>` | Chat with a single agent (script-friendly). |
| `polyagent run "<task>"` | Run a single-agent task. |
| `polyagent run --multi "<task>"` | Plan, debate, and run a multi-agent task. |
| `polyagent replay <session-id>` | Replay a recorded session. |
| `polyagent memory` | Show memory backend and embedding count. |
| `polyagent memory --clear` | Clear all agent memory. |
| `polyagent --version` | Print installed version. |

---

## Interactive TUI

The dashboard has three panes:

- **Agents** (left) — click to select, click `[+] New agent` to create one. Status icons show `*` succeeded, `!` failed, `x` cancelled, or a spinner while running.
- **Conversation** (middle) — streaming agent output, tool activity that collapses into a `Steps taken (N)` summary, and a color-coded transcript (user, assistant, tool, debate, system, error, preview).
- **Inspector** (right) — project path, selected agent, runtime state, and memory panel.

### Slash actions

Press `/` to open the searchable actions menu. The list filters as you type, so `/set` finds Settings, `/agent` finds the agent builder, and `/multi` switches to multi-agent mode.

| Action | What it does |
|---|---|
| `/multi` | Switch to multi-agent mode. |
| `/single` | Switch to single-agent mode. |
| `/create` | Open the in-terminal agent builder. |
| `/settings` | Change run mode, approvals, planner, and web search. |
| `/memory` | Toggle the memory panel. |
| `/validate` | Reload and validate `agents.yaml` without leaving the app. |
| `/clear` | Clear the conversation. |
| `/cancel` | Stop the active run. |
| `/help` | Show keyboard controls. |
| `/exit` | Quit. |

### Keyboard and mouse

- Mouse wheel over the conversation panel scrolls the transcript.
- Click an agent to select it.
- Click `[+] New agent` to open the builder.
- `Up` / `Down` on an empty prompt switches the selected agent.
- `Up` / `Down` with text in the prompt recalls history.
- `Tab` accepts the top completion (`@`-mention or `./` file path).
- `PageUp` / `PageDown` scrolls the transcript.
- `Esc` closes popups or cancels a running task.
- `Ctrl+C` cancels a running task, then exits when idle.

---

## Multi-agent orchestration

### Plans and strategies

Top-level `orchestrator` config in `agents.yaml`:

```yaml
orchestrator:
  strategy: plan_and_execute   # plan_and_execute | sequential | dynamic | react
  max_parallel_agents: 3
  max_iterations: 10
```

| Strategy | Behaviour |
|---|---|
| `plan_and_execute` | Creates research, analysis, and synthesis steps, then schedules dependency-ready work in parallel. |
| `sequential` | Forces a strict dependency chain. |
| `dynamic` | Asks the LLM planner to return a task-specific JSON plan, validates it, and falls back to the static plan if malformed. |
| `react` | Single primary agent runs a Reason + Act loop using its tools and the `message_agent` tool to consult specialists. Best for open-ended tasks. |

### Plan debate

When the plan has more than one step, Polyagent spins up a virtual advocate / skeptic / judge panel that reviews the plan and proposes modifications before any agent runs:

- **Advocate** defends the plan.
- **Skeptic** finds dangerous gaps, wrong agent assignments, or underspecified prompts.
- **Judge** reads the transcript and returns a JSON verdict: `approved: boolean`, `summary: string`, and a list of `modifications`.

Modification types the judge can emit:

- `modify_prompt` — strengthen a step's prompt.
- `reassign_agent` — change which agent owns a step.
- `flag_risk` — prefix the prompt with `[HIGH RISK]`.
- `add_step` — insert a new step.

If the debate fails (network error, malformed JSON), Polyagent falls back to the original plan and continues. The full debate transcript is saved with the session and visible during replay.

### Plan graph editor

Before execution, the TUI shows a wave-grouped plan graph with these controls:

- `y` — approve the plan.
- `e` — enter edit mode. Change prompt, swap agent, edit dependencies, add or delete steps, navigate with arrow keys.
- `n` — request a replan. The planner re-runs with your feedback as additional context.

Edits win over debate modifications: if you edit a step's prompt after a debate, your edit is what gets executed.

### Execution resilience

- **Step retries** with fallback agent reassignment. Default: 1 retry, configurable via `POLYAGENT_AGENT_STEP_RETRIES`.
- **Step timeouts** with abort signal. Default: 180 seconds, configurable via `POLYAGENT_AGENT_STEP_TIMEOUT_MS`.
- **Cancellation** — `Esc` or `Ctrl+C` aborts mid-step. The runner records a `cancelled` status without crashing the session.
- **Approval queue** — multiple tool approvals are serialised so a fast agent does not overwhelm the user with prompts.
- **Session recording** — every run saves the plan, debate outcome, messages, execution events, step records, artifacts, and stats to `.polyagent/sessions/`. API keys and oversized blobs are redacted on disk.

---

## Tools

Agents can call the tools listed in their `tools` array. Built-in tools:

| Tool | Description |
|---|---|
| `read_file(path)` | Read a file with line numbers and binary detection. |
| `write_file(path, content)` | Write a file (with diff preview and approval). |
| `append_to_file(path, content)` | Append to a file (with diff preview and approval). |
| `list_directory(path, recursive?)` | List files in a directory. |
| `search_files(pattern, directory?)` | Glob-search files in the workspace. |
| `execute_command(command, working_dir?, timeout_ms?)` | Run a shell command. Default timeout 10 seconds, approval required. |
| `web_search(query, max_results?)` | Tavily (with `TAVILY_API_KEY`) or DuckDuckGo fallback. |
| `fetch_url(url)` | HTTP fetch with HTML stripping and timeout. |
| `message_agent(to, message, expect_response?)` | Send a message to another agent mid-run. |

File and command tools are workspace-scoped. `write_file`, `append_to_file`, and `execute_command` show a preview and require confirmation unless you pass `--yes`, change Approvals in `/settings`, or set `POLYAGENT_TOOL_APPROVAL=allow`.

---

## LLM providers

Polyagent uses the Vercel AI SDK. Five providers are supported out of the box:

| Provider | Adapter | Default model |
|---|---|---|
| OpenAI | `@ai-sdk/openai` | `gpt-4o-mini` |
| Anthropic | `@ai-sdk/anthropic` | `claude-3-5-haiku-latest` |
| Groq | `@ai-sdk/groq` | `llama-3.1-8b-instant` |
| OpenRouter | `@ai-sdk/openai-compatible` | `deepseek/deepseek-v4-pro` |
| Ollama | `@ai-sdk/openai-compatible` | `llama3.1` |

For OpenRouter, choose `openrouter` during onboarding and use any OpenRouter model ID in `agents.yaml`:

```yaml
agents:
  - name: researcher
    model: deepseek/deepseek-v4-pro
    tools: [read_file, web_search, fetch_url]
```

---

## Memory

Three memory backends:

- `chroma` — uses a local ChromaDB server at `localhost:8000`.
- `skip` — disables memory (default for scripted init and demos).
- `pinecone` — reserved for a future cloud adapter.

For local development without ChromaDB, use the embedded driver:

```bash
POLYAGENT_MEMORY_DRIVER=local polyagent chat researcher --message "Remember Vitest"
```

Embeddings are produced by `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`) by default, with a deterministic 64-dim hash embedder for fast offline tests:

```bash
POLYAGENT_EMBEDDINGS=hash POLYAGENT_MEMORY_DRIVER=local polyagent memory
```

To clear memory:

```bash
polyagent memory --clear
polyagent memory --agent researcher --clear
```

---

## Configuration

Machine-level configuration is encrypted with AES-256-GCM (keyed to your machine identity) and stored at `~/.polyagent/config.json` by default. Override the location for tests or isolated runs:

```bash
POLYAGENT_HOME=.tmp/polyagent-home polyagent status
```

PowerShell:

```powershell
$env:POLYAGENT_HOME = "$PWD\.tmp\polyagent-home"
polyagent status
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `POLYAGENT_HOME` | `~/.polyagent` | Config directory override. |
| `POLYAGENT_MEMORY_DRIVER` | _(unset)_ | `local` to use the in-repo JSON driver. |
| `POLYAGENT_EMBEDDINGS` | _(unset)_ | `hash` for offline deterministic embeddings. |
| `POLYAGENT_TOOL_APPROVAL` | `prompt` | `allow` to skip destructive-tool confirmations. |
| `POLYAGENT_WEB_SEARCH_PROVIDER` | `auto` | `auto`, `tavily`, or `duckduckgo`. |
| `POLYAGENT_WEB_TIMEOUT_MS` | `15000` | HTTP timeout for `fetch_url` and web search. |
| `POLYAGENT_AGENT_STEP_TIMEOUT_MS` | `180000` | Per-step wall clock (max 600000). |
| `POLYAGENT_AGENT_STEP_RETRIES` | `1` | Retries before reassigning to a fallback agent. |
| `POLYAGENT_MOCK_LLM_RESPONSE` | _(unset)_ | Force a single-line LLM response (tests). |
| `POLYAGENT_MOCK_WEB_SEARCH` | _(unset)_ | Force a single-line web search response (tests). |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama endpoint. |
| `TAVILY_API_KEY` | _(unset)_ | Enables Tavily web search. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter endpoint. |
| `OPENROUTER_HTTP_REFERER` | `https://polyagent.dev` | OpenRouter referer header. |
| `OPENROUTER_APP_NAME` | `Polyagent` | OpenRouter app title. |

---

## Examples

The `examples/` directory contains three ready-to-run setups:

- `examples/research-team/` — three-agent team (researcher, analyst, writer) using the `dynamic` planner.
- `examples/code-review-team/` — coder, reviewer, and tester pipeline with the `plan_and_execute` strategy and debate enabled.
- `examples/single-agent/` — minimal `react` strategy with one helper agent.

```bash
cd examples/research-team
polyagent init --yes --project-name Research --working-directory . --provider openai --api-key $OPENAI_API_KEY --memory skip
polyagent run --multi --yes "Research the top 5 JavaScript testing frameworks in 2026 and write a markdown report at ./reports/testing-frameworks.md"
```

---

## Development

```bash
git clone https://github.com/aryanbains/polyagent.git
cd polyagent
npm install
npm run check
```

`npm run check` is the main verification command. It runs TypeScript typechecking, the full unit test suite (Vitest), the e2e test suite, and the production build.

---

## Project status

Polyagent `0.1.0` is the first public release. It includes the terminal app, agent definitions, model-provider wiring, memory, file, web, and shell tools, dependency-aware multi-agent orchestration, graph approval and editing, agent-to-agent messages, cancellation, plan debate, session recording, replay, and sensitive-data redaction.

See [CHANGELOG.md](CHANGELOG.md) for the full release notes.

---

## License

MIT. See [LICENSE](LICENSE).
