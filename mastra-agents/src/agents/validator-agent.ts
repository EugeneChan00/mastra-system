import { Agent } from "@mastra/core/agent";

import { buildValidatorPrompt, validatorAgentDescription } from "../prompts/index.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const validatorAgent = new Agent({
  id: "validator-agent",
  name: "Validator Agent",
  description: validatorAgentDescription,
  instructions: buildValidatorPrompt(),
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.validator,
});
