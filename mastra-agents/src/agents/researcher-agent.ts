import { Agent } from "@mastra/core/agent";

import { researcherPrompt } from "./prompts/researcher.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const researcherAgent = new Agent({
  id: "researcher-agent",
  name: "Researcher Agent",
  description: "Read-only external documentation, ecosystem, and version-sensitive research for supervisor delegation.",
  instructions: researcherPrompt,
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.researcher,
});
