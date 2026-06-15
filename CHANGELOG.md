# Changelog

All notable changes to Polyagent will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-06-15

### Added
- `repository`, `homepage`, and `bugs` fields in `package.json` so the npm page links to [github.com/aryanbains/polyagent](https://github.com/aryanbains/polyagent).
- Project repository: [github.com/aryanbains/polyagent](https://github.com/aryanbains/polyagent).

## [0.1.0] - 2026-06-15

### Added
- Initial public release of the `polyagent` CLI on npm.
- Interactive terminal dashboard (Ink + React) with three-pane layout, mouse support, slash commands, and modal popups.
- Multi-agent orchestration: static + dynamic (LLM-generated) planners with dependency-aware parallel scheduling via `p-queue`.
- Plan debate layer: advocate / skeptic / judge virtual agents review and propose modifications to a plan before execution.
- Interactive plan graph editor (`TaskGraph`) with wave view, prompt editing, agent reassignment, dependency editing, step add/delete, and replan requests.
- Step retries with fallback agent reassignment, configurable step timeouts, full abort / cancellation support, and a queued approval prompt for tool calls.
- New `message_agent` tool so agents can request context from each other during multi-agent runs.
- 9 built-in tools: `read_file`, `write_file`, `append_to_file`, `list_directory`, `search_files`, `execute_command`, `web_search` (Tavily + DuckDuckGo fallback), `fetch_url`, and `message_agent`.
- Encrypted local configuration at `~/.polyagent/config.json` (AES-256-GCM keyed to machine identity).
- Memory backends: ChromaDB (production), local JSON driver for development, and a no-op skip driver.
- 5 LLM providers via Vercel AI SDK: OpenAI, Anthropic, Groq, OpenRouter, and Ollama.
- Session recording and replay with sensitive-data redaction (API keys, tokens, oversized blobs).
- Slash actions: `/settings`, `/agent`, `/multi`, `/memory`, `/validate`, `/clear`, `/exit`.
- 18 test files covering agents, chat, memory, tools, config, dashboard, task graph, debate, orchestration, and e2e CLI flows.

### Notes
- `polycode-cli` was the working name during development; the published package and command are both `polyagent`.
- Run `npm install -g polyagent` then `polyagent init` to get started.
