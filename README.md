# Mastra System

A monorepo for the Mastra agentic development environment, organized as a multi-package workspace.

```
mastra-system/
├── mastra-code/       @mastrasystem/code — Mastra Code wrapper (CLI + TUI)
├── mastra-agents/     @mastrasystem/agents — Supervisor + specialist agent patterns
│   ├── pi/            @mastrasystem/pi — Pi TUI adapters, extensions, terminal UI
│   └── paseo/         @mastrasystem/paseo — Relay network adapter
├── package.json       Workspace root (npm/bun workspaces)
└── tsconfig.base.json Shared TypeScript config
```

## Packages

### `@mastrasystem/code` — Mastra Code Wrapper

Thin local wrapper around `mastracode` using the public Mastra Code API:

- `createMastraCode(...)` for harness setup
- `MastraTUI` for the terminal UI
- `Agent` definitions for custom modes
- `subagents` definitions for focused child agents
- `initialState` for documented startup defaults

```bash
cd mastra-code
bun install
bun run mastra-code -- --cwd /path/to/project
```

### `@mastrasystem/agents` — Agent Patterns

Supervisor + 6 specialist agents in the Daytona agents pattern (Eugenechan00/daytona-agents):

| Agent | Role |
|---|---|
| `supervisor` | Orchestrator — delegates to specialists |
| `scout` | Current-state discovery |
| `researcher` | External documentation and ecosystem research |
| `architect` | Boundary, contract, and integration design |
| `advisor` | Critique of plans, risks, and tradeoffs |
| `developer` | Focused implementation |
| `validator` | Diff, test, and evidence validation |
| `control` | Evaluative quality control |

**Tools:** Daytona sandbox (create/list/execute), workspace filesystem  
**Scorers:** Prompt alignment, answer relevancy, toxicity  
**Storage:** PostgresStore + DuckDBStore + FilesystemStore (composite)  
**Sandbox:** DaytonaAgentsDaytonaSandbox — auto-reconciles mounts, detects working dir

See [daytona-agents](https://github.com/Eugenechan00/daytona-agents) for the reference implementation.

### `@mastrasystem/pi` — Pi TUI

Terminal UI components built on `@mariozechner/pi-tui`:

- `adapters/` — Relay and transport adapters
- `extensions/` — Extension protocol for agent capabilities
- `tui/` — Terminal UI rendering components

### `@mastrasystem/paseo` — Paseo Adapter

Custom relay network adapter for the Mastra system.

## Setup

### 1. Install dependencies

```bash
bun install  # or npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your API keys and preferences
```

### 3. Daytona sandbox (optional, for @mastrasystem/agents)

Set the `DAYTONA_API_KEY` and `MASTRA_DAYTONA_ENDPOINT` in your `.env` to enable sandbox creation and management.

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic / Claude |
| `OPENAI_API_KEY` | OpenAI |
| `MINIMAX_API_KEY` | MiniMax |
| `DAYTONA_API_KEY` | Daytona sandbox API |
| `MASTRA_DAYTONA_ENDPOINT` | Daytona server endpoint |
| `MASTRA_CODE_MODEL` | Orchestrator model (default: rl/gpt-5.5) |
| `MASTRA_SUBAGENT_MODEL` | Subagent model (default: minimax-coding-plan/MiniMax-M2.7) |

## Type checking

```bash
bun run typecheck   # runs typecheck across all workspace packages
```
