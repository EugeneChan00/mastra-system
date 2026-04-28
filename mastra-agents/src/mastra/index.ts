import { Mastra } from '@mastra/core';

import { mastraAgents } from '../agents/index.js';

/**
 * TODO: Composite storage (pg + duckdb + filesystem)
 * TODO: Wire observability pipeline with SensitiveDataFilter
 * TODO: Connect Pi2E orchestrator and relay network adapter
 * TODO: Add Mastra Code harness subagent tool connection
 */
export function createMastraServer() {
  return new Mastra({
    agents: mastraAgents,
    // TODO: Add telemetry, composite storage, Pi2E relay adapter, and subagent tool
  });
}
