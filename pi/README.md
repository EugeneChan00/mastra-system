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

## Mastra Agent Widget Config

The extension reads optional project config from `config.yaml` in the active Pi working directory:

```yaml
mastra-agent-extension:
  maxCards: 4
  maxLines: 60
  listMaxLines: 18
  listMaxAgents: 5
  reservedRows: 10
  defaultViewMode: list
  viewModeShortcut: ctrl+h
  nextAgentShortcut: ctrl+down
  previousAgentShortcut: ctrl+up
  debug: true
  debugPiRedraw: true
```

Defaults are `maxCards: 4`, `maxLines: 60`, `listMaxLines: 18`, `listMaxAgents: 5`, `reservedRows: 10`, and `defaultViewMode: list`. List mode renders a compact above-editor job list with three lines per visible agent and a `+N more` marker when more than `listMaxAgents` jobs are working. `viewModeShortcut` cycles list → card region → detail region. The card/detail region also renders above the editor at a fixed height while jobs are visible, bounded by `maxLines` and the current terminal viewport. `nextAgentShortcut` and `previousAgentShortcut` focus running jobs in detail mode.

`debug: true` writes widget metrics to `~/.pi/agent/mastra-widget-debug.log`; `debugPiRedraw: true` also enables Pi's `~/.pi/agent/pi-debug.log` redraw reasons.

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
