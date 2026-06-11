# Polycode

Polycode is a JavaScript-native multi-agent orchestration framework with a rich terminal GUI. The goal is to bring the multi-agent workflow ideas common in Python agent frameworks into the Node.js and TypeScript ecosystem, with an installable CLI that feels native to developer terminals.

This repository is currently in **Phase 4** of active development. Phase 1 established the installable CLI and terminal shell. Phase 2 added agent definitions, validation, model-provider wiring, chat, and persistent memory. Phase 3 added the first tool system for files, commands, and web access. Phase 3.5 hardened the runtime with structured execution events, explicit execution sessions, stronger tool failure handling, web-search settings, and golden-path regressions. Phase 4 adds the first multi-agent orchestration layer: planning, dependency-aware scheduling, agent-to-agent messages, session recording, and replay.

## What Works Today

- `polycode init` opens an interactive onboarding wizard.
- `polycode init --yes ...` supports scripted setup for tests and demos.
- `polycode init` creates a starter `agents.yaml` in the configured working directory when one does not already exist.
- `polycode` launches the terminal app with an in-app prompt composer, agent controls, settings, and multi-agent mode.
- `polycode status` prints the current local configuration summary.
- `polycode validate` validates `agents.yaml`, `agents.yml`, or `agents.json`.
- `polycode chat <agent-name>` and `polycode run "<task>"` remain available for scripts and direct testing.
- `polycode run --multi "<task>"` plans and executes a task across multiple agents.
- `polycode replay <session-id>` replays a recorded multi-agent session.
- `polycode memory` shows memory backend status and embedding count.
- `polycode --version` prints the installed package version.
- API keys are not echoed in CLI output and are encrypted before being written to disk.
- Every agent run emits structured execution events for run/tool start and finish, including agent name, step id, status, timestamps, duration, input, output summary, and optional token counts.

## Install Locally

```bash
npm install
npm run check
npm install -g .
polycode --version
```

## Quickstart

Run the onboarding wizard:

```bash
polycode init
```

`init` saves your machine config and creates a starter `agents.yaml` with an orchestrator plus `researcher`, `analyst`, and `writer` agents. Validate that project agent file:

```bash
polycode validate
```

Then launch the terminal app:

```bash
polycode
```

From there, stay inside the app. Type a request at the bottom prompt and press Enter:

```text
> read package.json and summarize this project
> list all TypeScript files in src
> create hello.txt with Hello World
```

Tool activity appears in compact form while a run is active, then collapses into a "Steps taken" summary above the final answer. File writes and shell commands pause the app for `y/n` approval before they run.

Press `/` in the prompt to open searchable actions. The list filters as you type, so `/set` finds Settings, `/agent` finds agent creation, and `/multi` switches to multi-agent mode.

- Mouse click `+ New agent`: create an agent inside the terminal UI
- Mouse wheel over the conversation panel: scroll the transcript
- `PageUp` / `PageDown`: keyboard-scroll the session transcript
- `Esc`: close popups
- `Ctrl+C`: quit

The Settings popup controls run mode, web search provider, approvals, planner strategy, and memory visibility without leaving the app. The `+ New agent` control writes or updates `agents.yaml` for you. Single-letter shortcuts are intentionally avoided so normal prompts like `search this repo` type normally.

The generated `agents.yaml` is still the durable project config and can be versioned:

```yaml
orchestrator:
  strategy: plan_and_execute
  max_parallel_agents: 3
  max_iterations: 10
agents:
  - name: researcher
    role: Project-aware coding assistant that can inspect files and answer questions
    goal: Help the user understand and change this project accurately
    memory_enabled: true
    tools: [read_file, list_directory, search_files, web_search, fetch_url]
  - name: analyst
    role: Analysis specialist that compares findings and identifies risks
    goal: Turn raw research into structured recommendations
    memory_enabled: true
  - name: writer
    role: Content writer that produces clear, structured documents
    goal: Transform research into readable content
    memory_enabled: true
    tools: [read_file, write_file, append_to_file]
```

