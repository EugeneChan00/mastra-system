import { Agent } from "@mastra/core/agent";

import {
  advisorAgentDescription,
  advisorInstructionsPrompt,
  advisorPolicyPrompts,
  advisorToolPrompts,
} from "../prompts/agents/advisor.js";
import { sharedPolicyPrompts } from "../prompts/policy.js";
import { sharedToolPrompts } from "../prompts/tools.js";
import { agentDefaultOptions, composeAgentInstructions, createAgentMemory, defaultAgentModel, withAgentModes } from "./shared.js";

export const advisorAgent = withAgentModes(new Agent({
  id: "advisor-agent",
  name: "Advisor Agent",
  description: advisorAgentDescription,
  instructions: composeAgentInstructions(
    advisorInstructionsPrompt,
    sharedPolicyPrompts.specialist,
    sharedToolPrompts.specialist,
    advisorPolicyPrompts,
    advisorToolPrompts,
  ),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.advisor,
}));
