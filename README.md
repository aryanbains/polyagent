# Polycode

Polycode is a JavaScript-native multi-agent orchestration framework with a rich terminal GUI.

Phase 1 is focused on the foundation:

- `polycode init` starts an onboarding wizard.
- `polycode` opens the terminal dashboard.
- `polycode --version` prints the package version.
- Configuration is stored outside the project under the user's Polycode home directory.
- API keys are encrypted before they are written to disk.

## Local Development

```bash
npm install
npm run check
npm install -g .
polycode --version
polycode init
polycode
```

For automated onboarding, useful in tests:

```bash
polycode init --yes --project-name Demo --working-directory . --provider openai --api-key test-key --memory skip
```