Slash actions available in the app include switching run mode, creating agents, opening settings, validating agents, toggling memory, clearing the session, and exiting.

The direct commands still exist for scripts and tests:

```bash
polycode chat researcher --message "What did we discuss before?"
polycode run "read my package.json and tell me what dependencies I am using"
polycode run --yes "create hello.txt with Hello World"
```

Run a multi-agent task:

```bash
polycode run --multi --yes "Research the top 5 JavaScript testing frameworks in 2024, compare their features, and create a markdown report at ./reports/testing-frameworks.md"
```

The multi-agent runner prints the plan, delegates work to agents, shows agent-to-agent messages and tool events, saves a session under `.polycode/sessions/`, and writes the requested markdown report when file approval is allowed.

Replay the recorded session:

```bash
polycode replay 2026-06-10T20-00-00-000Z
polycode replay ./.polycode/sessions/2026-06-10T20-00-00-000Z.json --speed 4
```

For automated setup:

```bash
polycode init --yes --project-name Demo --working-directory . --provider openai --api-key test-key --memory skip
```

## Configuration

Polycode stores machine-level configuration outside your project directory. By default, the config file lives at:

```text
~/.polycode/config.json
```

For tests or isolated runs, override the location:

```bash
POLYCODE_HOME=.tmp/polycode-home polycode status
```

On PowerShell:

```powershell
$env:POLYCODE_HOME = "$PWD\.tmp\polycode-home"
polycode status
```

## Memory

The configured Phase 2 memory backends are:

- `chroma`: uses a local ChromaDB server at `localhost:8000`.
- `skip`: disables memory.
- `pinecone`: reserved for a future cloud memory adapter.

For local tests and demos without ChromaDB, use the development memory driver:

```bash
POLYCODE_MEMORY_DRIVER=local polycode chat researcher --message "Remember Vitest"
POLYCODE_MEMORY_DRIVER=local polycode memory
```

On PowerShell:

```powershell
$env:POLYCODE_MEMORY_DRIVER = "local"
polycode chat researcher --message "Remember Vitest"
polycode memory
```

To clear memory:

```bash
polycode memory --clear
polycode memory --agent researcher --clear
```

Polycode uses local semantic embeddings by default through `@xenova/transformers` and `Xenova/all-MiniLM-L6-v2`. The first memory operation may download the model. For fast offline tests, use the deterministic hash embedder:

```bash
POLYCODE_EMBEDDINGS=hash POLYCODE_MEMORY_DRIVER=local polycode chat researcher --message "Remember Vitest"
```

On PowerShell:

```powershell
$env:POLYCODE_EMBEDDINGS = "hash"
$env:POLYCODE_MEMORY_DRIVER = "local"
polycode chat researcher --message "Remember Vitest"
```

To use ChromaDB, start a local Chroma server first. If it is not reachable, Polycode reports a friendly error instead of printing a stack trace.

## LLM Providers

Polycode uses the Vercel AI SDK provider adapters:

- OpenAI via `@ai-sdk/openai`
- Anthropic via `@ai-sdk/anthropic`
- Groq via `@ai-sdk/groq`
- OpenRouter via `@ai-sdk/openai-compatible`
- Ollama via `@ai-sdk/openai-compatible` and `OLLAMA_BASE_URL`, defaulting to `http://localhost:11434/v1`

For OpenRouter, choose `openrouter` during onboarding and use OpenRouter model IDs in `agents.yaml`, for example:

```yaml
agents:
  - name: researcher
    role: Research specialist
    goal: Find accurate information
    model: deepseek/deepseek-v4-pro
    memory_enabled: true
    tools: [read_file, list_directory, search_files, web_search, fetch_url]
```

## Tools

Agents can call tools listed in their `tools` array. Built-in tools:

- `read_file(path)`
- `write_file(path, content)`
- `append_to_file(path, content)`
- `list_directory(path, recursive?)`
- `search_files(pattern, directory?)`
- `execute_command(command, working_dir?, timeout_ms?)`
- `web_search(query, max_results?)`
- `fetch_url(url)`

