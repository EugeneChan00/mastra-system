import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import {
	DEFAULT_MODEL_CONTENT_LIMIT,
	MASTRA_AGENT_CALL_TOOL_NAME,
	REQUEST_CONTEXT_MODE_ID_KEY,
} from "../const.js";
import { MastraHttpClient } from "./client.js";
import { defaultResourceId, defaultThreadId } from "./memory.js";
import { applyNormalizedEvent, normalizeMastraChunk, truncateText } from "./normalize.js";
import type { MastraAgentCallDetails, MastraAgentCallInput, MastraStreamRequest } from "./types.js";

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

