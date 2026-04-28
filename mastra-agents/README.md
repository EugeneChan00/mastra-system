# @mastrasystem/agents

Core Mastra agents package — supervisor pattern with specialist agents, createTool workflows, and Mastra server bootstrap.

## Package Structure

```
src/
  agents/        — Agent definitions (supervisor, scout, researcher, architect,
                    advisor, developer, validator, control)
  tools/          — createTool + Zod schema patterns
  workflows/      — createWorkflow definitions
  scorers/        — Eval/scorer configs
  mastra/         — Mastra server bootstrap
```

## Key Patterns

- **Supervisor-delegation**: One orchestrator (`supervisorAgent`) delegates to specialist Mastra Agent instances
- **Strict prompt discipline**: Evidence discipline + blocker protocol fragments
- **Zod-typed tools**: Every tool uses `createTool` with typed input/output schemas
- **Composite storage**: PostgresStore + DuckDBStore via MastraCompositeStore
- **Step ceilings**: Each agent has a hard `maxSteps` default to prevent runaway loops
