import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";

import {
  controlAgentDescription,
  controlInstructionsPrompt,
  controlPolicyPrompts,
  controlToolPrompts,
} from "../prompts/agents/control.js";
import { sharedPolicyPrompts } from "../prompts/policy.js";
import { sharedToolPrompts } from "../prompts/tools.js";
import { controlAgentScorerConfig } from "../scorers/control-agent.js";
import { workspaceTools } from "../tools/workspace.js";
import {
  agentDefaultOptions,
  composeAgentInstructions,
  defaultControlModel,
  defaultObservationalMemoryOptions,
  withAgentModes,
} from "./shared.js";

const storage = new PostgresStore({
  id: "mastra-control-agent-memory",
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://mastra:mastra@mastra-postgres:5432/mastra",
});

export const controlAgent = withAgentModes(new Agent({
  id: "control-agent",
  name: "Control Agent",
  description: controlAgentDescription,
  instructions: composeAgentInstructions(
    controlInstructionsPrompt,
    sharedPolicyPrompts.control,
    sharedToolPrompts.control,
    controlPolicyPrompts,
    controlToolPrompts,
  ),
  model: defaultControlModel,
  defaultOptions: agentDefaultOptions.control,
  memory: new Memory({
    storage,
    vector: false,
    options: {
      lastMessages: 20,
      semanticRecall: false,
      observationalMemory: defaultObservationalMemoryOptions,
      workingMemory: {
        enabled: false,
      },
      generateTitle: false,
    },
  }),
  scorers: controlAgentScorerConfig,
  tools: {
    list_files: workspaceTools.listFiles,
    read_file: workspaceTools.readFile,
    write_file: workspaceTools.writeFile,
    edit_file: workspaceTools.replaceInFile,
  },
}));
