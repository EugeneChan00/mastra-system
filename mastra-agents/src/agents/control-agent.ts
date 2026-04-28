import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";

import { controlAgentScorerConfig } from "../scorers/control-agent.js";
import { daytonaTools } from "../tools/daytona.js";
import { workspaceTools } from "../tools/workspace.js";
import { controlPrompt } from "./prompts/control.js";
import { agentDefaultOptions, defaultControlModel } from "./shared.js";

const storage = new PostgresStore({
  id: "mastrasystem-control-agent-memory",
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://mastra:mastra@mastra-postgres:5432/mastra",
});

export const controlAgent = new Agent({
  id: "control-agent",
  name: "Control Plane Agent",
  description:
    "Control-plane diagnostics and explicit lifecycle management for Daytona sandboxes and workspace tools.",
  instructions: controlPrompt,
  model: defaultControlModel,
  defaultOptions: agentDefaultOptions.control,
  memory: new Memory({
    storage,
    vector: false,
    options: {
      lastMessages: 20,
      semanticRecall: false,
      workingMemory: {
        enabled: false,
      },
      generateTitle: false,
    },
  }),
  scorers: controlAgentScorerConfig,
  tools: {
    daytonaCheckApi: daytonaTools.checkApi,
    daytonaCreateCodingSandbox: daytonaTools.createCodingSandbox,
    daytonaListSandboxes: daytonaTools.listSandboxes,
    workspaceListFiles: workspaceTools.listFiles,
    workspaceReadFile: workspaceTools.readFile,
    workspaceWriteFile: workspaceTools.writeFile,
    workspaceReplaceInFile: workspaceTools.replaceInFile,
  },
});
