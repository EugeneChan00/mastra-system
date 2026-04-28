import { Agent } from "@mastra/core/agent";

import { advisorPrompt } from "./prompts/advisor.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const advisorAgent = new Agent({
  id: "advisor-agent",
  name: "Advisor Agent",
  description: "Read-only critique of plans, assumptions, risks, and tradeoffs for supervisor delegation.",
  instructions: advisorPrompt,
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.advisor,
});
