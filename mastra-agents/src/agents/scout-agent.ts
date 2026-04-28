import { Agent } from "@mastra/core/agent";

import { scoutPrompt } from "./prompts/scout.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const scoutAgent = new Agent({
  id: "scout-agent",
  name: "Scout Agent",
  description: "Read-only repository discovery and current-state inspection for supervisor delegation.",
  instructions: scoutPrompt,
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.scout,
});
