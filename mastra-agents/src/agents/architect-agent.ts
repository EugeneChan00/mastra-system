import { Agent } from "@mastra/core/agent";

import { architectAgentDescription, buildArchitectPrompt } from "../prompts/index.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const architectAgent = new Agent({
  id: "architect-agent",
  name: "Architect Agent",
  description: architectAgentDescription,
  instructions: buildArchitectPrompt(),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.architect,
});
