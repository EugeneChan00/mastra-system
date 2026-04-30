import { Agent } from "@mastra/core/agent";

import { buildScoutPrompt, scoutAgentDescription } from "../prompts/index.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const scoutAgent = new Agent({
  id: "scout-agent",
  name: "Scout Agent",
  description: scoutAgentDescription,
  instructions: buildScoutPrompt(),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.scout,
});
