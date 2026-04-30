import { Agent } from "@mastra/core/agent";

import {
  developerAgentDescription,
  developerInstructionsPrompt,
  developerModePrompts,
  developerPolicyPrompts,
  developerToolPrompts,
} from "../prompts/agents/developer.js";
import { sharedPolicyPrompts } from "../prompts/policy.js";
import { sharedToolPrompts } from "../prompts/tools.js";
import { agentDefaultOptions, agentModesFromPrompts, composeAgentInstructions, createAgentMemory, defaultAgentModel, withAgentModes } from "./shared.js";

export const developerAgent = withAgentModes(new Agent({
  id: "developer-agent",
  name: "Developer Agent",
  description: developerAgentDescription,
  instructions: composeAgentInstructions(
    developerInstructionsPrompt,
    sharedPolicyPrompts.specialist,
    sharedToolPrompts.specialist,
    developerPolicyPrompts,
    developerToolPrompts,
  ),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.developer,
}), agentModesFromPrompts(developerModePrompts));
