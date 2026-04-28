import { Agent } from "@mastra/core/agent";

import { architectPrompt } from "./prompts/architect.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const architectAgent = new Agent({
  id: "architect-agent",
  name: "Architect Agent",
  description: "Read-only boundary, contract, state ownership, and integration design for supervisor delegation.",
  instructions: architectPrompt,
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.architect,
});
