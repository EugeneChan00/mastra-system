import { Harness, type HarnessMode } from "@mastra/core/harness";

import { advisorAgent } from "./advisor-agent.js";
import { architectAgent } from "./architect-agent.js";
import { controlAgent } from "./control-agent.js";
import { developerAgent } from "./developer-agent.js";
import { researcherAgent } from "./researcher-agent.js";
import { scoutAgent } from "./scout-agent.js";
import { supervisorAgent } from "./agent.js";
import { validatorAgent } from "./validator-agent.js";

export const REQUEST_CONTEXT_HARDNESS_MODE_KEY = "hardnessMode";

export type MastraAgentHarnessState = {
  hardnessMode?: string;
};

export const mastraAgentHarnessModes: HarnessMode<MastraAgentHarnessState>[] = [
  { id: "supervisor", name: "Supervisor", default: true, agent: supervisorAgent },
  { id: "control", name: "Control", agent: controlAgent },
  { id: "scout", name: "Scout", agent: scoutAgent },
  { id: "researcher", name: "Researcher", agent: researcherAgent },
  { id: "architect", name: "Architect", agent: architectAgent },
  { id: "advisor", name: "Advisor", agent: advisorAgent },
  { id: "developer", name: "Developer", agent: developerAgent },
  { id: "validator", name: "Validator", agent: validatorAgent },
];

const defaultModeId = (mastraAgentHarnessModes.find((mode) => mode.default) ?? mastraAgentHarnessModes[0]).id;

const agentIdToModeId = new Map<string, string>([
  ["supervisor", "supervisor"],
  ["supervisorAgent", "supervisor"],
  ["supervisor-agent", "supervisor"],
  ["control", "control"],
  ["controlAgent", "control"],
  ["control-agent", "control"],
  ["scout", "scout"],
  ["scoutAgent", "scout"],
  ["scout-agent", "scout"],
  ["researcher", "researcher"],
  ["researcherAgent", "researcher"],
  ["researcher-agent", "researcher"],
  ["architect", "architect"],
  ["architectAgent", "architect"],
  ["architect-agent", "architect"],
  ["advisor", "advisor"],
  ["advisorAgent", "advisor"],
  ["advisor-agent", "advisor"],
  ["developer", "developer"],
  ["developerAgent", "developer"],
  ["developer-agent", "developer"],
  ["validator", "validator"],
  ["validatorAgent", "validator"],
  ["validator-agent", "validator"],
]);

export function defaultMastraAgentHarnessModeId(): string {
  return defaultModeId;
}

export function isMastraAgentHarnessModeId(value: unknown): value is string {
  return typeof value === "string" && mastraAgentHarnessModes.some((mode) => mode.id === value);
}

export function resolveMastraAgentHarnessModeId({
  agentId,
  hardnessMode,
}: {
  agentId?: string;
  hardnessMode?: string;
}): string {
  if (hardnessMode) {
    if (isMastraAgentHarnessModeId(hardnessMode)) {
      return hardnessMode;
    }
    throw new Error(`Unknown hardnessMode "${hardnessMode}". Expected one of: ${mastraAgentHarnessModes.map((mode) => mode.id).join(", ")}`);
  }

  if (agentId && agentIdToModeId.has(agentId)) {
    return agentIdToModeId.get(agentId)!;
  }

  return defaultModeId;
}

export function createMastraAgentHarness(): Harness<MastraAgentHarnessState> {
  return new Harness<MastraAgentHarnessState>({
    id: "mastra-system-agents",
    initialState: { hardnessMode: defaultModeId },
    modes: mastraAgentHarnessModes,
  });
}

export const mastraAgentHarness = createMastraAgentHarness();
