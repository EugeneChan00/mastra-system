import { Agent } from "@mastra/core/agent";

import { buildResearcherPrompt, researcherAgentDescription } from "../prompts/index.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const researcherAgent = new Agent({
  id: "researcher-agent",
  name: "Researcher Agent",
  description: researcherAgentDescription,
  instructions: buildResearcherPrompt(),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.researcher,
});
