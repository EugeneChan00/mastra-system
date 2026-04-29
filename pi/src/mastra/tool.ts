import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Text } from "@mariozechner/pi-tui";
import type { MastraAgentActivitySink } from "../tui/index.js";
import { Type } from "typebox";
import {
	DEFAULT_MODEL_CONTENT_LIMIT,
	MASTRA_AGENT_ASYNC_STATUS_TOOL_NAME,
	MASTRA_AGENT_CALL_TOOL_NAME,
	MASTRA_AGENT_CANCEL_TOOL_NAME,
	MASTRA_AGENT_INSPECT_TOOL_NAME,
	MASTRA_AGENT_LIST_TOOL_NAME,
	MASTRA_AGENT_READ_TOOL_NAME,
	MASTRA_AGENT_START_TOOL_NAME,
	MASTRA_AGENT_STATUS_TOOL_NAME,
	MASTRA_WORKFLOW_CALL_TOOL_NAME,
	MASTRA_WORKFLOW_LIST_TOOL_NAME,
	MASTRA_WORKFLOW_STATUS_TOOL_NAME,
	REQUEST_CONTEXT_MODE_ID_KEY,
} from "../const.js";
import { MastraAgentCard } from "../tui/index.js";
import { MastraHttpClient } from "./client.js";
import { defaultResourceId, defaultThreadId } from "./memory.js";
import { applyNormalizedEvent, normalizeMastraChunk, truncateText } from "./normalize.js";
import type {
	MastraAgentAsyncJobSummary,
	MastraAgentAsyncStatusInput,
	MastraAgentCallDetails,
	MastraAgentCallInput,
	MastraAgentCancelInput,
	MastraAgentInfo,
	MastraAgentInspectDetails,
	MastraAgentInspectInput,
	MastraAgentInspection,
	MastraAgentReadInput,
	MastraAgentStartInput,
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

export const MASTRA_AGENT_START_PARAMETERS = Type.Object({
	agentId: Type.String({ description: "Mastra agent id to call asynchronously" }),
	message: Type.String({ description: "User message to send to the Mastra agent" }),
	modeId: Type.Optional(Type.String({ description: "Agent harness mode id, forwarded as requestContext.modeId" })),
	threadId: Type.Optional(Type.String({ description: "Mastra memory thread id" })),
	resourceId: Type.Optional(Type.String({ description: "Mastra memory resource id" })),
	maxSteps: Type.Optional(Type.Number({ description: "Maximum Mastra agent steps" })),
	activeTools: Type.Optional(Type.Array(Type.String(), { description: "Mastra active tool allow-list" })),
	requestContext: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Request-scoped context for Mastra" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Stream timeout in milliseconds" })),
	jobId: Type.Optional(Type.String({ description: "Optional caller-provided async job id" })),
	finalMessage: Type.Optional(Type.Boolean({ description: "Post a custom final transcript message when the async run completes. Defaults to true." })),
});

export const MASTRA_AGENT_ASYNC_STATUS_PARAMETERS = Type.Object({
	jobId: Type.Optional(Type.String({ description: "Async Mastra agent job id. Omit to list recent jobs." })),
});

export const MASTRA_AGENT_READ_PARAMETERS = Type.Object({
	jobId: Type.String({ description: "Async Mastra agent job id" }),
	mode: Type.Optional(Type.String({ description: "Output mode: summary, tail, or full. Defaults to tail." })),
	maxChars: Type.Optional(Type.Number({ description: "Maximum characters to return to the model" })),
});

