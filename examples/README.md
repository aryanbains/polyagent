# Examples

Three ready-to-run setups you can copy into your own workspace.

## `research-team/`
Three-agent team: **researcher** gathers facts from the web and your files, **analyst** turns those facts into structured recommendations, and **writer** produces the final report. Uses the **dynamic** planner so the LLM picks the steps for your task.

```bash
cd research-team
polyagent init --yes --project-name Research --working-directory . --provider openai --api-key $OPENAI_API_KEY --memory skip
polyagent run --multi --yes "Research the top 5 JavaScript testing frameworks in 2026 and write a markdown report at ./reports/testing-frameworks.md"
```

## `code-review-team/`
Pipeline of **coder → reviewer → tester** with the **plan_and_execute** strategy. The debate layer will ask the reviewer to find holes in the coder's plan before any code is written.

```bash
cd code-review-team
polyagent init --yes --project-name CodeReview --working-directory . --provider openai --api-key $OPENAI_API_KEY --memory skip
polyagent run --multi --yes "Add a debounce helper to src/utils/debounce.ts with unit tests"
```

## `single-agent/`
Minimal setup using the **react** strategy with one **helper** agent. Use this as a starting point for your own personal assistant.

```bash
cd single-agent
polyagent init --yes --project-name Helper --working-directory . --provider openai --api-key $OPENAI_API_KEY --memory skip
polyagent chat helper
```
