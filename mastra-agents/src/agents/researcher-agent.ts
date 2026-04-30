import { Agent } from "@mastra/core/agent";

import {
  researcherAgentDescription,
  researcherInstructionsPrompt,
  researcherPolicyPrompts,
  researcherToolPrompts,
} from "../prompts/agents/researcher.js";
import { sharedPolicyPrompts } from "../prompts/policy.js";
import { sharedToolPrompts } from "../prompts/tools.js";
import { agentDefaultOptions, composeAgentInstructions, createAgentMemory, defaultAgentModel, withAgentModes } from "./shared.js";

export const researcherAgent = withAgentModes(new Agent({
  id: "researcher-agent",
  name: "Researcher Agent",
  description: researcherAgentDescription,
  instructions: composeAgentInstructions(
    researcherInstructionsPrompt,
    sharedPolicyPrompts.specialist,
    sharedToolPrompts.specialist,
    researcherPolicyPrompts,
    researcherToolPrompts,
  ),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.researcher,
}));
