import { createStep, createWorkflow } from "@mastra/core/workflows";

import { daytonaSchemas, daytonaTools } from "../tools/daytona";

const checkApiStep = createStep(daytonaTools.checkApi);
const createCodingSandboxStep = createStep(daytonaTools.createCodingSandbox);
const listSandboxesStep = createStep(daytonaTools.listSandboxes);

const checkDaytonaApiWorkflow = createWorkflow({
  id: "daytona.check-api",
  description: "Check Daytona control-plane API reachability.",
  inputSchema: daytonaSchemas.checkApiQuery,
  outputSchema: daytonaSchemas.checkApiResult,
})
  .then(checkApiStep)
  .commit();

const createDaytonaCodingSandboxWorkflow = createWorkflow({
  id: "daytona.create-coding-sandbox",
  description: "Create a Daytona coding sandbox from the configured snapshot.",
  inputSchema: daytonaSchemas.createCodingSandboxQuery,
  outputSchema: daytonaSchemas.createCodingSandboxResult,
})
  .then(createCodingSandboxStep)
  .commit();

const listDaytonaSandboxesWorkflow = createWorkflow({
  id: "daytona.list-sandboxes",
  description: "List Daytona sandboxes with optional labels and pagination.",
  inputSchema: daytonaSchemas.listSandboxesQuery,
  outputSchema: daytonaSchemas.listSandboxesResult,
})
  .then(listSandboxesStep)
  .commit();

export const daytonaWorkflows = {
  checkApi: checkDaytonaApiWorkflow,
  createCodingSandbox: createDaytonaCodingSandboxWorkflow,
  listSandboxes: listDaytonaSandboxesWorkflow,
};
