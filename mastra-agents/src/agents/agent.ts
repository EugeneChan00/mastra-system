import { Agent } from "@mastra/core/agent";

import {
  supervisorAgentDescription,
  supervisorInstructionsPrompt,
  supervisorPolicyPrompts,
  supervisorToolPrompts,
} from "../prompts/agents/supervisor.js";
import { sharedPolicyPrompts } from "../prompts/policy.js";
import { sharedToolPrompts } from "../prompts/tools.js";
import { workspaceTools } from "../tools/workspace.js";
import { advisorAgent } from "./advisor-agent.js";
import { architectAgent } from "./architect-agent.js";
import { controlAgent } from "./control-agent.js";
import { developerAgent } from "./developer-agent.js";
import { researcherAgent } from "./researcher-agent.js";
import { scoutAgent } from "./scout-agent.js";
import { agentDefaultOptions, composeAgentInstructions, createAgentMemory, defaultSupervisorModel, withAgentModes } from "./shared.js";
import { validatorAgent } from "./validator-agent.js";

export const supervisorAgent = withAgentModes(new Agent({
  id: "supervisor-agent",
  name: "Mastra System Supervisor",
  description: supervisorAgentDescription,
  instructions: composeAgentInstructions(
    supervisorInstructionsPrompt,
    sharedPolicyPrompts.supervisor,
    sharedToolPrompts.supervisor,
    supervisorPolicyPrompts,
    supervisorToolPrompts,
  ),
  model: defaultSupervisorModel,
  memory: createAgentMemory(),
  defaultOptions: agentDefaultOptions.supervisor,
  agents: {
    scoutAgent,
    researcherAgent,
    architectAgent,
    advisorAgent,
    developerAgent,
    validatorAgent,
  },
  tools: {
    list_files: workspaceTools.listFiles,
    read_file: workspaceTools.readFile,
    write_file: workspaceTools.writeFile,
    edit_file: workspaceTools.replaceInFile,
  },
}));

export const mastraAgents = {
  supervisorAgent,
  controlAgent,
  scoutAgent,
  researcherAgent,
  architectAgent,
  advisorAgent,
  developerAgent,
  validatorAgent,
};
