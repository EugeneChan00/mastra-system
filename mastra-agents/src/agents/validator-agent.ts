import { Agent } from "@mastra/core/agent";

import { validatorPrompt } from "./prompts/validator.js";
import { agentDefaultOptions, createAgentMemory, defaultAgentModel } from "./shared.js";

export const validatorAgent = new Agent({
  id: "validator-agent",
  name: "Validator Agent",
  description: "Read-only validation of diffs, tests, contracts, and evidence for supervisor delegation.",
  instructions: validatorPrompt,
  model: defaultAgentModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.validator,
});
