# Polycode

Polycode is a JavaScript-native multi-agent orchestration framework with a rich terminal GUI. The goal is to bring the multi-agent workflow ideas common in Python agent frameworks into the Node.js and TypeScript ecosystem, with an installable CLI that feels native to developer terminals.

This repository is currently in **Phase 2** of active development. Phase 1 established the installable CLI and terminal shell. Phase 2 adds agent definitions, validation, model-provider wiring, chat, and persistent memory.

## What Works Today

- `polycode init` opens an interactive onboarding wizard.
- `polycode init --yes ...` supports scripted setup for tests and demos.
- `polycode` launches the terminal dashboard.
- `polycode status` prints the current local configuration summary.
- `polycode validate` validates `agents.yaml`, `agents.yml`, or `agents.json`.
- `polycode chat <agent-name>` chats with a configured agent.
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

Then launch the dashboard:

```bash
polycode
```

Create an `agents.yaml` in your configured working directory:

```yaml
agents:
  - name: researcher
    role: Research specialist that gathers and summarizes information
    goal: Find accurate, relevant information for any query
    model: gpt-4o-mini
    memory_enabled: true
    tools: [web_search, file_read]
  - name: writer
    role: Content writer that produces clear, structured documents
    goal: Transform research into readable content
    memory_enabled: true
```

Validate it:

```bash
polycode validate
```

Chat with an agent:

```bash
polycode chat researcher
```

Or send one noninteractive message:

```bash
polycode chat researcher --message "What did we discuss before?"
```

Useful keyboard controls in the dashboard:

- `q` quits
- `?` toggles help
- `m` toggles the memory panel
- arrows navigate panels and agents

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

To use ChromaDB, start a local Chroma server first. If it is not reachable, Polycode reports a friendly error instead of printing a stack trace.

## LLM Providers

Polycode uses the Vercel AI SDK provider adapters:

- OpenAI via `@ai-sdk/openai`
- Anthropic via `@ai-sdk/anthropic`
- Groq via `@ai-sdk/groq`
- Ollama via `@ai-sdk/openai-compatible` and `OLLAMA_BASE_URL`, defaulting to `http://localhost:11434/v1`

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

Phase 3 will introduce tools and safe file operations. Phase 4 is the multi-agent orchestration layer. Phase 5 is plugin support, docs polish, and publish readiness.

## Status

Polycode is not published to npm yet. Treat this as an early local-development preview, not a production agent runner.
