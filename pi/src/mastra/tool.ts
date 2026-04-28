import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import {
	DEFAULT_MODEL_CONTENT_LIMIT,
	MASTRA_AGENT_CALL_TOOL_NAME,
	MASTRA_AGENT_INSPECT_TOOL_NAME,
	MASTRA_AGENT_LIST_TOOL_NAME,
	MASTRA_AGENT_STATUS_TOOL_NAME,
	MASTRA_WORKFLOW_CALL_TOOL_NAME,
	MASTRA_WORKFLOW_LIST_TOOL_NAME,
	MASTRA_WORKFLOW_STATUS_TOOL_NAME,
	REQUEST_CONTEXT_MODE_ID_KEY,
} from "../const.js";
import { MastraHttpClient } from "./client.js";
import { defaultResourceId, defaultThreadId } from "./memory.js";
import { applyNormalizedEvent, normalizeMastraChunk, truncateText } from "./normalize.js";
import type {
	MastraAgentCallDetails,
	MastraAgentCallInput,
	MastraAgentInfo,
	MastraAgentInspectDetails,
	MastraAgentInspectInput,
	MastraAgentInspection,
	MastraAgentStatusInput,
	MastraAgentToolSchema,
	MastraStreamRequest,
	MastraWorkflowCallDetails,
	MastraWorkflowCallInput,
	MastraWorkflowInfo,
	MastraWorkflowRun,
	MastraWorkflowStatusInput,
	MastraWorkflowStreamRequest,
} from "./types.js";

