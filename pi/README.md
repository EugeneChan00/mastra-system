# @mastrasystem/pi

Pi agents — adapters, extensions, and TUI for Mastra system.

## Package Structure

```
src/
  adapters/   — Relay network adapters for remote Mastra agents
  extensions/ — Agent extensions (Pi ↔ Mastra bridge)
  tui/        — Terminal UI for Pi agents
```

## Mastra Pi Runtime

Launch Pi with the local Mastra extension:

```bash
npm run dev --workspace @mastrasystem/pi
```

`MASTRA_BASE_URL` defaults to `http://localhost:4111/api`. Override it when needed:

```bash
MASTRA_BASE_URL=http://localhost:4112/api npm run dev --workspace @mastrasystem/pi
```

Run the live Mastra smoke check:

```bash
npm run smoke:mastra --workspace @mastrasystem/pi
```

Manual TUI smoke checklist:

- `/mastra status`
- `/mastra agents`
- `/mastra agent supervisor-agent`
- `/mastra workflows`
- `/mastra workflow checkApi`
- Ask Pi to list Mastra agents, inspect `supervisor-agent`, and list Mastra workflows.
