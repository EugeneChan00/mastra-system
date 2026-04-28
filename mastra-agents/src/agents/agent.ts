import { Agent } from "@mastra/core/agent";

import { daytonaTools } from "../tools/daytona.js";
import { workspaceTools } from "../tools/workspace.js";
import { advisorAgent } from "./advisor-agent.js";
import { architectAgent } from "./architect-agent.js";
import { controlAgent } from "./control-agent.js";
import { developerAgent } from "./developer-agent.js";
import { supervisorOperatingPrompt } from "./prompts.js";
import { researcherAgent } from "./researcher-agent.js";
import { scoutAgent } from "./scout-agent.js";
import { agentDefaultOptions, createAgentMemory, defaultSupervisorModel } from "./shared.js";
import { validatorAgent } from "./validator-agent.js";

const supervisorPrompt = `${supervisorOperatingPrompt}

# Registered specialist agents

The supervisor may delegate to these native Mastra Agent instances:
- scoutAgent: repository discovery and current-state inspection.
- researcherAgent: documentation, ecosystem, package, and version-sensitive evidence.
- architectAgent: boundaries, interfaces, state ownership, contracts, invariants, and integration design.
- advisorAgent: critique of plans, assumptions, risks, tradeoffs, and scope creep.
- developerAgent: bounded implementation after write boundary and central behavior are explicit.
- validatorAgent: read-only validation of claims, diffs, contracts, tests, and evidence.

# Execution policy

- Use the Mastra workspace as the normal coding environment.
- Prefer workspaceListFiles and workspaceReadFile before deciding on edits.
- Prefer workspaceWriteFile or workspaceReplaceInFile for file changes when project-file mutation is required.
- Use daytonaCheckApi and daytonaListSandboxes for control-plane diagnostics.
- Use daytonaCreateCodingSandbox only for explicit sandbox lifecycle tasks or recovery, not as the default response to a coding request.
- Preserve unrelated worktree changes; never revert user work unless explicitly instructed.

# Final answer guidance

When useful, structure the final response with status, summary, facts, assumptions, findings, files changed, commands run, verification, risks, and next actions. Keep the user looped in without flooding them.`;

export const supervisorAgent = new Agent({
  id: "supervisor-agent",
  name: "Mastra System Supervisor",
  description: "Streaming supervisor agent that delegates to specialist Mastra agents for coding work.",
  instructions: supervisorPrompt,
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
    daytonaCheckApi: daytonaTools.checkApi,
    daytonaCreateCodingSandbox: daytonaTools.createCodingSandbox,
    daytonaListSandboxes: daytonaTools.listSandboxes,
    workspaceListFiles: workspaceTools.listFiles,
    workspaceReadFile: workspaceTools.readFile,
    workspaceWriteFile: workspaceTools.writeFile,
    workspaceReplaceInFile: workspaceTools.replaceInFile,
  },
});

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
