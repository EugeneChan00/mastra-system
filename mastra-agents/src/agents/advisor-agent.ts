import { Agent } from "@mastra/core/agent";

import { advisorAgentDescription, buildAdvisorPrompt } from "../prompts/index.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const advisorAgent = new Agent({
  id: "advisor-agent",
  name: "Advisor Agent",
  description: advisorAgentDescription,
  instructions: buildAdvisorPrompt(),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.advisor,
});
