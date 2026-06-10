# Polycode

Polycode is a JavaScript-native multi-agent orchestration framework with a rich terminal GUI. The goal is to bring the multi-agent workflow ideas common in Python agent frameworks into the Node.js and TypeScript ecosystem, with an installable CLI that feels native to developer terminals.

This repository is currently in **Phase 1** of active development. Phase 1 is the foundation: package scaffolding, onboarding, local configuration, and the first terminal dashboard shell.

## What Works Today

- `polycode init` opens an interactive onboarding wizard.
- `polycode init --yes ...` supports scripted setup for tests and demos.
- `polycode` launches the terminal dashboard.
- `polycode status` prints the current local configuration summary.
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

Useful keyboard controls in the dashboard:

- `q` quits
- `?` toggles help
- left/right switches panels

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

Phase 2 will add agent definitions, LLM provider connections, `agents.yaml` validation, and the first memory backend integration. Phase 3 will introduce tools. Phase 4 is the multi-agent orchestration layer. Phase 5 is plugin support, docs polish, and publish readiness.

## Status

Polycode is not published to npm yet. Treat this as an early local-development preview, not a production agent runner.
