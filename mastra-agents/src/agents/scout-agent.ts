import { Agent } from "@mastra/core/agent";

import {
  scoutAgentDescription,
  scoutInstructionsPrompt,
  scoutModePrompts,
  scoutPolicyPrompts,
  scoutToolPrompts,
} from "../prompts/agents/scout.js";
import { sharedPolicyPrompts } from "../prompts/policy.js";
import { sharedToolPrompts } from "../prompts/tools.js";
import { agentDefaultOptions, agentModesFromPrompts, composeAgentInstructions, createAgentMemory, defaultAgentModel, withAgentModes } from "./shared.js";

export const scoutAgent = withAgentModes(new Agent({
  id: "scout-agent",
  name: "Scout Agent",
  description: scoutAgentDescription,
  instructions: composeAgentInstructions(
    scoutInstructionsPrompt,
    undefined,
    sharedPolicyPrompts.specialist,
    sharedToolPrompts.specialist,
    scoutPolicyPrompts,
    scoutToolPrompts,
  ),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.scout,
}), agentModesFromPrompts(scoutModePrompts));
