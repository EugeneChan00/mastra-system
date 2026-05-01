import { Agent } from "@mastra/core/agent";

import {
  architectAgentDescription,
  architectInstructionsPrompt,
  architectModePrompts,
  architectPolicyPrompts,
  architectToolPrompts,
} from "../prompts/agents/architect.js";
import { sharedPolicyPrompts } from "../prompts/policy.js";
import { sharedToolPrompts } from "../prompts/tools.js";
import { agentDefaultOptions, agentModesFromPrompts, composeAgentInstructions, createAgentMemory, defaultAgentModel, withAgentModes } from "./shared.js";

export const architectAgent = withAgentModes(new Agent({
  id: "architect-agent",
  name: "Architect Agent",
  description: architectAgentDescription,
  instructions: composeAgentInstructions(
    architectInstructionsPrompt,
    undefined,
    sharedPolicyPrompts.specialist,
    sharedToolPrompts.specialist,
    architectPolicyPrompts,
    architectToolPrompts,
  ),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.architect,
}), agentModesFromPrompts(architectModePrompts));
