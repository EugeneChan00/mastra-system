export const MASTRA_API_PREFIX = "/api";
export const DEFAULT_MASTRA_BASE_URL = `http://localhost:4111${MASTRA_API_PREFIX}`;
export const MASTRA_BASE_URL_ENV = "MASTRA_BASE_URL";

export const MASTRA_AGENT_CALL_TOOL_NAME = "mastra_agent_call";
export const MASTRA_AGENT_INSPECT_TOOL_NAME = "mastra_agent_inspect";
export const MASTRA_AGENT_LIST_TOOL_NAME = "mastra_agent_list";
export const MASTRA_AGENT_STATUS_TOOL_NAME = "mastra_agent_status";
export const MASTRA_WORKFLOW_CALL_TOOL_NAME = "mastra_workflow_call";
export const MASTRA_WORKFLOW_LIST_TOOL_NAME = "mastra_workflow_list";
export const MASTRA_WORKFLOW_STATUS_TOOL_NAME = "mastra_workflow_status";
export const MASTRA_STATUS_KEY = "mastra";

export const DEFAULT_STREAM_TIMEOUT_MS = 120_000;
export const DEFAULT_MODEL_CONTENT_LIMIT = 12_000;
export const DEFAULT_DETAILS_TEXT_LIMIT = 120_000;
export const DEFAULT_TOOL_EVENT_LIMIT = 100;

export const PI_RESOURCE_PREFIX = "pi";
export const PI_THREAD_PREFIX = "pi";
export const REQUEST_CONTEXT_MODE_ID_KEY = "modeId";

export function agentsPath(options: { partial?: boolean } = {}): string {
	return options.partial ? "/agents?partial=true" : "/agents";
}

export function agentPath(agentId: string): string {
	return `/agents/${encodeURIComponent(agentId)}`;
}

export function agentStreamPath(agentId: string): string {
	return `${agentPath(agentId)}/stream`;
}

export function workflowsPath(options: { partial?: boolean } = {}): string {
	return options.partial ? "/workflows?partial=true" : "/workflows";
}

export function workflowPath(workflowId: string): string {
	return `/workflows/${encodeURIComponent(workflowId)}`;
}

export function workflowStreamPath(workflowId: string, runId: string): string {
	return `${workflowPath(workflowId)}/stream?runId=${encodeURIComponent(runId)}`;
}

export function workflowRunPath(
	workflowId: string,
	runId: string,
	options: { fields?: string | string[]; withNestedWorkflows?: boolean } = {},
): string {
	const params = new URLSearchParams();
	if (options.fields) {
		params.set("fields", Array.isArray(options.fields) ? options.fields.join(",") : options.fields);
	}
	if (typeof options.withNestedWorkflows === "boolean") {
		params.set("withNestedWorkflows", String(options.withNestedWorkflows));
	}
	const query = params.toString();
	return `${workflowPath(workflowId)}/runs/${encodeURIComponent(runId)}${query ? `?${query}` : ""}`;
}
