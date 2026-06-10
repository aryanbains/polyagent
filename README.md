# Polycode

Polycode is a JavaScript-native multi-agent orchestration framework with a rich terminal GUI. The goal is to bring the multi-agent workflow ideas common in Python agent frameworks into the Node.js and TypeScript ecosystem, with an installable CLI that feels native to developer terminals.

This repository is currently in **Phase 3** of active development. Phase 1 established the installable CLI and terminal shell. Phase 2 added agent definitions, validation, model-provider wiring, chat, and persistent memory. Phase 3 adds the first tool system for files, commands, and web access.

## What Works Today

- `polycode init` opens an interactive onboarding wizard.
- `polycode init --yes ...` supports scripted setup for tests and demos.
- `polycode init` creates a starter `agents.yaml` in the configured working directory when one does not already exist.
- `polycode` launches the terminal app with an in-app prompt composer.
- `polycode status` prints the current local configuration summary.
- `polycode validate` validates `agents.yaml`, `agents.yml`, or `agents.json`.
- `polycode chat <agent-name>` and `polycode run "<task>"` remain available for scripts and direct testing.
- `polycode memory` shows memory backend status and embedding count.
- `polycode --version` prints the installed package version.
- API keys are not echoed in CLI output and are encrypted before being written to disk.

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

`init` saves your machine config and creates a starter `agents.yaml` with a `researcher` agent. Validate that project agent file:

```bash
polycode validate
```

Then launch the terminal app:

```bash
polycode
```

From there, stay inside the app. Type a request at the bottom prompt and press Enter:

```text
› read package.json and summarize this project
› list all TypeScript files in src
› create hello.txt with Hello World
```

Tool calls appear in the session transcript as they happen. File writes and shell commands pause the app for `y/n` approval before they run.

Edit the generated `agents.yaml` in your configured working directory when you want custom agents:

```yaml
agents:
  - name: researcher
    role: Project-aware coding assistant that can inspect files and answer questions
    goal: Help the user understand and change this project accurately
    memory_enabled: true
    tools: [read_file, list_directory, search_files, web_search, fetch_url]
  - name: writer
    role: Content writer that produces clear, structured documents
    goal: Transform research into readable content
    memory_enabled: true
```

Useful in-app commands:

- `/help` shows commands
- `/agents` lists agents
- `/agent researcher` switches agent
- `/memory` toggles the memory panel
- `/approve on` auto-approves file writes and shell commands for trusted local work
- `/approve off` returns to `y/n` prompts
- `/approve deny` refuses destructive tools
- `/clear` clears the visible session transcript
- `/exit` quits

The direct commands still exist for scripts and tests:

```bash
polycode chat researcher --message "What did we discuss before?"
polycode run "read my package.json and tell me what dependencies I am using"
polycode run --yes "create hello.txt with Hello World"
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

File and command tools are workspace-scoped. `write_file`, `append_to_file`, and `execute_command` show a preview and require confirmation unless you pass `--yes` or set `POLYCODE_TOOL_APPROVAL=allow`.

## Development

```bash
npm run dev
npm run typecheck
npm test
npm run test:e2e
npm run check
```

`npm run check` is the main verification command. It runs TypeScript checks, unit tests, a production build, and CLI e2e tests.

## Roadmap

Phase 4 is the multi-agent orchestration layer. Phase 5 is plugin support, docs polish, and publish readiness.

## Status

Polycode is not published to npm yet. Treat this as an early local-development preview, not a production agent runner.
