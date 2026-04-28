import { Agent } from "@mastra/core/agent";

import { developerPrompt } from "./prompts/developer.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const developerAgent = new Agent({
  id: "developer-agent",
  name: "Developer Agent",
  description: "Focused implementation support for clearly bounded build tasks delegated by a supervisor.",
  instructions: developerPrompt,
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.developer,
});