export const MASTRA_AGENT_CANCEL_PARAMETERS = Type.Object({
	jobId: Type.String({ description: "Async Mastra agent job id to cancel" }),
	reason: Type.Optional(Type.String({ description: "Optional cancellation reason" })),
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

const DEFAULT_ASYNC_AGENT_TIMEOUT_MS = 60 * 60_000;

interface MastraAsyncAgentJob {
	jobId: string;
	params: MastraAgentStartInput;
	details: MastraAgentCallDetails;
	controller: AbortController;
	artifactPath?: string;
	eventsPath?: string;
	finalMessage: boolean;
	suppressCompletionMessage?: boolean;
}

export interface MastraAsyncAgentManagerOptions {
	activitySink?: MastraAgentActivitySink;
	onComplete?: (summary: MastraAgentAsyncJobSummary) => void | Promise<void>;
}

export class MastraAsyncAgentManager {
	private readonly jobs = new Map<string, MastraAsyncAgentJob>();

	constructor(
		private readonly client = new MastraHttpClient(),
		private readonly options: MastraAsyncAgentManagerOptions = {},
	) {}

	async start(params: MastraAgentStartInput): Promise<MastraAgentAsyncJobSummary> {
		const jobId = normalizeJobId(params.jobId);
		if (this.jobs.has(jobId)) throw new Error(`Async Mastra agent job already exists: ${jobId}`);

		// Async jobs for the same agent can run concurrently. If they share the
		// normal per-agent default thread, Mastra's thread-scoped memory and
		// observability can serialize or merge their streams, making TUI cards look
		// like only one job is live. Use the normalized job id to isolate default
		// async runs while still honoring an explicit caller-provided threadId.
		const effectiveParams: MastraAgentStartInput = {
			...params,
			jobId,
			threadId: params.threadId ?? defaultAsyncThreadId(params.agentId, jobId),
		};
		const details = createInitialDetails(effectiveParams);
		const artifactDir = await mkdtemp(join(tmpdir(), `${jobId}-`));
		const job: MastraAsyncAgentJob = {
			jobId,
			params: effectiveParams,
			details,
			controller: new AbortController(),
			artifactPath: join(artifactDir, "output.txt"),
			eventsPath: join(artifactDir, "events.jsonl"),
			finalMessage: effectiveParams.finalMessage !== false,
		};
		this.jobs.set(jobId, job);
		this.options.activitySink?.start(jobId, effectiveParams, details);

		const request = createStreamRequest(effectiveParams, details.threadId, details.resourceId);
		void this.run(job, request);
		return this.summary(job);
	}

	get(jobId: string): MastraAgentAsyncJobSummary | undefined {
		const job = this.jobs.get(jobId);
		return job ? this.summary(job) : undefined;
	}

	list(): MastraAgentAsyncJobSummary[] {
		return Array.from(this.jobs.values())
			.map((job) => this.summary(job))
			.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
	}

	async read(params: MastraAgentReadInput): Promise<{ text: string; summary: MastraAgentAsyncJobSummary }> {
		const job = this.jobs.get(params.jobId);
		if (!job) throw new Error(`Unknown async Mastra agent job: ${params.jobId}`);
		const summary = this.summary(job);
		const maxChars = clampMaxChars(params.maxChars);
		const mode = params.mode ?? "tail";

		if (mode === "summary") {
			return { text: formatAsyncJobSummary(summary), summary };
		}

		const output = await this.readArtifact(job);
		if (mode === "full") {
			const truncated = truncateText(output || job.details.text || "(no text output)", maxChars);
			const artifactNotice = job.artifactPath ? `\n\nFull output artifact: ${job.artifactPath}` : "";
			return { text: `${truncated.text}${truncated.truncated ? artifactNotice : ""}`, summary };
		}

		const text = output || job.details.text || "(no text output)";
		return { text: tailText(text, maxChars), summary };
	}

	cancel(jobId: string, reason = "cancelled"): MastraAgentAsyncJobSummary | undefined {
		const job = this.jobs.get(jobId);
		if (!job) return undefined;
		if (job.details.status === "running") {
			job.details.errors.push(reason);
			job.controller.abort(new Error(reason));
		}
		return this.summary(job);
	}

	cancelAll(reason = "session shutdown", options: { suppressCompletionMessage?: boolean } = {}): void {
		for (const job of this.jobs.values()) {
			job.suppressCompletionMessage = options.suppressCompletionMessage ?? job.suppressCompletionMessage;
			if (job.details.status === "running") {
				job.details.errors.push(reason);
				job.controller.abort(new Error(reason));
			}
		}
	}

	private async run(job: MastraAsyncAgentJob, request: MastraStreamRequest): Promise<void> {
		try {
			const timeoutMs = job.params.timeoutMs ?? DEFAULT_ASYNC_AGENT_TIMEOUT_MS;
			for await (const chunk of this.client.streamAgent(job.params.agentId, request, { signal: job.controller.signal, timeoutMs })) {
				const normalized = normalizeMastraChunk(chunk);
				await this.persistChunk(job, chunk, normalized);
				applyNormalizedEvent(job.details, normalized);
				this.options.activitySink?.update(job.jobId, job.details);
			}

			if (job.details.status === "running") job.details.status = "done";
			job.details.updatedAt = Date.now();
			job.details.completedAt = job.details.completedAt ?? job.details.updatedAt;
		} catch (error) {
			job.details.status = job.controller.signal.aborted ? "aborted" : "error";
			job.details.updatedAt = Date.now();
			job.details.completedAt = job.details.updatedAt;
			const message = error instanceof Error ? error.message : String(error);
			if (!job.details.errors.includes(message)) job.details.errors.push(message);
		} finally {
			this.options.activitySink?.finish(job.jobId, job.details);
			if (job.finalMessage && !job.suppressCompletionMessage) {
				await this.options.onComplete?.(this.summary(job));
			}
		}
	}

	private async persistChunk(job: MastraAsyncAgentJob, chunk: unknown, normalized: ReturnType<typeof normalizeMastraChunk>): Promise<void> {
		if (job.eventsPath) {
			await appendFile(job.eventsPath, `${safeJson({ timestamp: Date.now(), chunk })}\n`, "utf8").catch(() => undefined);
		}
		if (job.artifactPath && normalized.kind === "text-delta" && normalized.text) {
			await appendFile(job.artifactPath, normalized.text, "utf8").catch(() => undefined);
		}
	}

	private async readArtifact(job: MastraAsyncAgentJob): Promise<string> {
		if (!job.artifactPath) return job.details.text;
		try {
			return await readFile(job.artifactPath, "utf8");
		} catch {
			return job.details.text;
		}
	}

	private summary(job: MastraAsyncAgentJob): MastraAgentAsyncJobSummary {
		const details = job.details;
		const completedOrUpdated = details.completedAt ?? details.updatedAt;
		return {
			jobId: job.jobId,
			agentId: details.agentId,
			modeId: details.modeId,
			threadId: details.threadId,
			resourceId: details.resourceId,
			status: details.status,
			startedAt: details.startedAt,
			updatedAt: details.updatedAt,
			completedAt: details.completedAt,
			elapsedMs: details.startedAt && completedOrUpdated ? Math.max(0, completedOrUpdated - details.startedAt) : undefined,
			prompt: details.prompt,
			textPreview: tailText(details.text, 1_000),
			reasoningPreview: details.reasoning ? tailText(details.reasoning, 600) : undefined,
			toolCalls: details.toolCalls.length,
			toolResults: details.toolResults.length,
			usage: details.usage,
			rawChunkCount: details.rawChunkCount,
			chunksTruncated: details.chunksTruncated,
			errors: [...details.errors],
			artifactPath: job.artifactPath,
			eventsPath: job.eventsPath,
		};
	}
}

export interface MastraToolOptions {
	agentActivitySink?: MastraAgentActivitySink;
	asyncAgentManager?: MastraAsyncAgentManager;
	onAsyncAgentComplete?: (summary: MastraAgentAsyncJobSummary) => void | Promise<void>;
}

export function createMastraTools(client = new MastraHttpClient(), options: MastraToolOptions = {}) {
	const asyncAgentManager =
		options.asyncAgentManager ??
		new MastraAsyncAgentManager(client, {
			activitySink: options.agentActivitySink,
			onComplete: options.onAsyncAgentComplete,
		});
	return [
		createMastraAgentTool(client, options.agentActivitySink),
		createMastraAgentStartTool(asyncAgentManager),
		createMastraAgentAsyncStatusTool(asyncAgentManager),
		createMastraAgentReadTool(asyncAgentManager),
		createMastraAgentCancelTool(asyncAgentManager),
		createMastraAgentListTool(client),
		createMastraAgentInspectTool(client),
		createMastraAgentStatusTool(client),
		createMastraWorkflowCallTool(client),
		createMastraWorkflowListTool(client),
		createMastraWorkflowStatusTool(client),
	];
}

export function createMastraAgentTool(client = new MastraHttpClient(), activitySink?: MastraAgentActivitySink) {
	return {
		name: MASTRA_AGENT_CALL_TOOL_NAME,
		label: "Mastra Agent",
		description: "Call a Mastra agent through the HTTP streaming API and return streamed text plus structured run details.",
		promptSnippet: "Call a Mastra agent by id when specialist Mastra execution is needed.",
		promptGuidelines: [
			"Use agent_call when the user asks to route work through a Mastra agent and you need the final output before continuing.",
			"Prefer agent_start for long-running Mastra agent delegation so live progress can stream to the Pi TUI while the parent turn continues.",
		],
		parameters: MASTRA_AGENT_CALL_PARAMETERS,
		async execute(
			toolCallId: string,
			params: MastraAgentCallInput,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<MastraAgentCallDetails>,
		): Promise<AgentToolResult<MastraAgentCallDetails>> {
			const details = createInitialDetails(params);
			const request = createStreamRequest(params, details.threadId, details.resourceId);
			const emitUpdate = () => {
				details.updatedAt = Date.now();
				activitySink?.update(toolCallId, details);
				onUpdate?.(makeToolResult(details, params));
			};

			activitySink?.start(toolCallId, params, details);
			emitUpdate();

			try {
				for await (const chunk of client.streamAgent(params.agentId, request, { signal, timeoutMs: params.timeoutMs })) {
					applyNormalizedEvent(details, normalizeMastraChunk(chunk));
					emitUpdate();
				}

				if (details.status === "running") details.status = "done";
				details.updatedAt = Date.now();
				details.completedAt = details.completedAt ?? details.updatedAt;
				activitySink?.finish(toolCallId, details);
				return makeToolResult(details, params);
			} catch (error) {
				details.status = signal?.aborted ? "aborted" : "error";
				details.updatedAt = Date.now();
				details.completedAt = details.updatedAt;
				details.errors.push(error instanceof Error ? error.message : String(error));
				activitySink?.finish(toolCallId, details);
				return makeToolResult(details, params);
			}
		},
		renderCall(args: MastraAgentCallInput, theme: any) {
			const mode = args.modeId ? theme.fg("dim", ` mode=${args.modeId}`) : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("mastra "))}${theme.fg("accent", args.agentId)}${mode}`, 0, 0);
		},
		renderResult(result: AgentToolResult<MastraAgentCallDetails>, options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			return new MastraAgentCard(result.details, options, theme);
		},
	};
}

export function createMastraAgentStartTool(manager: MastraAsyncAgentManager) {
	return {
		name: MASTRA_AGENT_START_TOOL_NAME,
		label: "Mastra Agent Start",
		description: "Start a Mastra agent call asynchronously. Returns a job id immediately while live output streams to the Pi TUI widget; after completion, read the job output by default unless the initial user prompt explicitly opted out.",
		promptSnippet: "Start a Mastra agent in the background, stream progress to the Pi TUI, and read completed output by default.",
		promptGuidelines: [
			"Use agent_start for long-running Mastra agent delegation when live TUI progress is useful and the final answer can be fetched later.",
			"After agent_start returns a jobId, use agent_async_status to check progress and agent_read to retrieve output without rerunning the agent.",
			"When an async job completes, call agent_read before finalizing so you can incorporate the output, unless the user's initial prompt explicitly opted out with wording like \"pass the output\" or \"don't read the output\".",
		],
		parameters: MASTRA_AGENT_START_PARAMETERS,
		// The async starter returns a model-visible receipt, but live progress is
		// rendered by MastraAgentsWidget. Self-rendering an empty component prevents
		// a duplicate static `mastra async` card from competing with the live card.
		renderShell: "self" as const,
		async execute(_toolCallId: string, params: MastraAgentStartInput, signal?: AbortSignal): Promise<AgentToolResult<Record<string, unknown>>> {
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Async Mastra agent start was aborted before launch." }],
					details: {
						jobId: params.jobId ?? "",
						agentId: params.agentId,
						modeId: params.modeId,
						threadId: params.threadId ?? defaultThreadId(params.agentId),
						resourceId: params.resourceId ?? defaultResourceId(),
						status: "aborted",
						prompt: params.message,
						textPreview: "",
						toolCalls: 0,
						toolResults: 0,
						rawChunkCount: 0,
						chunksTruncated: false,
						errors: ["aborted before launch"],
					} as Record<string, unknown>,
				};
			}

			try {
				const summary = await manager.start(params);
				return {
					content: [{ type: "text", text: formatAsyncStartResult(summary) }],
					details: summary as unknown as Record<string, unknown>,
				};
			} catch (error) {
				return errorResult(error, { jobId: params.jobId ?? "", agentId: params.agentId, status: "error" });
			}
		},
		renderCall() {
			return emptyComponent();
		},
		renderResult() {
			return emptyComponent();
		},
	};
}

export function createMastraAgentAsyncStatusTool(manager: MastraAsyncAgentManager) {
	return {
		name: MASTRA_AGENT_ASYNC_STATUS_TOOL_NAME,
		label: "Mastra Agent Async Status",
		description: "Fetch status for an async Mastra agent job, or list recent async jobs when jobId is omitted.",
		promptSnippet: "Check status for a background Mastra agent job.",
		promptGuidelines: ["Use agent_async_status to check whether a background Mastra agent job is still running, done, errored, or aborted."],
		parameters: MASTRA_AGENT_ASYNC_STATUS_PARAMETERS,
		async execute(_toolCallId: string, params: MastraAgentAsyncStatusInput): Promise<AgentToolResult<Record<string, unknown>>> {
			if (params.jobId) {
				const summary = manager.get(params.jobId);
				if (!summary) return errorResult(new Error(`Unknown async Mastra agent job: ${params.jobId}`), { jobId: params.jobId, status: "missing" });
				return { content: [{ type: "text", text: formatAsyncJobSummary(summary) }], details: { ...summary, details: summary } as unknown as Record<string, unknown> };
			}
			const jobs = manager.list();
			const text = jobs.length === 0 ? "No async Mastra agent jobs." : jobs.map(formatAsyncJobHeadline).join("\n");
			return { content: [{ type: "text", text }], details: { jobs, count: jobs.length } };
		},
		renderCall(args: MastraAgentAsyncStatusInput, theme: any) {
			return new Text(`${theme.fg("toolTitle", theme.bold("mastra async status "))}${theme.fg("accent", args.jobId ?? "jobs")}`, 0, 0);
		},
		renderResult(result: AgentToolResult<Record<string, unknown>>, _options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			const error = result.details?.error;
			return new Text(error ? theme.fg("error", String(error)) : textContent(result), 0, 0);
		},
	};
}

export function createMastraAgentReadTool(manager: MastraAsyncAgentManager) {
	return {
		name: MASTRA_AGENT_READ_TOOL_NAME,
		label: "Mastra Agent Read",
		description: "Read output from an async Mastra agent job by jobId. Supports summary, tail, or bounded full output.",
		promptSnippet: "Read summary, tail, or output from a background Mastra agent job.",
		promptGuidelines: ["Use agent_read with a jobId from agent_start to retrieve async Mastra agent output without rerunning the job."],
		parameters: MASTRA_AGENT_READ_PARAMETERS,
		async execute(_toolCallId: string, params: MastraAgentReadInput): Promise<AgentToolResult<Record<string, unknown>>> {
			try {
				const { text, summary } = await manager.read(params);
				return {
					content: [{ type: "text", text: truncateText(text, DEFAULT_MODEL_CONTENT_LIMIT).text }],
					details: { ...summary, mode: params.mode ?? "tail" } as unknown as Record<string, unknown>,
				};
			} catch (error) {
				return errorResult(error, { jobId: params.jobId, mode: params.mode ?? "tail", status: "error" });
			}
		},
		renderCall(args: MastraAgentReadInput, theme: any) {
			return new Text(`${theme.fg("toolTitle", theme.bold("mastra async read "))}${theme.fg("accent", args.jobId)}${theme.fg("dim", ` ${args.mode ?? "tail"}`)}`, 0, 0);
		},
		renderResult(result: AgentToolResult<Record<string, unknown>>, options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			return new Text(tail(textContent(result), options.expanded ? 4000 : 1000), 0, 0);
		},
	};
}

export function createMastraAgentCancelTool(manager: MastraAsyncAgentManager) {
	return {
		name: MASTRA_AGENT_CANCEL_TOOL_NAME,
		label: "Mastra Agent Cancel",
		description: "Cancel a running async Mastra agent job by jobId.",
		promptSnippet: "Cancel a background Mastra agent job.",
		promptGuidelines: ["Use agent_cancel when the user asks to stop a background Mastra agent job."],
		parameters: MASTRA_AGENT_CANCEL_PARAMETERS,
		async execute(_toolCallId: string, params: MastraAgentCancelInput): Promise<AgentToolResult<Record<string, unknown>>> {
			const summary = manager.cancel(params.jobId, params.reason);
			if (!summary) return errorResult(new Error(`Unknown async Mastra agent job: ${params.jobId}`), { jobId: params.jobId, status: "missing" });
			return { content: [{ type: "text", text: `Cancelled async Mastra agent job ${params.jobId}: ${summary.status}` }], details: summary as unknown as Record<string, unknown> };
		},
		renderCall(args: MastraAgentCancelInput, theme: any) {
			return new Text(`${theme.fg("toolTitle", theme.bold("mastra async cancel "))}${theme.fg("accent", args.jobId)}`, 0, 0);
		},
		renderResult(result: AgentToolResult<Record<string, unknown>>, _options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			const status = String(result.details?.status ?? "unknown");
			return new Text(`${theme.fg(status === "missing" ? "error" : "success", status)}\n${textContent(result)}`, 0, 0);
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
			"Use agent_inspect when the user asks for Mastra agent instructions, available tools, modes, or deeper agent capabilities.",
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
		promptGuidelines: ["Use agent_list when the user asks what Mastra agents are available or an agent id is unknown."],
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
		promptGuidelines: ["Use agent_status when the user asks whether a Mastra agent exists or needs agent metadata."],
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
		promptGuidelines: ["Use workflow_list when the user asks what Mastra workflows are available or a workflow id is unknown."],
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
		promptGuidelines: ["Use workflow_call when the user asks to execute a Mastra workflow and provides or accepts a run id."],
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
		promptGuidelines: ["Use workflow_status when the user asks about a workflow run's status or result."],
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
	const now = Date.now();
	return {
		agentId: params.agentId,
		modeId: params.modeId,
		prompt: params.message,
		threadId: params.threadId ?? defaultThreadId(params.agentId),
		resourceId,
		status: "running",
		startedAt: now,
		updatedAt: now,
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

function formatAsyncStartResult(summary: MastraAgentAsyncJobSummary): string {
	return [
		`Started async Mastra agent job: ${summary.jobId}`,
		`agentId: ${summary.agentId}`,
		summary.modeId ? `modeId: ${summary.modeId}` : undefined,
		`threadId: ${summary.threadId}`,
		`resourceId: ${summary.resourceId}`,
		summary.artifactPath ? `artifactPath: ${summary.artifactPath}` : undefined,
		"Live progress is shown in the Mastra Agents widget above the editor.",
		`When complete, use agent_read with jobId=${summary.jobId} before finalizing unless the initial user prompt explicitly said "pass the output" or "don't read the output".`,
	]
		.filter(Boolean)
		.join("\n");
}

function formatAsyncJobHeadline(summary: MastraAgentAsyncJobSummary): string {
	const parts = [
		summary.status,
		summary.agentId,
		summary.elapsedMs === undefined ? undefined : formatDuration(summary.elapsedMs),
		summary.toolCalls + summary.toolResults > 0 ? `${summary.toolCalls + summary.toolResults} tools` : undefined,
		summary.errors.length > 0 ? `${summary.errors.length} errors` : undefined,
	].filter(Boolean);
	return `${summary.jobId}: ${parts.join(" · ")}`;
}

function formatAsyncJobSummary(summary: MastraAgentAsyncJobSummary): string {
	const lines = [
		`jobId: ${summary.jobId}`,
		`agentId: ${summary.agentId}`,
		summary.modeId ? `modeId: ${summary.modeId}` : undefined,
		`status: ${summary.status}`,
		summary.elapsedMs === undefined ? undefined : `elapsed: ${formatDuration(summary.elapsedMs)}`,
		`threadId: ${summary.threadId}`,
		`resourceId: ${summary.resourceId}`,
		`events: ${summary.rawChunkCount}`,
		`tools: ${summary.toolCalls + summary.toolResults}`,
		summary.artifactPath ? `artifactPath: ${summary.artifactPath}` : undefined,
		summary.eventsPath ? `eventsPath: ${summary.eventsPath}` : undefined,
		summary.prompt ? `prompt: ${tailText(summary.prompt, 800)}` : undefined,
		summary.textPreview ? `textPreview:\n${summary.textPreview}` : undefined,
		summary.errors.length > 0 ? `errors:\n${summary.errors.join("\n")}` : undefined,
	];
	return lines.filter(Boolean).join("\n");
}

function normalizeJobId(value?: string): string {
	const trimmed = value?.trim();
	if (trimmed) return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
	return `mastra-agent-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function defaultAsyncThreadId(agentId: string, jobId: string): string {
	return `${defaultThreadId(agentId)}:${jobId}`;
}

function clampMaxChars(value?: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 4_000;
	return Math.max(100, Math.min(Math.floor(value), DEFAULT_MODEL_CONTENT_LIMIT));
}

function tailText(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `…${value.slice(Math.max(0, value.length - maxChars + 1))}`;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function emptyComponent() {
	// ToolExecutionComponent hides self-rendered tools whose call/result renderers
	// produce no lines. This keeps transcript UI focused on the live async widget
	// while preserving the tool result for the parent model.
	return {
		render: () => [],
		invalidate() {},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushBounded<T>(array: T[], value: T, limit: number): void {
	array.push(value);
	if (array.length > limit) array.splice(0, array.length - limit);
}
