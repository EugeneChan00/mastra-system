import { Agent } from "@mastra/core/agent";

import {
  advisorAgentDescription,
  advisorInstructionsPrompt,
  advisorModePrompts,
  advisorPolicyPrompts,
  advisorToolPrompts,
} from "../prompts/agents/advisor.js";
import { sharedPolicyPrompts } from "../prompts/policy.js";
import { sharedToolPrompts } from "../prompts/tools.js";
import { agentDefaultOptions, agentModesFromPrompts, composeAgentInstructions, createAgentMemory, defaultAgentModel, withAgentModes } from "./shared.js";
import { deepWikiMCP } from "../mcp/index.js";

// Initialize DeepWiki tools for advisor agent
// DeepWiki helps advisor with repo analysis, integration research, architecture reviews
const deepWikiTools = await deepWikiMCP.listTools();

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
  tools: deepWikiTools,
}), agentModesFromPrompts(advisorModePrompts));
