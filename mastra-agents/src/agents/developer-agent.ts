import { Agent } from "@mastra/core/agent";

import { buildDeveloperPrompt, developerAgentDescription } from "../prompts/index.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const developerAgent = new Agent({
  id: "developer-agent",
  name: "Developer Agent",
  description: developerAgentDescription,
  instructions: buildDeveloperPrompt(),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.developer,
});
