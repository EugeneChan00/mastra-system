export const MASTRA_API_PREFIX = "/api";
export const DEFAULT_MASTRA_BASE_URL = `http://localhost:4111${MASTRA_API_PREFIX}`;
export const MASTRA_BASE_URL_ENV = "MASTRA_BASE_URL";

export const MASTRA_AGENT_CALL_TOOL_NAME = "mastra_agent_call";
export const MASTRA_STATUS_KEY = "mastra";

export const DEFAULT_STREAM_TIMEOUT_MS = 120_000;
export const DEFAULT_MODEL_CONTENT_LIMIT = 12_000;
export const DEFAULT_DETAILS_TEXT_LIMIT = 120_000;
export const DEFAULT_TOOL_EVENT_LIMIT = 100;

export const PI_RESOURCE_PREFIX = "pi";
export const PI_THREAD_PREFIX = "pi";
export const REQUEST_CONTEXT_MODE_ID_KEY = "modeId";

export function agentsPath(): string {
	return "/agents";
}

export function agentPath(agentId: string): string {
	return `/agents/${encodeURIComponent(agentId)}`;
}

export function agentStreamPath(agentId: string): string {
	return `${agentPath(agentId)}/stream`;
}

