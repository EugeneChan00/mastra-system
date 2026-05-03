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

## Slack Channel Integration (RT88-66)

The shared `supervisorAgent` now supports Mastra Channels with the official Chat SDK Slack adapter.

- Adapter package: `@chat-adapter/slack`
- Enable Slack adapter: set `ENABLE_SLACK_CHANNEL=true`
- Credentials are sourced from Chat SDK standard env vars (for webhook mode):
  - `SLACK_BOT_TOKEN`
  - `SLACK_SIGNING_SECRET`

When enabled, Mastra exposes this webhook endpoint for Slack events:

- `/api/agents/supervisor-agent/channels/slack/webhook`

Recommended Slack behavior for this integration:

- Use app mentions and thread replies as the primary interaction surface.
- Keep responses thread-continuous for follow-ups.
- Use webhook signature verification (via Slack signing secret) and dedupe in upstream webhook ingress/middleware.
