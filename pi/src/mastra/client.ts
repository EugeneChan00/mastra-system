import {
	DEFAULT_STREAM_TIMEOUT_MS,
	agentPath,
	agentsPath,
	agentStreamPath,
	workflowPath,
	workflowCancelRunPath,
	workflowObservePath,
	workflowRunPath,
	workflowRunsPath,
	workflowStartAsyncPath,
	workflowsPath,
	workflowStreamPath,
} from "../const.js";
import { parseSseDataEvents, parseSseJsonData } from "./sse.js";
import type {
	MastraAgentInfo,
	MastraAgentsResponse,
	MastraStreamRequest,
	MastraWorkflowInfo,
	MastraWorkflowRun,
	MastraWorkflowRunsListInput,
	MastraWorkflowAsyncStartRequest,
	MastraWorkflowStreamRequest,
	MastraWorkflowsResponse,
} from "./types.js";
import { joinMastraPath, normalizeMastraBaseUrl } from "./url.js";

export interface MastraHttpClientOptions {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}

export class MastraHttpClient {
	readonly baseUrl: string;
	private readonly fetchImpl: typeof fetch;

	constructor(options: MastraHttpClientOptions = {}) {
		this.baseUrl = normalizeMastraBaseUrl(options.baseUrl);
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	async listAgents(signal?: AbortSignal): Promise<MastraAgentsResponse> {
		const body = await this.getJson(agentsPath({ partial: true }), "Mastra agents request failed", signal);
		if (!isRecord(body)) {
			throw new Error("Mastra agents response was not an object");
		}
		return body as MastraAgentsResponse;
	}

	async getAgent(agentId: string, signal?: AbortSignal): Promise<MastraAgentInfo> {
		const body = await this.getJson(agentPath(agentId), "Mastra agent request failed", signal);
		if (!isRecord(body)) {
			throw new Error("Mastra agent response was not an object");
		}
		return body as MastraAgentInfo;
	}

	async listWorkflows(signal?: AbortSignal): Promise<MastraWorkflowsResponse> {
		const body = await this.getJson(workflowsPath({ partial: true }), "Mastra workflows request failed", signal);
		if (!isRecord(body)) {
			throw new Error("Mastra workflows response was not an object");
		}
		return body as MastraWorkflowsResponse;
	}

	async getWorkflow(workflowId: string, signal?: AbortSignal): Promise<MastraWorkflowInfo> {
		const body = await this.getJson(workflowPath(workflowId), "Mastra workflow request failed", signal);
		if (!isRecord(body)) {
			throw new Error("Mastra workflow response was not an object");
		}
		return body as MastraWorkflowInfo;
	}

	async getWorkflowRun(
		workflowId: string,
		runId: string,
		options: { fields?: string | string[]; withNestedWorkflows?: boolean; signal?: AbortSignal } = {},
	): Promise<MastraWorkflowRun> {
		const body = await this.getJson(
			workflowRunPath(workflowId, runId, { fields: options.fields, withNestedWorkflows: options.withNestedWorkflows }),
			"Mastra workflow run request failed",
			options.signal,
		);
		if (!isRecord(body)) {
			throw new Error("Mastra workflow run response was not an object");
		}
		return body as MastraWorkflowRun;
	}

	async listWorkflowRuns(
		workflowId: string,
		options: MastraWorkflowRunsListInput & { signal?: AbortSignal } = {},
	): Promise<MastraWorkflowRun[]> {
		const body = await this.getJson(
			workflowRunsPath(workflowId, options),
			"Mastra workflow runs request failed",
			options.signal,
		);
		if (Array.isArray(body)) return body as MastraWorkflowRun[];
		if (isRecord(body) && Array.isArray(body.runs)) return body.runs as MastraWorkflowRun[];
		throw new Error("Mastra workflow runs response was not an array");
	}

	async startWorkflowAsync(
		workflowId: string,
		runId: string,
		payload: MastraWorkflowAsyncStartRequest,
		options: { signal?: AbortSignal } = {},
	): Promise<{ runId: string }> {
		const body = await this.postJson(
			workflowStartAsyncPath(workflowId, runId),
			payload,
			"Mastra workflow async start request failed",
			options.signal,
		);
		if (isRecord(body) && typeof body.runId === "string") return { runId: body.runId };
		return { runId };
	}

	async cancelWorkflowRun(
		workflowId: string,
		runId: string,
		options: { signal?: AbortSignal } = {},
	): Promise<unknown> {
		return this.postJson(
			workflowCancelRunPath(workflowId, runId),
			{},
			"Mastra workflow cancel request failed",
			options.signal,
		);
	}

	async *streamWorkflow(
		workflowId: string,
		runId: string,
		payload: MastraWorkflowStreamRequest,
		options: { signal?: AbortSignal; timeoutMs?: number } = {},
	): AsyncGenerator<unknown> {
		yield* this.streamJsonEvents(
			workflowStreamPath(workflowId, runId),
			payload,
			"Mastra workflow stream request failed",
			options,
		);
	}

	async *observeWorkflow(
		workflowId: string,
		runId: string,
		payload: MastraWorkflowStreamRequest = {},
		options: { signal?: AbortSignal; timeoutMs?: number } = {},
	): AsyncGenerator<unknown> {
		yield* this.streamJsonEvents(
			workflowObservePath(workflowId, runId),
			payload,
			"Mastra workflow observe request failed",
			options,
		);
	}

	async *streamAgent(
		agentId: string,
		payload: MastraStreamRequest,
		options: { signal?: AbortSignal; timeoutMs?: number } = {},
	): AsyncGenerator<unknown> {
		yield* this.streamJsonEvents(agentStreamPath(agentId), payload, "Mastra stream request failed", options);
	}

	private async getJson(path: string, errorPrefix: string, signal?: AbortSignal): Promise<unknown> {
		const response = await this.fetchImpl(joinMastraPath(this.baseUrl, path), {
			headers: { accept: "application/json" },
			signal,
		});

		if (!response.ok) {
			throw new Error(`${errorPrefix}: ${response.status} ${response.statusText}`);
		}

		return (await response.json()) as unknown;
	}

	private async postJson(path: string, payload: unknown, errorPrefix: string, signal?: AbortSignal): Promise<unknown> {
		const response = await this.fetchImpl(joinMastraPath(this.baseUrl, path), {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
			},
			body: JSON.stringify(payload),
			signal,
		});

		if (!response.ok) {
			throw new Error(`${errorPrefix}: ${response.status} ${response.statusText}: ${await response.text()}`);
		}

		const text = await response.text();
		if (!text.trim()) return {};
		return JSON.parse(text) as unknown;
	}

