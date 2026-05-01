import { Agent } from "@mastra/core/agent";

import {
  validatorAgentDescription,
  validatorInstructionsPrompt,
  validatorModePrompts,
  validatorPolicyPrompts,
  validatorToolPrompts,
} from "../prompts/agents/validator.js";
import { sharedPolicyPrompts } from "../prompts/policy.js";
import { sharedToolPrompts } from "../prompts/tools.js";
import { agentDefaultOptions, agentModesFromPrompts, composeAgentInstructions, createAgentMemory, defaultAgentModel, withAgentModes } from "./shared.js";

export const validatorAgent = withAgentModes(new Agent({
  id: "validator-agent",
  name: "Validator Agent",
  description: validatorAgentDescription,
  instructions: composeAgentInstructions(
    validatorInstructionsPrompt,
    undefined,
    sharedPolicyPrompts.validator,
    sharedToolPrompts.specialist,
    validatorPolicyPrompts,
    validatorToolPrompts,
  ),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.validator,
}), agentModesFromPrompts(validatorModePrompts));