export const MASTRA_AGENT_CALL_PARAMETERS = Type.Object({
	agentId: Type.String({ description: "Mastra agent id to call" }),
	message: Type.String({ description: "User message to send to the Mastra agent" }),
	modeId: Type.Optional(Type.String({ description: "Agent harness mode id, forwarded as requestContext.modeId" })),
	threadId: Type.Optional(Type.String({ description: "Mastra memory thread id" })),
	resourceId: Type.Optional(Type.String({ description: "Mastra memory resource id" })),
	maxSteps: Type.Optional(Type.Number({ description: "Maximum Mastra agent steps" })),
	activeTools: Type.Optional(Type.Array(Type.String(), { description: "Mastra active tool allow-list" })),
	requestContext: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Request-scoped context for Mastra" })),
	includeToolResults: Type.Optional(Type.Boolean({ description: "Include tool result summaries in model-facing text" })),
	includeReasoning: Type.Optional(Type.Boolean({ description: "Include reasoning deltas in model-facing text" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Stream timeout in milliseconds" })),
});

export const MASTRA_AGENT_STATUS_PARAMETERS = Type.Object({
	agentId: Type.String({ description: "Mastra agent id to inspect" }),
});

export const MASTRA_AGENT_INSPECT_PARAMETERS = Type.Object({
	agentId: Type.Optional(Type.String({ description: "Single Mastra agent id to inspect" })),
	agentIds: Type.Optional(Type.Array(Type.String(), { description: "Mastra agent ids to inspect" })),
	agents: Type.Optional(Type.String({ description: "Comma-separated Mastra agent ids to inspect" })),
	includeInstructions: Type.Optional(Type.Boolean({ description: "Include full agent instructions/system prompt. Defaults to false." })),
});

export const MASTRA_WORKFLOW_CALL_PARAMETERS = Type.Object({
	workflowId: Type.String({ description: "Mastra workflow id to run" }),
	runId: Type.String({ description: "Workflow run id to create/use for streaming" }),
	inputData: Type.Optional(Type.Any({ description: "Workflow inputData payload" })),
	initialState: Type.Optional(Type.Any({ description: "Workflow initialState payload" })),
	resourceId: Type.Optional(Type.String({ description: "Mastra workflow resource id" })),
	requestContext: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Request-scoped context for Mastra" })),
	perStep: Type.Optional(Type.Boolean({ description: "Stream workflow output per step when supported" })),
	closeOnSuspend: Type.Optional(Type.Boolean({ description: "Close stream when the workflow suspends" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Stream timeout in milliseconds" })),
});

export const MASTRA_WORKFLOW_STATUS_PARAMETERS = Type.Object({
	workflowId: Type.String({ description: "Mastra workflow id" }),
	runId: Type.String({ description: "Mastra workflow run id" }),
	fields: Type.Optional(Type.Array(Type.String(), { description: "Optional workflow run fields to request" })),
	withNestedWorkflows: Type.Optional(Type.Boolean({ description: "Include nested workflow data in steps" })),
});

export function createMastraTools(client = new MastraHttpClient()) {
	return [
		createMastraAgentTool(client),
		createMastraAgentListTool(client),
		createMastraAgentInspectTool(client),
		createMastraAgentStatusTool(client),
		createMastraWorkflowCallTool(client),
		createMastraWorkflowListTool(client),
		createMastraWorkflowStatusTool(client),
	];
}

export function createMastraAgentTool(client = new MastraHttpClient()) {
	return {
		name: MASTRA_AGENT_CALL_TOOL_NAME,
		label: "Mastra Agent",
		description: "Call a Mastra agent through the HTTP streaming API and return streamed text plus structured run details.",
		promptSnippet: "Call a Mastra agent by id when specialist Mastra execution is needed.",
		promptGuidelines: [
			"Use mastra_agent_call when the user asks to route work through a Mastra agent or specialist agent harness.",
		],
		parameters: MASTRA_AGENT_CALL_PARAMETERS,
		async execute(
			_toolCallId: string,
			params: MastraAgentCallInput,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<MastraAgentCallDetails>,
		): Promise<AgentToolResult<MastraAgentCallDetails>> {
			const details = createInitialDetails(params);
			const request = createStreamRequest(params, details.threadId, details.resourceId);

			onUpdate?.(makeToolResult(details, params));

			try {
				for await (const chunk of client.streamAgent(params.agentId, request, { signal, timeoutMs: params.timeoutMs })) {
					applyNormalizedEvent(details, normalizeMastraChunk(chunk));
					onUpdate?.(makeToolResult(details, params));
				}

				if (details.status === "running") details.status = "done";
				return makeToolResult(details, params);
			} catch (error) {
				details.status = signal?.aborted ? "aborted" : "error";
				details.errors.push(error instanceof Error ? error.message : String(error));
				return makeToolResult(details, params);
			}
		},
		renderCall(args: MastraAgentCallInput, theme: any) {
			const mode = args.modeId ? theme.fg("dim", ` mode=${args.modeId}`) : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("mastra "))}${theme.fg("accent", args.agentId)}${mode}`, 0, 0);
		},
		renderResult(result: AgentToolResult<MastraAgentCallDetails>, options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			const details = result.details;
			const status = options.isPartial ? "running" : details.status;
			const toolCount = details.toolCalls.length + details.toolResults.length;
			let text = `${theme.fg(status === "error" ? "error" : "success", status)} ${theme.fg("dim", `${toolCount} tool events`)}`;
			if (details.chunksTruncated) text += theme.fg("warning", " truncated");
			if (details.text) text += `\n${theme.fg("muted", tail(details.text, options.expanded ? 2000 : 500))}`;
			if (details.errors.length > 0) text += `\n${theme.fg("error", details.errors.join("; "))}`;
			return new Text(text, 0, 0);
		},
	};
}

export function createMastraAgentInspectTool(client = new MastraHttpClient()) {
	return {
		name: MASTRA_AGENT_INSPECT_TOOL_NAME,
		label: "Mastra Agent Inspect",
		description: "Inspect one or more Mastra agents and return instructions, available tools, and modes metadata.",
		promptSnippet: "Inspect Mastra agent instructions, tool schemas, and modes by agent id.",
		promptGuidelines: [
			"Use mastra_agent_inspect when the user asks for Mastra agent instructions, available tools, modes, or deeper agent capabilities.",
		],
		parameters: MASTRA_AGENT_INSPECT_PARAMETERS,
		async execute(_toolCallId: string, params: MastraAgentInspectInput, signal?: AbortSignal): Promise<AgentToolResult<MastraAgentInspectDetails>> {
			const agentIds = normalizeInspectAgentIds(params);
			if (agentIds.length === 0) {
				return {
					content: [{ type: "text", text: "Error: provide agentId, agentIds, or comma-separated agents" }],
					details: { agents: [], count: 0, errors: [{ agentId: "", error: "No agent ids provided" }] },
				};
			}

			const inspections: MastraAgentInspection[] = [];
			const errors: MastraAgentInspectDetails["errors"] = [];
			for (const agentId of agentIds) {
				try {
					const agent = await client.getAgent(agentId, signal);
					inspections.push(inspectAgent(agentId, agent, params.includeInstructions === true));
				} catch (error) {
					errors.push({ agentId, error: error instanceof Error ? error.message : String(error) });
				}
			}

			const details = { agents: inspections, count: inspections.length, errors };
			return {
				content: [{ type: "text", text: truncateText(formatAgentInspectResult(details), DEFAULT_MODEL_CONTENT_LIMIT).text }],
				details,
			};
		},
		renderCall(args: MastraAgentInspectInput, theme: any) {
			const ids = normalizeInspectAgentIds(args).join(",") || "agents";
			return new Text(`${theme.fg("toolTitle", theme.bold("mastra inspect "))}${theme.fg("accent", ids)}`, 0, 0);
		},
		renderResult(result: AgentToolResult<MastraAgentInspectDetails>, options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			const errors = result.details.errors.length;
			const status = errors > 0 && result.details.count === 0 ? "error" : "success";
			let text = `${theme.fg(status, `${result.details.count} inspected`)} ${theme.fg("dim", `${errors} errors`)}`;
			text += `\n${theme.fg("muted", tail(textContent(result), options.expanded ? 2000 : 500))}`;
			return new Text(text, 0, 0);
		},
	};
}

export function createMastraAgentListTool(client = new MastraHttpClient()) {
	return {
		name: MASTRA_AGENT_LIST_TOOL_NAME,
		label: "Mastra Agents",
		description: "List available Mastra agents through the HTTP API.",
		promptSnippet: "List available Mastra agents before choosing an agent id.",
		promptGuidelines: ["Use mastra_agent_list when the user asks what Mastra agents are available or an agent id is unknown."],
		parameters: Type.Object({}),
		async execute(_toolCallId: string, _params: Record<string, never>, signal?: AbortSignal): Promise<AgentToolResult<Record<string, unknown>>> {
			try {
				const agents = await client.listAgents(signal);
				const lines = Object.entries(agents).map(([id, agent]) => `${id}${agent.name ? ` - ${agent.name}` : ""}`);
				return {
					content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No Mastra agents found" }],
					details: { agents, count: lines.length },
				};
			} catch (error) {
				return errorResult(error, { count: 0 });
			}
		},
		renderCall(_args: Record<string, never>, theme: any) {
			return new Text(`${theme.fg("toolTitle", theme.bold("mastra agents"))}`, 0, 0);
		},
		renderResult(result: AgentToolResult<Record<string, unknown>>, _options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			const error = result.details?.error;
			const count = typeof result.details?.count === "number" ? result.details.count : 0;
			return new Text(error ? theme.fg("error", String(error)) : `${theme.fg("success", `${count} agents`)}\n${textContent(result)}`, 0, 0);
		},
	};
}

export function createMastraAgentStatusTool(client = new MastraHttpClient()) {
	return {
		name: MASTRA_AGENT_STATUS_TOOL_NAME,
		label: "Mastra Agent Status",
		description: "Fetch status and metadata for one Mastra agent.",
		promptSnippet: "Inspect one Mastra agent's metadata and availability.",
		promptGuidelines: ["Use mastra_agent_status when the user asks whether a Mastra agent exists or needs agent metadata."],
		parameters: MASTRA_AGENT_STATUS_PARAMETERS,
		async execute(_toolCallId: string, params: MastraAgentStatusInput, signal?: AbortSignal): Promise<AgentToolResult<Record<string, unknown>>> {
			try {
				const agent = await client.getAgent(params.agentId, signal);
				return {
					content: [{ type: "text", text: formatAgentSummary(params.agentId, agent) }],
					details: { agentId: params.agentId, agent, status: "ok" },
				};
			} catch (error) {
				return errorResult(error, { agentId: params.agentId, status: "error" });
			}
		},
		renderCall(args: MastraAgentStatusInput, theme: any) {
			return new Text(`${theme.fg("toolTitle", theme.bold("mastra agent "))}${theme.fg("accent", args.agentId)}`, 0, 0);
		},
		renderResult(result: AgentToolResult<Record<string, unknown>>, _options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			const status = result.details?.status === "error" ? "error" : "success";
			return new Text(`${theme.fg(status, String(result.details?.status ?? "ok"))}\n${textContent(result)}`, 0, 0);
		},
	};
}

export function createMastraWorkflowListTool(client = new MastraHttpClient()) {
	return {
		name: MASTRA_WORKFLOW_LIST_TOOL_NAME,
		label: "Mastra Workflows",
		description: "List available Mastra workflows through the HTTP API.",
		promptSnippet: "List available Mastra workflows before choosing a workflow id.",
		promptGuidelines: ["Use mastra_workflow_list when the user asks what Mastra workflows are available or a workflow id is unknown."],
		parameters: Type.Object({}),
		async execute(_toolCallId: string, _params: Record<string, never>, signal?: AbortSignal): Promise<AgentToolResult<Record<string, unknown>>> {
			try {
				const workflows = await client.listWorkflows(signal);
				const lines = Object.entries(workflows).map(([id, workflow]) => formatWorkflowSummary(id, workflow));
				return {
					content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No Mastra workflows found" }],
					details: { workflows, count: lines.length },
				};
			} catch (error) {
				return errorResult(error, { count: 0 });
			}
		},
		renderCall(_args: Record<string, never>, theme: any) {
			return new Text(`${theme.fg("toolTitle", theme.bold("mastra workflows"))}`, 0, 0);
		},
		renderResult(result: AgentToolResult<Record<string, unknown>>, _options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			const error = result.details?.error;
			const count = typeof result.details?.count === "number" ? result.details.count : 0;
			return new Text(error ? theme.fg("error", String(error)) : `${theme.fg("success", `${count} workflows`)}\n${textContent(result)}`, 0, 0);
		},
	};
}

export function createMastraWorkflowCallTool(client = new MastraHttpClient()) {
	return {
		name: MASTRA_WORKFLOW_CALL_TOOL_NAME,
		label: "Mastra Workflow",
		description: "Run a Mastra workflow through the HTTP streaming API and return streamed run details.",
		promptSnippet: "Run a Mastra workflow by workflow id and run id.",
		promptGuidelines: ["Use mastra_workflow_call when the user asks to execute a Mastra workflow and provides or accepts a run id."],
		parameters: MASTRA_WORKFLOW_CALL_PARAMETERS,
		async execute(
			_toolCallId: string,
			params: MastraWorkflowCallInput,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<MastraWorkflowCallDetails>,
		): Promise<AgentToolResult<MastraWorkflowCallDetails>> {
			const details = createWorkflowDetails(params);
			const request = createWorkflowStreamRequest(params);
			onUpdate?.(makeWorkflowCallResult(details));

			try {
				for await (const chunk of client.streamWorkflow(params.workflowId, params.runId, request, { signal, timeoutMs: params.timeoutMs })) {
					applyWorkflowChunk(details, chunk);
					onUpdate?.(makeWorkflowCallResult(details));
				}
				if (details.status === "running") details.status = "done";
				return makeWorkflowCallResult(details);
			} catch (error) {
				details.status = signal?.aborted ? "aborted" : "error";
				details.errors.push(error instanceof Error ? error.message : String(error));
				return makeWorkflowCallResult(details);
			}
		},
		renderCall(args: MastraWorkflowCallInput, theme: any) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("mastra workflow "))}${theme.fg("accent", args.workflowId)}${theme.fg("dim", ` run=${args.runId}`)}`,
				0,
				0,
			);
		},
		renderResult(result: AgentToolResult<MastraWorkflowCallDetails>, options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			const details = result.details;
			const status = options.isPartial ? "running" : details.status;
			let text = `${theme.fg(status === "error" ? "error" : "success", status)} ${theme.fg("dim", `${details.rawChunkCount} events`)}`;
			if (details.workflowStatus) text += theme.fg("dim", ` workflow=${details.workflowStatus}`);
			if (details.chunksTruncated) text += theme.fg("warning", " truncated");
			if (details.errors.length > 0) text += `\n${theme.fg("error", details.errors.join("; "))}`;
			if (details.finalEvent) text += `\n${theme.fg("muted", tail(safeJson(details.finalEvent), options.expanded ? 2000 : 500))}`;
			return new Text(text, 0, 0);
		},
	};
}

export function createMastraWorkflowStatusTool(client = new MastraHttpClient()) {
	return {
		name: MASTRA_WORKFLOW_STATUS_TOOL_NAME,
		label: "Mastra Workflow Status",
		description: "Fetch status and result metadata for one Mastra workflow run.",
		promptSnippet: "Check the status of a Mastra workflow run.",
		promptGuidelines: ["Use mastra_workflow_status when the user asks about a workflow run's status or result."],
		parameters: MASTRA_WORKFLOW_STATUS_PARAMETERS,
		async execute(_toolCallId: string, params: MastraWorkflowStatusInput, signal?: AbortSignal): Promise<AgentToolResult<Record<string, unknown>>> {
			try {
				const run = await client.getWorkflowRun(params.workflowId, params.runId, {
					fields: params.fields,
					withNestedWorkflows: params.withNestedWorkflows,
					signal,
				});
				const text = formatWorkflowRun(run);
				return {
					content: [{ type: "text", text: truncateText(text, DEFAULT_MODEL_CONTENT_LIMIT).text }],
					details: { workflowId: params.workflowId, runId: params.runId, run, status: run.status },
				};
			} catch (error) {
				return errorResult(error, { workflowId: params.workflowId, runId: params.runId, status: "error" });
			}
		},
		renderCall(args: MastraWorkflowStatusInput, theme: any) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("mastra run "))}${theme.fg("accent", args.workflowId)}${theme.fg("dim", ` run=${args.runId}`)}`,
				0,
				0,
			);
		},
		renderResult(result: AgentToolResult<Record<string, unknown>>, options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			const status = String(result.details?.status ?? "unknown");
			const color = status === "error" || status === "failed" ? "error" : "success";
			return new Text(`${theme.fg(color, status)}\n${tail(textContent(result), options.expanded ? 2000 : 500)}`, 0, 0);
		},
	};
}

export function normalizeInspectAgentIds(params: MastraAgentInspectInput): string[] {
	const values = [
		params.agentId,
		...(params.agentIds ?? []),
		...(params.agents?.split(",") ?? []),
	];
	return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

export function createStreamRequest(params: MastraAgentCallInput, threadId: string, resourceId: string): MastraStreamRequest {
	const requestContext = { ...(params.requestContext ?? {}) };
	if (params.modeId) requestContext[REQUEST_CONTEXT_MODE_ID_KEY] = params.modeId;

	return {
		messages: [{ role: "user", content: params.message }],
		memory: {
			thread: threadId,
			resource: resourceId,
		},
		maxSteps: params.maxSteps,
		activeTools: params.activeTools,
		requestContext: Object.keys(requestContext).length > 0 ? requestContext : undefined,
	};
}

export function createWorkflowStreamRequest(params: MastraWorkflowCallInput): MastraWorkflowStreamRequest {
	return {
		inputData: params.inputData,
		initialState: params.initialState,
		resourceId: params.resourceId,
		requestContext: params.requestContext,
		perStep: params.perStep,
		closeOnSuspend: params.closeOnSuspend,
	};
}

function createInitialDetails(params: MastraAgentCallInput): MastraAgentCallDetails {
	const resourceId = params.resourceId ?? defaultResourceId();
	return {
		agentId: params.agentId,
		modeId: params.modeId,
		threadId: params.threadId ?? defaultThreadId(params.agentId),
		resourceId,
		status: "running",
		text: "",
		toolCalls: [],
		toolResults: [],
		chunksTruncated: false,
		errors: [],
		rawChunkCount: 0,
	};
}

function createWorkflowDetails(params: MastraWorkflowCallInput): MastraWorkflowCallDetails {
	return {
		workflowId: params.workflowId,
		runId: params.runId,
		resourceId: params.resourceId,
		status: "running",
		events: [],
		rawChunkCount: 0,
		chunksTruncated: false,
		errors: [],
	};
}

function applyWorkflowChunk(details: MastraWorkflowCallDetails, chunk: unknown): void {
	details.rawChunkCount += 1;
	details.finalEvent = chunk;
	pushBounded(details.events, chunk, 100);

	if (!isRecord(chunk)) return;
	const status = typeof chunk.status === "string" ? chunk.status : undefined;
	if (status) details.workflowStatus = status;
	if ("result" in chunk) details.result = chunk.result;
	if ("error" in chunk && chunk.error) {
		details.error = chunk.error;
		if (typeof chunk.error === "string") details.errors.push(chunk.error);
	}
	if (chunk.type === "error") {
		details.status = "error";
		details.errors.push(typeof chunk.message === "string" ? chunk.message : "Mastra workflow stream error");
	}
}

function makeToolResult(
	details: MastraAgentCallDetails,
	params: Pick<MastraAgentCallInput, "includeReasoning" | "includeToolResults">,
): AgentToolResult<MastraAgentCallDetails> {
	const lines = [details.text || "(no text output)"];

	if (params.includeReasoning && details.reasoning) {
		lines.push(`\nReasoning:\n${details.reasoning}`);
	}
	if (params.includeToolResults && details.toolResults.length > 0) {
		lines.push(`\nTool results:\n${details.toolResults.map((event) => `${event.name ?? event.id ?? "tool"}: ${safeJson(event.result ?? event.error)}`).join("\n")}`);
	}
	if (details.errors.length > 0) {
		lines.push(`\nErrors:\n${details.errors.join("\n")}`);
	}

	const truncated = truncateText(lines.join("\n"), DEFAULT_MODEL_CONTENT_LIMIT);
	details.chunksTruncated = details.chunksTruncated || truncated.truncated;

	return {
		content: [{ type: "text", text: truncated.text }],
		details,
	};
}

function makeWorkflowCallResult(details: MastraWorkflowCallDetails): AgentToolResult<MastraWorkflowCallDetails> {
	const lines = [
		`workflowId: ${details.workflowId}`,
		`runId: ${details.runId}`,
		`status: ${details.workflowStatus ?? details.status}`,
		`events: ${details.rawChunkCount}`,
	];
	if (details.result !== undefined) lines.push(`result: ${safeJson(details.result)}`);
	if (details.error !== undefined) lines.push(`error: ${safeJson(details.error)}`);
	if (details.errors.length > 0) lines.push(`errors:\n${details.errors.join("\n")}`);

	const truncated = truncateText(lines.join("\n"), DEFAULT_MODEL_CONTENT_LIMIT);
	details.chunksTruncated = details.chunksTruncated || truncated.truncated;
	return {
		content: [{ type: "text", text: truncated.text }],
		details,
	};
}

function errorResult<T extends Record<string, unknown>>(error: unknown, details: T): AgentToolResult<T & { error: string }> {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [{ type: "text", text: `Error: ${message}` }],
		details: { ...details, error: message },
	};
}

function inspectAgent(id: string, agent: MastraAgentInfo, includeInstructions: boolean): MastraAgentInspection {
	const modes = readModes(agent);
	return {
		id,
		name: typeof agent.name === "string" ? agent.name : undefined,
		description: typeof agent.description === "string" ? agent.description : undefined,
		instructions: includeInstructions && typeof agent.instructions === "string" ? agent.instructions : undefined,
		tools: readToolSchemas(agent.tools),
		modes,
		modesSource: modes.length > 0 ? "agent" : "not_exposed",
		workspace: agent.workspace,
		workspaceId: typeof agent.workspaceId === "string" ? agent.workspaceId : undefined,
		workspaceTools: agent.workspaceTools,
		memory: agent.memory,
		raw: includeInstructions ? agent : omitRecordKeys(agent, ["instructions"]),
	};
}

function readToolSchemas(value: unknown): MastraAgentToolSchema[] {
	if (Array.isArray(value)) {
		return value.map((tool, index) => normalizeToolSchema(String(index), tool));
	}
	if (isRecord(value)) {
		return Object.entries(value).map(([id, tool]) => normalizeToolSchema(id, tool));
	}
	return [];
}

function normalizeToolSchema(id: string, tool: unknown): MastraAgentToolSchema {
	if (!isRecord(tool)) {
		return { id, raw: tool };
	}
	return {
		id: typeof tool.id === "string" ? tool.id : id,
		name: typeof tool.name === "string" ? tool.name : id,
		description: typeof tool.description === "string" ? tool.description : undefined,
		inputSchema: tool.inputSchema,
		outputSchema: tool.outputSchema,
		parameters: tool.parameters,
		raw: tool,
	};
}

function readModes(agent: MastraAgentInfo): unknown[] {
	for (const key of ["modes", "availableModes", "modeIds"]) {
		const value = agent[key];
		if (Array.isArray(value)) return value;
	}
	const mode = agent.mode;
	return mode === undefined ? [] : [mode];
}

function formatAgentInspectResult(details: MastraAgentInspectDetails): string {
	return safeJson({
		agents: details.agents.map((agent) => ({
			id: agent.id,
			name: agent.name,
			description: agent.description,
			instructions: agent.instructions,
			tools: agent.tools.map((tool) => ({
				id: tool.id,
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
				outputSchema: tool.outputSchema,
				parameters: tool.parameters,
			})),
			modes: agent.modes,
			modesSource: agent.modesSource,
			workspace: agent.workspace,
			workspaceId: agent.workspaceId,
			workspaceTools: agent.workspaceTools,
			memory: agent.memory,
		})),
		errors: details.errors,
	});
}

function omitRecordKeys<T extends Record<string, unknown>>(record: T, keys: string[]): T {
	const copy = { ...record };
	for (const key of keys) delete copy[key];
	return copy;
}

function formatAgentSummary(id: string, agent: Record<string, unknown>): string {
	const name = typeof agent.name === "string" ? agent.name : undefined;
	const description = typeof agent.description === "string" ? agent.description : undefined;
	return [`id: ${id}`, name ? `name: ${name}` : undefined, description ? `description: ${description}` : undefined]
		.filter(Boolean)
		.join("\n");
}

function formatWorkflowSummary(id: string, workflow: MastraWorkflowInfo): string {
	const label = workflow.name ? `${id} - ${workflow.name}` : id;
	const stepCount = workflow.steps ? Object.keys(workflow.steps).length : undefined;
	return stepCount === undefined ? label : `${label} (${stepCount} steps)`;
}

function formatWorkflowRun(run: MastraWorkflowRun): string {
	const lines = [
		`workflowName: ${run.workflowName}`,
		`runId: ${run.runId}`,
		`status: ${run.status}`,
		run.resourceId ? `resourceId: ${run.resourceId}` : undefined,
		run.result !== undefined ? `result: ${safeJson(run.result)}` : undefined,
		run.error !== undefined ? `error: ${safeJson(run.error)}` : undefined,
		run.steps ? `steps: ${Object.keys(run.steps).length}` : undefined,
	];
	return lines.filter(Boolean).join("\n");
}

function safeJson(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function tail(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}

function textContent(result: AgentToolResult<unknown>): string {
	return result.content.map((item) => ("text" in item ? item.text : "")).join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushBounded<T>(array: T[], value: T, limit: number): void {
	array.push(value);
	if (array.length > limit) array.splice(0, array.length - limit);
}