	private async *streamJsonEvents(
		path: string,
		payload: unknown,
		errorPrefix: string,
		options: { signal?: AbortSignal; timeoutMs?: number } = {},
	): AsyncGenerator<unknown> {
		const controller = new AbortController();
		// Treat timeoutMs as an idle timeout, not a wall-clock run limit. Mastra
		// agents can legitimately run for a long time while still streaming tool
		// and text events; abort only when the SSE connection goes quiet.
		const idleTimeoutMs = options.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

		const resetTimeout = () => {
			if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
			timeoutHandle = setTimeout(
				() => controller.abort(new Error("Mastra stream timed out")),
				idleTimeoutMs,
			);
		};

		resetTimeout();
		const abortListener = () => controller.abort(options.signal?.reason);
		if (options.signal?.aborted) {
			controller.abort(options.signal.reason);
		} else {
			options.signal?.addEventListener("abort", abortListener, { once: true });
		}

		try {
			controller.signal.throwIfAborted();
			const response = await this.fetchImpl(joinMastraPath(this.baseUrl, path), {
				method: "POST",
				headers: {
					accept: "text/event-stream",
					"content-type": "application/json",
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`${errorPrefix}: ${response.status} ${response.statusText}: ${await response.text()}`);
			}
			if (!response.body) {
				throw new Error(`${errorPrefix}: response did not include a body`);
			}

			for await (const event of parseSseDataEvents(response.body)) {
				// Every valid SSE frame proves the stream is alive, so refresh the idle
				// timer before normalizing or yielding the chunk to callers.
				resetTimeout();
				if (event.data === "[DONE]") return;
				yield parseSseJsonData(event.data);
			}
		} finally {
			if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
			options.signal?.removeEventListener("abort", abortListener);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
