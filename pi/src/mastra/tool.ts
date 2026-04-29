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
	MASTRA_AGENT_CANCEL_TOOL_NAME,
	MASTRA_AGENT_INSPECT_TOOL_NAME,
	MASTRA_AGENT_LIST_TOOL_NAME,
	MASTRA_AGENT_QUERY_TOOL_NAME,
	MASTRA_AGENT_READ_TOOL_NAME,
	MASTRA_AGENT_STATUS_TOOL_NAME,
	MASTRA_PI_AGENT_JOB_WORKFLOW_ID,
	MASTRA_WORKFLOW_CALL_TOOL_NAME,
	MASTRA_WORKFLOW_LIST_TOOL_NAME,
	MASTRA_WORKFLOW_STATUS_TOOL_NAME,
	REQUEST_CONTEXT_MODE_ID_KEY,
} from "../const.js";
import { MastraAgentCard } from "../tui/index.js";
import { MastraHttpClient } from "./client.js";
import { defaultPiSessionRunId, defaultPiSessionThreadId, defaultResourceId, defaultThreadId, safeIdPart } from "./memory.js";
import { applyNormalizedEvent, normalizeMastraChunk, truncateText } from "./normalize.js";
import type {
	MastraAgentAsyncJobSummary,
	MastraAgentAsyncStatusInput,
	MastraAgentCallDetails,
	MastraAgentCallInput,
	MastraAgentCancelInput,
	MastraAgentInspectJob,
	MastraAgentInfo,
	MastraAgentInspectDetails,
	MastraAgentInspectInput,
	MastraAgentInspection,
	MastraAgentLifecycleStatus,
	MastraAgentQueryInput,
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

export const MASTRA_AGENT_QUERY_PARAMETERS = Type.Object({
	agentId: Type.String({ description: "Mastra agent id to query" }),
	message: Type.String({ description: "User message to send to the Mastra agent" }),
	jobName: Type.Optional(Type.String({ description: "Short semantic name for this background job. Used in the Mastra thread id; omit to derive one from the prompt." })),
	synchronous: Type.Optional(Type.Boolean({ description: "Execute synchronously and return final result. Defaults to false (async-by-default). When false, returns a job id immediately and streams progress to the Pi TUI." })),
	threadId: Type.Optional(Type.String({ description: "Mastra memory thread id" })),
	resourceId: Type.Optional(Type.String({ description: "Mastra memory resource id" })),
	requestContext: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Request-scoped context for Mastra" })),
	includeToolResults: Type.Optional(Type.Boolean({ description: "Include tool result summaries in model-facing text" })),
	includeReasoning: Type.Optional(Type.Boolean({ description: "Include reasoning deltas in model-facing text. Defaults to false." })),
	timeoutMs: Type.Optional(Type.Number({ description: "Stream timeout in milliseconds" })),
	input_args: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Optional key-value pairs providing contextual bindings for literal placeholders like $1, $2 in the prompt body. Values are appended to the prompt section and mirrored into requestContext. Keys are sorted numerically." })),
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
	jobName: string;
	piSessionId?: string;
	runId?: string;
	workflowId?: string;
	params: MastraAgentStartInput;
	details: MastraAgentCallDetails;
	controller: AbortController;
	artifactPath?: string;
	eventsPath?: string;
	finalMessage: boolean;
	suppressCompletionMessage?: boolean;
	lifecycleStatus: Exclude<MastraAgentLifecycleStatus, "available">;
	usesWorkflow: boolean;
	completionQueuedNotified?: boolean;
	completionMessageSent?: boolean;
	suppressQueuedCompletion?: boolean;
	workflowObserverActive?: boolean;
}

export interface MastraAsyncAgentManagerOptions {
	activitySink?: MastraAgentActivitySink;
	onComplete?: (summary: MastraAgentAsyncJobSummary) => void | Promise<void>;
	useWorkflowJobs?: boolean;
	isCompletionAcknowledged?: (jobId: string) => boolean;
	cwd?: string;
	piSessionId?: string;
}

export class MastraAsyncAgentManager {
	private readonly jobs = new Map<string, MastraAsyncAgentJob>();
	private suppressCompletionMessages = false;
	private piSessionId: string | undefined;
	private cwd: string;

	constructor(
		private readonly client = new MastraHttpClient(),
		private readonly options: MastraAsyncAgentManagerOptions = {},
	) {
		this.piSessionId = options.piSessionId;
		this.cwd = options.cwd ?? process.cwd();
	}

	configureSession(params: { piSessionId: string; cwd: string; isCompletionAcknowledged?: (jobId: string) => boolean }): void {
		this.piSessionId = params.piSessionId;
		this.cwd = params.cwd;
		this.options.isCompletionAcknowledged = params.isCompletionAcknowledged;
	}

	async start(params: MastraAgentStartInput): Promise<MastraAgentAsyncJobSummary> {
		const jobName = normalizeJobName(params.jobName ?? params.jobId ?? params.message);
		const jobId = normalizeJobId(params.jobId ?? `${jobName}-${Date.now()}-${randomUUID().slice(0, 8)}`);
		if (this.jobs.has(jobId)) throw new Error(`Async Mastra agent job already exists: ${jobId}`);

		const piSessionId = params.piSessionId ?? this.piSessionId ?? "local-session";
		const resourceId = params.resourceId ?? defaultResourceId(this.cwd);
		const threadId = params.threadId ?? defaultPiSessionThreadId({
			piSessionId,
			jobName,
			agentName: params.agentId,
			resourceId,
		});
		const runId = defaultPiSessionRunId({
			piSessionId,
			jobName,
			agentName: params.agentId,
			resourceId,
			jobId,
		});
		const effectiveParams: MastraAgentStartInput = {
			...params,
			jobId,
			jobName,
			piSessionId,
			threadId,
			resourceId,
			finalMessage: params.finalMessage ?? true,
		};
		const details = createInitialDetails(effectiveParams);
		const job: MastraAsyncAgentJob = {
			jobId,
			jobName,
			piSessionId,
			runId,
			workflowId: MASTRA_PI_AGENT_JOB_WORKFLOW_ID,
			params: effectiveParams,
			details,
			controller: new AbortController(),
			finalMessage: effectiveParams.finalMessage !== false,
			suppressCompletionMessage: this.suppressCompletionMessages,
			lifecycleStatus: "working",
			usesWorkflow: false,
		};
		this.jobs.set(jobId, job);
		this.options.activitySink?.start(jobId, effectiveParams, details);

		if (this.canStartWorkflowJobs()) {
			try {
				this.startWorkflowJob(job);
				return this.summary(job);
			} catch (error) {
				// During local development the Pi package can be newer than the running
				// Mastra server. Fall back to the direct stream so agent_query remains
				// usable, but keep the session/thread id convention identical.
				job.details.errors.push(`Workflow job runner unavailable, falling back to direct stream: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		const artifactDir = await mkdtemp(join(tmpdir(), `${jobId}-`));
		job.artifactPath = join(artifactDir, "output.txt");
		job.eventsPath = join(artifactDir, "events.jsonl");
		void this.runDirect(job, createStreamRequest(effectiveParams, details.threadId, details.resourceId));
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

		const output = appendIncompleteReadNotice(await this.readArtifact(job), summary);
		if (mode === "full") {
			const truncated = truncateText(output || job.details.text || "(no text output)", maxChars);
			const artifactNotice = job.artifactPath ? `\n\nFull output artifact: ${job.artifactPath}` : "";
			return { text: `${truncated.text}${truncated.truncated ? artifactNotice : ""}`, summary };
		}

		const text = output || job.details.text || "(no text output)";
		return { text: tailText(text, maxChars), summary };
	}

	async cancel(jobId: string, reason = "cancelled"): Promise<MastraAgentAsyncJobSummary | undefined> {
		const job = this.jobs.get(jobId);
		if (!job) return undefined;
		if (job.details.status === "running" && job.usesWorkflow && job.workflowId && job.runId && this.hasClientMethod("getWorkflowRun")) {
			await this.refreshWorkflowRun(job).catch(() => undefined);
		}
		if (job.details.status !== "running") {
			if (job.lifecycleStatus === "working") await this.completeJob(job);
			else if (job.lifecycleStatus === "agent_response_queued") this.markEnded(jobId);
			return this.summary(job);
		}
		if (job.lifecycleStatus === "working") {
			job.suppressQueuedCompletion = true;
			job.suppressCompletionMessage = true;
			pushUniqueError(job.details, reason);
			job.controller.abort(new Error(reason));
			if (job.usesWorkflow && job.workflowId && job.runId && this.hasClientMethod("cancelWorkflowRun")) {
				await this.client.cancelWorkflowRun(job.workflowId, job.runId).catch((error) => {
					pushUniqueError(job.details, `Remote workflow cancellation failed: ${error instanceof Error ? error.message : String(error)}`);
				});
			}
			job.details.status = "aborted";
			job.details.updatedAt = Date.now();
			job.details.completedAt = job.details.updatedAt;
			job.details.terminalReason = "abort";
			this.markEnded(jobId);
		} else {
			this.markEnded(jobId);
		}
		return this.summary(job);
	}

	cancelAll(reason = "session shutdown", options: { suppressCompletionMessage?: boolean } = {}): void {
		if (options.suppressCompletionMessage === true) this.suppressCompletionMessages = true;
		for (const job of this.jobs.values()) {
			if (options.suppressCompletionMessage === true) job.suppressCompletionMessage = true;
			if (job.details.status === "running") {
				job.details.errors.push(reason);
				job.controller.abort(new Error(reason));
			}
		}
	}

	detachAll(reason = "session shutdown"): void {
		for (const job of Array.from(this.jobs.values())) {
			if (job.lifecycleStatus === "working") {
				job.suppressQueuedCompletion = true;
				job.suppressCompletionMessage = true;
				pushUniqueError(job.details, reason);
				this.markEnded(job.jobId);
				job.controller.abort(new Error(reason));
				this.jobs.delete(job.jobId);
			}
		}
		this.options.activitySink?.reset?.();
	}

	markEnded(jobId: string): MastraAgentAsyncJobSummary | undefined {
		const job = this.jobs.get(jobId);
		if (!job) return undefined;
		if (job.lifecycleStatus === "ended") return this.summary(job);
		job.lifecycleStatus = "ended";
		this.options.activitySink?.end?.(jobId);
		return this.summary(job);
	}

	async restoreSessionJobs(): Promise<MastraAgentAsyncJobSummary[]> {
		if (!this.canRestoreWorkflowJobs() || !this.piSessionId) return [];
		const resourceId = defaultResourceId(this.cwd);
		let runs: MastraWorkflowRun[];
		try {
			runs = await this.client.listWorkflowRuns(MASTRA_PI_AGENT_JOB_WORKFLOW_ID, { resourceId });
		} catch {
			return [];
		}

		const restored: MastraAgentAsyncJobSummary[] = [];
		for (const run of runs.filter((candidate) => this.isSessionWorkflowRun(candidate))) {
			const job = this.jobFromWorkflowRun(run);
			if (!job) continue;

			const status = workflowRunStatus(run);
			if (isActiveWorkflowStatus(status) && !job.controller.signal.aborted) {
				void this.observeWorkflowJob(job);
				restored.push(this.summary(job));
				continue;
			}

			await this.refreshWorkflowRun(job).catch(() => undefined);
			if (this.options.isCompletionAcknowledged?.(job.jobId)) {
				this.markEnded(job.jobId);
			} else if (isTerminalWorkflowStatus(status)) {
				await this.completeJob(job);
			}
			restored.push(this.summary(job));
		}
		return restored;
	}

	inspectJobs(): MastraAgentInspectJob[] {
		return this.list().map((summary) => ({
			jobId: summary.jobId,
			jobName: summary.jobName,
			agentId: summary.agentId,
			status: summary.lifecycleStatus ?? "working",
			threadId: summary.threadId,
			resourceId: summary.resourceId,
			runId: summary.runId,
			workflowId: summary.workflowId,
			updatedAt: summary.updatedAt,
		}));
	}

	private async runDirect(job: MastraAsyncAgentJob, request: MastraStreamRequest): Promise<void> {
		try {
			const timeoutMs = job.params.timeoutMs ?? DEFAULT_ASYNC_AGENT_TIMEOUT_MS;
			for await (const chunk of this.client.streamAgent(job.params.agentId, request, { signal: job.controller.signal, timeoutMs })) {
				const normalized = normalizeMastraChunk(chunk);
				await this.persistChunk(job, chunk, normalized);
				applyNormalizedEvent(job.details, normalized);
				this.options.activitySink?.update(job.jobId, job.details);
			}

			markStreamEofIncomplete(job.details);
		} catch (error) {
			markStreamError(job.details, error, job.controller.signal.aborted);
		} finally {
			await this.completeJob(job);
		}
	}

	private startWorkflowJob(job: MastraAsyncAgentJob): void {
		if (!job.workflowId || !job.runId) throw new Error("Workflow job is missing workflow/run id");
		job.usesWorkflow = true;
		void this.streamWorkflowJob(job);
	}

	private async streamWorkflowJob(job: MastraAsyncAgentJob): Promise<void> {
		if (!job.workflowId || !job.runId) return;
		if (job.workflowObserverActive) return;
		job.workflowObserverActive = true;
		let fallbackStarted = false;
		try {
			const timeoutMs = job.params.timeoutMs ?? DEFAULT_ASYNC_AGENT_TIMEOUT_MS;
			for await (const chunk of this.client.streamWorkflow(job.workflowId, job.runId, workflowJobRequest(job), { signal: job.controller.signal, timeoutMs })) {
				await this.applyWorkflowJobChunk(job, chunk);
			}
			await this.refreshWorkflowRun(job);
			if (job.details.status === "running") markStreamEofIncomplete(job.details);
		} catch (error) {
			job.workflowObserverActive = false;
			fallbackStarted = await this.fallbackWorkflowStreamToDirect(job, error);
			if (!fallbackStarted) markStreamError(job.details, error, job.controller.signal.aborted);
		} finally {
			job.workflowObserverActive = false;
			if (!fallbackStarted) await this.completeJob(job);
		}
	}

	private async fallbackWorkflowStreamToDirect(job: MastraAsyncAgentJob, error: unknown): Promise<boolean> {
		if (job.controller.signal.aborted || job.details.status !== "running" || job.details.rawChunkCount > 0 || !this.hasClientMethod("streamAgent")) {
			return false;
		}
		pushUniqueError(job.details, `Workflow job runner unavailable, falling back to direct stream: ${error instanceof Error ? error.message : String(error)}`);
		try {
			const artifactDir = await mkdtemp(join(tmpdir(), `${job.jobId}-`));
			job.artifactPath = join(artifactDir, "output.txt");
			job.eventsPath = join(artifactDir, "events.jsonl");
			job.usesWorkflow = false;
			await this.runDirect(job, createStreamRequest(job.params, job.details.threadId, job.details.resourceId));
			return true;
		} catch (fallbackError) {
			pushUniqueError(job.details, `Direct fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
			return false;
		}
	}

	private async observeWorkflowJob(job: MastraAsyncAgentJob): Promise<void> {
		if (!job.workflowId || !job.runId) return;
		if (job.workflowObserverActive) return;
		job.workflowObserverActive = true;
		try {
			const timeoutMs = job.params.timeoutMs ?? DEFAULT_ASYNC_AGENT_TIMEOUT_MS;
			for await (const chunk of this.client.observeWorkflow(job.workflowId, job.runId, { resourceId: job.details.resourceId }, { signal: job.controller.signal, timeoutMs })) {
				await this.applyWorkflowJobChunk(job, chunk);
			}
			await this.refreshWorkflowRun(job);
			if (job.details.status === "running") markStreamEofIncomplete(job.details);
		} catch (error) {
			markStreamError(job.details, error, job.controller.signal.aborted);
		} finally {
			job.workflowObserverActive = false;
			await this.completeJob(job);
		}
	}

	private async applyWorkflowJobChunk(job: MastraAsyncAgentJob, chunk: unknown): Promise<void> {
		const agentChunk = unwrapWorkflowAgentChunk(chunk);
		if (agentChunk !== undefined) {
			const normalized = normalizeMastraChunk(agentChunk);
			await this.persistChunk(job, agentChunk, normalized);
			applyNormalizedEvent(job.details, normalized);
			this.options.activitySink?.update(job.jobId, job.details);
			return;
		}
		applyWorkflowLifecycleChunk(job.details, chunk);
		this.options.activitySink?.update(job.jobId, job.details);
	}

	private async refreshWorkflowRun(job: MastraAsyncAgentJob): Promise<void> {
		if (!job.workflowId || !job.runId || !this.hasClientMethod("getWorkflowRun")) return;
		const run = await this.client.getWorkflowRun(job.workflowId, job.runId, { fields: ["result", "error", "payload"] });
		const output = workflowJobOutput(run.result);
		const status = workflowRunStatus(run);
		if (output.artifactPath) job.artifactPath = output.artifactPath;
		if (output.eventsPath) job.eventsPath = output.eventsPath;
		if (output.text && !job.details.text) job.details.text = output.text;
		for (const error of output.errors ?? []) pushUniqueError(job.details, error);

		if (output.status === "error" && job.details.status !== "aborted") {
			markStreamError(job.details, output.errors?.[0] ?? run.error ?? "Workflow agent job returned error", false);
		} else if (status === "success" && job.details.status === "running") {
			job.details.status = "done";
			job.details.updatedAt = Date.now();
			job.details.completedAt = job.details.updatedAt;
			job.details.terminalReason = "finish";
		} else if (status === "canceled" && job.details.status === "running") {
			markStreamError(job.details, "Workflow run canceled", true);
		} else if (isFailedWorkflowStatus(status) && job.details.status === "running") {
			markStreamError(job.details, run.error ?? `Workflow run failed with status ${status}`, false);
		}
	}

	private async completeJob(job: MastraAsyncAgentJob): Promise<void> {
		if (job.lifecycleStatus === "ended") return;
		if (job.suppressQueuedCompletion) return;
		const shouldNotifyQueued = job.lifecycleStatus !== "agent_response_queued" || job.completionQueuedNotified !== true;
		job.lifecycleStatus = "agent_response_queued";
		if (shouldNotifyQueued) {
			try {
				this.options.activitySink?.finish(job.jobId, job.details);
				job.completionQueuedNotified = true;
			} catch (error) {
				pushUniqueError(job.details, `Completion activity sink failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (job.finalMessage && !job.suppressCompletionMessage && !job.completionMessageSent && !this.options.isCompletionAcknowledged?.(job.jobId)) {
			try {
				await this.options.onComplete?.(this.summary(job));
				job.completionMessageSent = true;
			} catch (error) {
				pushUniqueError(job.details, `Completion reminder failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	private jobFromWorkflowRun(run: MastraWorkflowRun): MastraAsyncAgentJob | undefined {
		const input = workflowRunInput(run);
		const jobId = stringField(input, "jobId") ?? jobIdFromRunId(run.runId);
		const agentId = stringField(input, "agentId") ?? "unknown-agent";
		const jobName = normalizeJobName(stringField(input, "jobName") ?? jobId);
		const resourceId = run.resourceId ?? stringField(input, "resourceId") ?? defaultResourceId(this.cwd);
		const piSessionId = stringField(input, "piSessionId") ?? this.piSessionId;
		const threadId = stringField(input, "threadId") ?? defaultPiSessionThreadId({
			piSessionId: piSessionId ?? "local-session",
			jobName,
			agentName: agentId,
			resourceId,
		});
		const existing = this.jobs.get(jobId);
		if (existing) return existing;
		const output = workflowJobOutput(run.result);

		const params: MastraAgentStartInput = {
			agentId,
			message: stringField(input, "message") ?? "",
			jobId,
			jobName,
			piSessionId,
			threadId,
			resourceId,
			requestContext: recordField(input, "requestContext"),
			includeReasoning: booleanField(input, "includeReasoning"),
			includeToolResults: booleanField(input, "includeToolResults"),
			input_args: recordStringField(input, "input_args"),
			timeoutMs: numberField(input, "timeoutMs"),
			finalMessage: true,
		};
		const details = createInitialDetails(params);
		const status = workflowRunStatus(run);
		details.status = isActiveWorkflowStatus(status)
			? "running"
			: output.status === "error"
				? "error"
				: status === "success"
					? "done"
					: isFailedWorkflowStatus(status)
						? "error"
						: "aborted";
		if (details.status !== "running") {
			details.updatedAt = Date.now();
			details.completedAt = details.updatedAt;
			details.terminalReason = details.status === "done" ? "finish" : details.status === "aborted" ? "abort" : "error";
		}

		if (output.text) details.text = output.text;
		for (const error of output.errors ?? []) pushUniqueError(details, error);
		const job: MastraAsyncAgentJob = {
			jobId,
			jobName,
			piSessionId,
			runId: run.runId,
			workflowId: MASTRA_PI_AGENT_JOB_WORKFLOW_ID,
			params,
			details,
			controller: new AbortController(),
			artifactPath: output.artifactPath,
			eventsPath: output.eventsPath,
			finalMessage: true,
			lifecycleStatus: "working",
			usesWorkflow: true,
		};
		this.jobs.set(jobId, job);
		this.options.activitySink?.start(jobId, params, details);
		return job;
	}

	private canStartWorkflowJobs(): boolean {
		return this.options.useWorkflowJobs !== false && this.hasClientMethod("streamWorkflow");
	}

	private canRestoreWorkflowJobs(): boolean {
		return this.options.useWorkflowJobs !== false && this.hasClientMethod("listWorkflowRuns") && this.hasClientMethod("observeWorkflow");
	}

	private isSessionWorkflowRun(run: MastraWorkflowRun): boolean {
		if (!this.piSessionId) return false;
		const input = workflowRunInput(run);
		const piSessionId = stringField(input, "piSessionId");
		return piSessionId ? piSessionId === this.piSessionId : this.isSessionRun(run.runId);
	}

	private hasClientMethod(name: keyof MastraHttpClient): boolean {
		return typeof this.client[name] === "function";
	}

	private isSessionRun(runId: string): boolean {
		if (!this.piSessionId) return false;
		return runId.includes(`-${safeIdPart(this.piSessionId)}-`);
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
			terminalReason: details.terminalReason,
			incomplete: details.incomplete,
			jobName: job.jobName,
			piSessionId: job.piSessionId,
			runId: job.runId,
			workflowId: job.workflowId,
			lifecycleStatus: job.lifecycleStatus,
			artifactPath: job.artifactPath,
			eventsPath: job.eventsPath,
		};
	}
}

function workflowRunStatus(run: MastraWorkflowRun): string {
	return typeof run.status === "string" ? run.status : "running";
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
		createMastraAgentQueryTool(asyncAgentManager, client, options.agentActivitySink),
		createMastraAgentReadTool(asyncAgentManager),
		createMastraAgentCancelTool(asyncAgentManager),
		createMastraAgentInspectTool(client, asyncAgentManager),
		createMastraWorkflowCallTool(client),
		createMastraWorkflowListTool(client),
		createMastraWorkflowStatusTool(client),
	];
}

export function createMastraAgentQueryTool(
	manager: MastraAsyncAgentManager,
	client = new MastraHttpClient(),
	activitySink?: MastraAgentActivitySink,
) {
	return {
		name: MASTRA_AGENT_QUERY_TOOL_NAME,
		label: "Mastra Agent Query",
		description: "Call a Mastra agent with async-by-default execution. Returns a job id immediately unless synchronous=true. Supports input_args, includeToolResults, and includeReasoning (default: false). Does not expose maxSteps or activeTools.",
		promptSnippet: "Query a Mastra agent with async-by-default execution.",
		promptGuidelines: [
			"Use agent_query for Mastra agent delegation when async-by-default behavior is preferred and maxSteps/activeTools are not needed.",
			"After agent_query returns a jobId (async mode), use agent_read to retrieve output unless the initial prompt explicitly opts out.",
		],
		parameters: MASTRA_AGENT_QUERY_PARAMETERS,
		renderShell: "self" as const,
		async execute(
			_toolCallId: string,
			params: MastraAgentQueryInput,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<MastraAgentCallDetails>,
		): Promise<AgentToolResult<MastraAgentCallDetails | Record<string, unknown>>> {
			// Default to async unless synchronous is explicitly true
			if (params.synchronous !== true) {
				if (signal?.aborted) {
					return {
						content: [{ type: "text", text: "Async Mastra agent query was aborted before launch." }],
						details: {
							jobId: "",
							agentId: params.agentId,
							modeId: undefined,
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
							terminalReason: "abort",
							incomplete: false,
						} as unknown as Record<string, unknown>,
					};
				}
				try {
					const summary = await manager.start({
						agentId: params.agentId,
						message: params.message,
						jobName: params.jobName,
						threadId: params.threadId,
						resourceId: params.resourceId,
						requestContext: params.requestContext,
						includeToolResults: params.includeToolResults,
						includeReasoning: params.includeReasoning ?? false,
						timeoutMs: params.timeoutMs,
						input_args: params.input_args,
						finalMessage: true,
					});
					return {
						content: [{ type: "text", text: formatAsyncStartResult(summary) }],
						details: summary as unknown as Record<string, unknown>,
					};
				} catch (error) {
					return errorResult(error, { jobId: "", agentId: params.agentId, status: "error" });
				}
			}

			// Synchronous path: stream via client.streamAgent and return final details.
			const details = createInitialDetails({
				agentId: params.agentId,
				message: params.message,
				jobName: params.jobName,
				threadId: params.threadId,
				resourceId: params.resourceId,
				requestContext: params.requestContext,
				includeToolResults: params.includeToolResults,
				includeReasoning: params.includeReasoning,
				timeoutMs: params.timeoutMs,
				input_args: params.input_args,
			});
			const request = createStreamRequest(params, details.threadId, details.resourceId);
			const emitUpdate = () => {
				details.updatedAt = Date.now();
				activitySink?.update(_toolCallId, details);
				onUpdate?.(makeToolResult(details, params));
			};

			activitySink?.start(_toolCallId, params, details);
			emitUpdate();

			try {
				for await (const chunk of client.streamAgent(params.agentId, request, { signal, timeoutMs: params.timeoutMs })) {
					applyNormalizedEvent(details, normalizeMastraChunk(chunk));
					emitUpdate();
				}

				markStreamEofIncomplete(details);
				activitySink?.finish(_toolCallId, details);
				activitySink?.end?.(_toolCallId);
				return makeToolResult(details, params);
			} catch (error) {
				markStreamError(details, error, signal?.aborted === true);
				activitySink?.finish(_toolCallId, details);
				activitySink?.end?.(_toolCallId);
				return makeToolResult(details, params);
			}
		},
		renderCall(args: MastraAgentQueryInput, theme: any) {
			const mode = args.synchronous ? "sync" : "async";
			return new Text(`${theme.fg("toolTitle", theme.bold("mastra query "))}${theme.fg("accent", args.agentId)}${theme.fg("dim", ` mode=${mode}`)}`, 0, 0);
		},
		renderResult(result: AgentToolResult<MastraAgentCallDetails | Record<string, unknown>>, options: { expanded?: boolean; isPartial?: boolean }, theme: any) {
			// If result has text/toolCalls it's a sync call details; otherwise async summary
			if (result.details && "text" in (result.details as any) && "toolCalls" in (result.details as any)) {
				return new MastraAgentCard(result.details as MastraAgentCallDetails, options, theme);
			}
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
		promptGuidelines: ["Use agent_read with a jobId from agent_query to retrieve async Mastra agent output without rerunning the job."],
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
			const summary = await manager.cancel(params.jobId, params.reason);
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

export function createMastraAgentInspectTool(client = new MastraHttpClient(), manager?: MastraAsyncAgentManager) {
	return {
		name: MASTRA_AGENT_INSPECT_TOOL_NAME,
		label: "Mastra Agent Inspect",
		description: "Inspect Mastra agent availability and current-session background jobs, or inspect one or more agents by id.",
		promptSnippet: "Inspect available Mastra agents and current background job status.",
		promptGuidelines: [
			"Use agent_inspect with no arguments to list available agents plus working, queued, and ended jobs for this Pi session.",
			"Pass agentId or agents when the user asks for instructions, tools, modes, or deeper agent capabilities.",
		],
		parameters: MASTRA_AGENT_INSPECT_PARAMETERS,
		async execute(_toolCallId: string, params: MastraAgentInspectInput, signal?: AbortSignal): Promise<AgentToolResult<MastraAgentInspectDetails>> {
			const agentIds = normalizeInspectAgentIds(params);
			if (agentIds.length === 0) {
				try {
					const agents = await client.listAgents(signal);
					const jobs = manager?.inspectJobs() ?? [];
					const availableAgents = Object.entries(agents).map(([agentId]) => ({ agentId, status: "available" as const }));
					const details: MastraAgentInspectDetails = { agents: [], count: availableAgents.length, errors: [], availableAgents, jobs };
					return {
						content: [{ type: "text", text: truncateText(formatAgentInspectSessionResult(details), DEFAULT_MODEL_CONTENT_LIMIT).text }],
						details,
					};
				} catch (error) {
					return errorResult(error, { agents: [], count: 0, errors: [] }) as AgentToolResult<MastraAgentInspectDetails>;
				}
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

	const message = params.message;

	// Handle input_args: validate keys, sort numerically, append section, mirror to context
	if (params.input_args && Object.keys(params.input_args).length > 0) {
		// Validate that all keys match the placeholder pattern ^\$[1-9][0-9]*$
		for (const key of Object.keys(params.input_args)) {
			if (typeof key !== "string" || !/^\$[1-9][0-9]*$/.test(key)) {
				throw new Error(`input_args placeholder key must match pattern ^\\$[1-9][0-9]*$, got: ${JSON.stringify(key)}`);
			}
		}

		// Sort keys numerically by extracting the number after the $ prefix
		const sortedKeys = Object.keys(params.input_args).sort((a, b) => {
			const numA = parseInt(a.slice(1), 10);
			const numB = parseInt(b.slice(1), 10);
			return numA - numB;
		});

		// Build the "Input arguments:" section with numeric ordering and bullet list format
		const argsLines: string[] = [];
		for (const key of sortedKeys) {
			const value = params.input_args[key];
			if (value !== undefined) {
				argsLines.push(`- ${key}: ${value}`);
			}
		}

		// Append input_args section only when args are provided; preserve literal placeholders in original message
		if (argsLines.length > 0) {
			const inputArgsSection = `Input arguments:\n${argsLines.join("\n")}\n\nWhen the prompt references placeholders like $1, $2, etc., use the corresponding input argument above.`;
			requestContext.input_args = params.input_args;

			return {
				messages: [{ role: "user", content: `${message}\n\n${inputArgsSection}` }],
				memory: { thread: threadId, resource: resourceId },
				maxSteps: params.maxSteps,
				activeTools: params.activeTools,
				requestContext: Object.keys(requestContext).length > 0 ? requestContext : undefined,
				input_args: params.input_args,
			};
		}

		// Mirror input_args into requestContext even when argsLines is empty
		requestContext.input_args = params.input_args;
	}

	return {
		messages: [{ role: "user", content: message }],
		memory: { thread: threadId, resource: resourceId },
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

function workflowJobRequest(job: MastraAsyncAgentJob): MastraWorkflowStreamRequest {
	return {
		resourceId: job.details.resourceId,
		inputData: {
			jobId: job.jobId,
			jobName: job.jobName,
			piSessionId: job.piSessionId,
			runId: job.runId,
			agentRunId: job.runId,
			agentId: job.params.agentId,
			message: job.params.message,
			threadId: job.details.threadId,
			resourceId: job.details.resourceId,
			requestContext: job.params.requestContext,
			includeToolResults: job.params.includeToolResults,
			includeReasoning: job.params.includeReasoning ?? false,
			input_args: job.params.input_args,
			timeoutMs: job.params.timeoutMs,
		},
		requestContext: job.params.requestContext,
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

const INCOMPLETE_STREAM_MESSAGE = "Mastra agent stream ended before a terminal finish event.";

function markStreamEofIncomplete(details: MastraAgentCallDetails): void {
	if (details.status !== "running") return;
	details.status = "error";
	details.updatedAt = Date.now();
	details.completedAt = details.updatedAt;
	details.terminalReason = "stream_eof";
	details.incomplete = true;
	if (!details.errors.includes(INCOMPLETE_STREAM_MESSAGE)) details.errors.push(INCOMPLETE_STREAM_MESSAGE);
}

function markStreamError(details: MastraAgentCallDetails, error: unknown, aborted: boolean): void {
	details.status = aborted ? "aborted" : "error";
	details.updatedAt = Date.now();
	details.completedAt = details.updatedAt;
	details.terminalReason = aborted ? "abort" : "error";
	details.incomplete = false;
	const message = error instanceof Error ? error.message : String(error);
	pushUniqueError(details, message);
}

function pushUniqueError(details: MastraAgentCallDetails, message: string): void {
	if (!details.errors.includes(message)) details.errors.push(message);
}

function appendIncompleteReadNotice(text: string, summary: MastraAgentAsyncJobSummary): string {
	if (!summary.incomplete) return text;
	const reason = summary.errors[summary.errors.length - 1] ?? INCOMPLETE_STREAM_MESSAGE;
	return `${text || "(no text output)"}\n\n[async job incomplete: ${reason}]`;
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

function formatAgentInspectSessionResult(details: MastraAgentInspectDetails): string {
	return safeJson({
		availableAgents: details.availableAgents ?? [],
		jobs: details.jobs ?? [],
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
		summary.jobName ? `jobName: ${summary.jobName}` : undefined,
		`agentId: ${summary.agentId}`,
		summary.modeId ? `modeId: ${summary.modeId}` : undefined,
		`threadId: ${summary.threadId}`,
		`resourceId: ${summary.resourceId}`,
		summary.runId ? `runId: ${summary.runId}` : undefined,
		summary.artifactPath ? `artifactPath: ${summary.artifactPath}` : undefined,
		"Live progress is shown in the Mastra Agents widget above the editor.",
		`When complete, use agent_read with jobId=${summary.jobId} before finalizing unless the initial user prompt explicitly said "pass the output" or "don't read the output".`,
	]
		.filter(Boolean)
		.join("\n");
}

function formatAsyncJobHeadline(summary: MastraAgentAsyncJobSummary): string {
	const parts = [
		summary.lifecycleStatus ?? summary.status,
		summary.status,
		summary.incomplete ? "incomplete" : undefined,
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
		summary.jobName ? `jobName: ${summary.jobName}` : undefined,
		`agentId: ${summary.agentId}`,
		summary.modeId ? `modeId: ${summary.modeId}` : undefined,
		summary.lifecycleStatus ? `lifecycleStatus: ${summary.lifecycleStatus}` : undefined,
		`status: ${summary.status}`,
		summary.terminalReason ? `terminalReason: ${summary.terminalReason}` : undefined,
		summary.incomplete ? "incomplete: true" : undefined,
		summary.elapsedMs === undefined ? undefined : `elapsed: ${formatDuration(summary.elapsedMs)}`,
		`threadId: ${summary.threadId}`,
		`resourceId: ${summary.resourceId}`,
		summary.piSessionId ? `piSessionId: ${summary.piSessionId}` : undefined,
		summary.runId ? `runId: ${summary.runId}` : undefined,
		summary.workflowId ? `workflowId: ${summary.workflowId}` : undefined,
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

function normalizeJobName(value?: string): string {
	const trimmed = value?.trim();
	if (!trimmed) return "agent-job";
	const source = trimmed.length > 64 ? trimmed.slice(0, 64) : trimmed;
	return safeIdPart(source.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"));
}

function unwrapWorkflowAgentChunk(chunk: unknown): unknown | undefined {
	if (!isRecord(chunk)) return undefined;
	if (chunk.type === "workflow-step-output" && isRecord(chunk.payload)) {
		return unwrapWorkflowAgentChunk(chunk.payload.output);
	}
	if (chunk.type === "pi-agent-stream-chunk" && isRecord(chunk.payload)) {
		return chunk.payload.chunk;
	}
	if (chunk.type === "data-pi-agent-stream-chunk" && isRecord(chunk.data)) {
		return chunk.data.chunk;
	}
	const type = typeof chunk.type === "string" ? chunk.type : "";
	return isMastraAgentChunkType(type) ? chunk : undefined;
}

function isMastraAgentChunkType(type: string): boolean {
	return [
		"text-delta",
		"reasoning-delta",
		"tool-call",
		"tool-result",
		"tool-error",
		"tool-call-input-streaming-start",
		"tool-call-delta",
		"tool-call-input-streaming-end",
		"finish",
		"error",
	].includes(type);
}

function applyWorkflowLifecycleChunk(details: MastraAgentCallDetails, chunk: unknown): void {
	if (!isRecord(chunk)) return;
	if (chunk.type === "workflow-finish" && isRecord(chunk.payload)) {
		const status = typeof chunk.payload.workflowStatus === "string" ? chunk.payload.workflowStatus : undefined;
		if (status === "success" && details.status === "running") {
			details.status = "done";
			details.updatedAt = Date.now();
			details.completedAt = details.updatedAt;
			details.terminalReason = "finish";
		}
		if (status && isFailedWorkflowStatus(status) && details.status === "running") {
			markStreamError(details, `Workflow run failed with status ${status}`, false);
		}
	}
	if (chunk.type === "workflow-canceled" && details.status === "running") {
		markStreamError(details, "Workflow run canceled", true);
	}
}

function workflowJobOutput(value: unknown): { status?: "done" | "error"; text?: string; artifactPath?: string; eventsPath?: string; errors?: string[] } {
	const candidates = objectCandidates(value);
	let output: { status?: "done" | "error"; text?: string; artifactPath?: string; eventsPath?: string; errors?: string[] } = {};
	for (const candidate of candidates) {
		const rawStatus = stringField(candidate, "status");
		const status = rawStatus === "done" || rawStatus === "error" ? rawStatus : undefined;
		output = {
			status: output.status ?? status,
			artifactPath: output.artifactPath ?? stringField(candidate, "artifactPath"),
			eventsPath: output.eventsPath ?? stringField(candidate, "eventsPath"),
			text: output.text ?? stringField(candidate, "text") ?? stringField(candidate, "output") ?? stringField(candidate, "textPreview"),
			errors: output.errors ?? stringArrayField(candidate, "errors"),
		};
	}
	return output;
}

function workflowRunInput(run: MastraWorkflowRun): Record<string, unknown> {
	const candidates = objectCandidates(run);
	for (const candidate of candidates) {
		const inputData = recordField(candidate, "inputData");
		if (inputData) return inputData;
		const payload = recordField(candidate, "payload");
		if (payload) return payload;
		const input = recordField(candidate, "input");
		if (input) return input;
	}
	return {};
}

function objectCandidates(value: unknown): Record<string, unknown>[] {
	if (!isRecord(value)) return [];
	const candidates: Record<string, unknown>[] = [value];
	for (const key of ["result", "output", "payload", "data"]) {
		const nested = value[key];
		if (isRecord(nested)) candidates.push(...objectCandidates(nested));
	}
	return candidates;
}

function jobIdFromRunId(runId: string): string {
	const match = runId.match(/-mastra-agent-[^-]+-[^-]+$/);
	if (match) return match[0].slice(1);
	const parts = runId.split("-");
	return parts.slice(-2).join("-") || runId;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
	const value = record[key];
	return isRecord(value) ? value : undefined;
}

function recordStringField(record: Record<string, unknown>, key: string): Record<string, string> | undefined {
	const value = record[key];
	if (!isRecord(value)) return undefined;
	const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
	return entries.length === Object.keys(value).length ? Object.fromEntries(entries) : undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
	const value = record[key];
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter((entry): entry is string => typeof entry === "string");
	return strings.length === value.length ? strings : undefined;
}

function isActiveWorkflowStatus(status: string): boolean {
	return ["running", "waiting", "pending", "paused", "suspended"].includes(status);
}

function isTerminalWorkflowStatus(status: string): boolean {
	return ["success", "failed", "canceled", "bailed", "tripwire"].includes(status);
}

function isFailedWorkflowStatus(status: string): boolean {
	return ["failed", "bailed", "tripwire"].includes(status);
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
