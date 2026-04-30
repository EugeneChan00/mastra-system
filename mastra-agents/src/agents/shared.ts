import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";

export const defaultMiniMaxModel = "minimax-coding-plan/MiniMax-M2.7";
export const defaultAgentModel =
  process.env.MASTRA_AGENT_MODEL ?? process.env.MASTRA_SUBAGENT_MODEL ?? process.env.MASTRA_MODEL ?? defaultMiniMaxModel;
export const defaultSupervisorModel =
  process.env.MASTRA_SUPERVISOR_MODEL ??
  process.env.MASTRA_AGENT_MODEL ??
  process.env.MASTRA_SUBAGENT_MODEL ??
  process.env.MASTRA_MODEL ??
  defaultMiniMaxModel;
export const defaultControlModel =
  process.env.MASTRA_CONTROL_MODEL ??
  process.env.MASTRA_AGENT_MODEL ??
  process.env.MASTRA_SUBAGENT_MODEL ??
  process.env.MASTRA_MODEL ??
  defaultMiniMaxModel;

const defaultToolCallConcurrency = 15;

export type AgentModeMetadata = {
  id: string;
  name: string;
  default?: boolean;
};

export const defaultAgentModes = [
  { id: "default", name: "Default", default: true },
] as const satisfies readonly AgentModeMetadata[];

export const defaultObservationalMemoryModel =
  process.env.MASTRA_OBSERVATIONAL_MEMORY_MODEL ?? defaultAgentModel;

export const defaultObservationalMemoryOptions = {
  model: defaultObservationalMemoryModel,
} as const;

const storage = new PostgresStore({
  id: "mastra-agent-memory",
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://mastra:mastra@mastra-postgres:5432/mastra",
});

export function createAgentMemory() {
  return new Memory({
    storage,
    vector: false,
    options: {
      lastMessages: 40,
      semanticRecall: false,
      observationalMemory: defaultObservationalMemoryOptions,
      workingMemory: {
        enabled: true,
        scope: "resource",
      },
      generateTitle: false,
    },
  });
}

export const agentDefaultOptions = {
  supervisor: { maxSteps: 50, toolCallConcurrency: defaultToolCallConcurrency },
  scout: { maxSteps: 35, toolCallConcurrency: defaultToolCallConcurrency },
  researcher: { maxSteps: 35, toolCallConcurrency: defaultToolCallConcurrency },
  advisor: { maxSteps: 20, toolCallConcurrency: defaultToolCallConcurrency },
  architect: { maxSteps: 40, toolCallConcurrency: defaultToolCallConcurrency },
  developer: { maxSteps: 80, toolCallConcurrency: defaultToolCallConcurrency },
  validator: { maxSteps: 45, toolCallConcurrency: defaultToolCallConcurrency },
  control: { maxSteps: 25, toolCallConcurrency: defaultToolCallConcurrency },
} as const;

export const streamingDefaultOptions = agentDefaultOptions.supervisor;

export function composeAgentInstructions(
  instructions: string,
  ...promptGroups: Array<readonly string[]>
): string {
  const userSubmittedRuntimePrompts = promptGroups
    .flat()
    .filter((content) => content.trim().length > 0);

  if (userSubmittedRuntimePrompts.length === 0) {
    return instructions;
  }

  return [
    instructions,
    "# Runtime Policy And Tooling",
    ...userSubmittedRuntimePrompts,
  ].join("\n\n");
}

export function withAgentModes<TAgent extends object>(
  agent: TAgent,
  modes: readonly AgentModeMetadata[] = defaultAgentModes,
): TAgent & { mode: string; modes: readonly AgentModeMetadata[] } {
  const defaultMode = modes.find((mode) => mode.default) ?? modes[0];
  return Object.assign(agent, {
    mode: defaultMode?.id ?? "default",
    modes,
  });
}