File and command tools are workspace-scoped. `write_file`, `append_to_file`, and `execute_command` show a preview and require confirmation unless you pass `--yes`, set `/approve on` in the terminal app, or set `POLYCODE_TOOL_APPROVAL=allow`.

`web_search` supports:

- `auto`: Tavily when `TAVILY_API_KEY` exists, otherwise no-key DuckDuckGo.
- `tavily`: Tavily only; fails clearly if `TAVILY_API_KEY` is missing.
- `duckduckgo`: no-key DuckDuckGo HTML results with Instant Answer fallback.

DuckDuckGo is useful for local no-key testing, but it can return an anti-bot challenge to automated terminal traffic. When that happens, Polycode reports it clearly instead of giving the model an empty result. Use Tavily for reliable agent web search.

Set it in the terminal app by typing `/settings`, pressing Enter, and changing the Web search row:

```text
/settings
```

Or from the environment:

```bash
POLYCODE_WEB_SEARCH_PROVIDER=duckduckgo polycode
```

On PowerShell:

```powershell
$env:POLYCODE_WEB_SEARCH_PROVIDER = "duckduckgo"
polycode
```

DuckDuckGo Instant Answer is a no-key fallback for summaries, definitions, and related-topic links. It is not a full ranked search-results API, so Tavily remains the better mode for agentic research tasks when available.

## Multi-Agent Orchestration

Top-level `orchestrator` config:

```yaml
orchestrator:
  strategy: plan_and_execute
  max_parallel_agents: 3
  max_iterations: 10
```

Current strategies:

- `plan_and_execute`: creates research, analysis, and synthesis steps, then schedules dependency-ready work.
- `sequential`: forces a strict dependency chain.
- `dynamic`: asks the LLM planner to return a task-specific JSON plan, validates it, and falls back to the static plan if malformed.
- `react`: accepted in config for forward compatibility; currently uses the same planner shape as `plan_and_execute`.

Dynamic planning example:

```yaml
orchestrator:
  strategy: dynamic
  max_parallel_agents: 3
  max_iterations: 8
```

The dynamic planner receives the task plus available agent names, roles, and goals. It must return JSON plan steps with `id`, `title`, `agentName`, `prompt`, and `dependsOn`. Polycode sanitizes the result, removes invalid dependencies, rejects cycles, and uses the static research/analysis/synthesis plan as a fallback if the LLM output is not valid JSON.

The Phase 4 message bus validates every inter-agent message with zod. Messages are stored in the session history:

```ts
{
  from: "researcher",
  to: "writer",
  type: "response",
  payload: {},
  timestamp: Date
}
```

The scheduler uses `p-queue` to honor `max_parallel_agents`. Independent steps run concurrently when possible; dependent steps wait for prior results. If a step fails, the orchestrator records the failure, sends an error message, and continues with the remaining graph where possible.

Session recordings include plan, messages, execution events, step outputs, final output, stats, and duration.

## Runtime Events

Polycode has an execution session object for every agent run. Phase 4 extends it to multi-agent sessions while keeping planner and orchestrator descriptors separate in the type system.

Execution events include:

- `run_started`
- `tool_started`
- `tool_finished`
- `run_finished`

Tool events include agent name, run id, step id, tool call id, tool name, input, output summary, success/failure, duration, and timestamps.

## Development

```bash
npm run dev
npm run typecheck
npm test
npm run test:e2e
npm run check
```

`npm run check` is the main verification command. It runs TypeScript checks, unit tests, a production build, and CLI e2e tests.

Phase 3.5 golden-path regressions live in `test/phase35.test.ts` and cover repo inspection, file summarization, guarded file modification, command execution, and web docs fetching. Phase 4 orchestration tests live in `test/orchestration.test.ts` and cover message passing, dynamic planning, dynamic fallback, graceful fallback, sequential vs parallel scheduling, report creation, and session replay loading. `test/multi-agent-view.test.tsx` includes a dense rerender stress test for the three-agent terminal layout.

## Roadmap

Phase 5 is plugin support, docs polish, and publish readiness.

## Status

Polycode is not published to npm yet. Treat this as an early local-development preview, not a production agent runner.
