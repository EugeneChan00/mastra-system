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
		return normalizeWorkflowRun(body as MastraWorkflowRun);
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
		if (Array.isArray(body)) return body.map((run) => normalizeWorkflowRun(run as MastraWorkflowRun));
		if (isRecord(body) && Array.isArray(body.runs)) {
			return body.runs.map((run) => normalizeWorkflowRun(run as MastraWorkflowRun));
		}
		throw new Error("Mastra workflow runs response was not an array");
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

function normalizeWorkflowRun(run: MastraWorkflowRun): MastraWorkflowRun {
	const snapshot = parseWorkflowSnapshot(run.snapshot);
	if (!snapshot) return run;
	const normalized: MastraWorkflowRun = { ...run };
	const status = stringField(run, "status") ?? stringField(snapshot, "status") ?? workflowSnapshotCurrentState(snapshot);
	if (status) normalized.status = status;
	if (normalized.result === undefined && "result" in snapshot) normalized.result = snapshot.result;
	if (normalized.error === undefined && "error" in snapshot) normalized.error = snapshot.error;
	if (normalized.payload === undefined) {
		normalized.payload = workflowSnapshotInput(snapshot);
	}
	if (normalized.initialState === undefined && "value" in snapshot) normalized.initialState = snapshot.value;
	if (normalized.serializedStepGraph === undefined && Array.isArray(snapshot.serializedStepGraph)) {
		normalized.serializedStepGraph = snapshot.serializedStepGraph as Array<Record<string, unknown>>;
	}
	return normalized;
}

function parseWorkflowSnapshot(value: unknown): Record<string, unknown> | undefined {
	if (isRecord(value)) return value;
	if (typeof value !== "string") return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function workflowSnapshotInput(snapshot: Record<string, unknown>): unknown {
	const context = snapshot.context;
	if (isRecord(context) && "input" in context) return context.input;
	if ("input" in snapshot) return snapshot.input;
	return undefined;
}

function workflowSnapshotCurrentState(snapshot: Record<string, unknown>): string | undefined {
	const value = snapshot.value;
	if (isRecord(value)) return stringField(value, "currentState");
	return undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}
