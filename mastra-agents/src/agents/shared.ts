import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";

// ---------------------------------------------------------------------------
// Model routing
// ---------------------------------------------------------------------------
export const defaultAgentModel =
  process.env.MASTRA_AGENT_MODEL ?? process.env.MASTRA_MODEL ?? "openai/gpt-5-mini";
export const defaultSupervisorModel =
  process.env.MASTRA_SUPERVISOR_MODEL ?? process.env.MASTRA_AGENT_MODEL ?? process.env.MASTRA_MODEL ?? defaultAgentModel;
export const defaultControlModel =
  process.env.MASTRA_CONTROL_MODEL ?? process.env.MASTRA_MODEL ?? defaultAgentModel;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
const storage = new PostgresStore({
  id: "mastrasystem-agent-memory",
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://mastra:mastra@mastra-postgres:5432/mastra",
});

// ---------------------------------------------------------------------------
// Memory factory
// ---------------------------------------------------------------------------
export function createAgentMemory() {
  return new Memory({
    storage,
    vector: false,
    options: {
      lastMessages: 40,
      semanticRecall: false,
      workingMemory: {
        enabled: true,
        scope: "resource",
      },
      generateTitle: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Default execution options per agent role
// ---------------------------------------------------------------------------
const defaultToolCallConcurrency = 15;

export const agentDefaultOptions = {
  supervisor: { maxSteps: 50, toolCallConcurrency: defaultToolCallConcurrency },
  scout:       { maxSteps: 35, toolCallConcurrency: defaultToolCallConcurrency },
  researcher:  { maxSteps: 35, toolCallConcurrency: defaultToolCallConcurrency },
  advisor:     { maxSteps: 20, toolCallConcurrency: defaultToolCallConcurrency },
  architect:   { maxSteps: 40, toolCallConcurrency: defaultToolCallConcurrency },
  developer:   { maxSteps: 80, toolCallConcurrency: defaultToolCallConcurrency },
  validator:   { maxSteps: 45, toolCallConcurrency: defaultToolCallConcurrency },
  control:     { maxSteps: 25, toolCallConcurrency: defaultToolCallConcurrency },
} as const;
