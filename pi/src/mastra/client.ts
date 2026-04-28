import { DEFAULT_STREAM_TIMEOUT_MS, agentsPath, agentStreamPath } from "../const.js";
import { parseSseDataEvents, parseSseJsonData } from "./sse.js";
import type { MastraAgentsResponse, MastraStreamRequest } from "./types.js";
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
		const response = await this.fetchImpl(joinMastraPath(this.baseUrl, agentsPath()), {
			headers: { accept: "application/json" },
			signal,
		});

		if (!response.ok) {
			throw new Error(`Mastra agents request failed: ${response.status} ${response.statusText}`);
		}

		const body = (await response.json()) as unknown;
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			throw new Error("Mastra agents response was not an object");
		}
		return body as MastraAgentsResponse;
	}

	async *streamAgent(
		agentId: string,
		payload: MastraStreamRequest,
		options: { signal?: AbortSignal; timeoutMs?: number } = {},
	): AsyncGenerator<unknown> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(new Error("Mastra stream timed out")), options.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS);
		const abortListener = () => controller.abort(options.signal?.reason);
		options.signal?.addEventListener("abort", abortListener, { once: true });

		try {
			const response = await this.fetchImpl(joinMastraPath(this.baseUrl, agentStreamPath(agentId)), {
				method: "POST",
				headers: {
					accept: "text/event-stream",
					"content-type": "application/json",
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`Mastra stream request failed: ${response.status} ${response.statusText}: ${await response.text()}`);
			}
			if (!response.body) {
				throw new Error("Mastra stream response did not include a body");
			}

			for await (const event of parseSseDataEvents(response.body)) {
				if (event.data === "[DONE]") return;
				yield parseSseJsonData(event.data);
			}
		} finally {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", abortListener);
		}
	}
}

