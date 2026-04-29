import assert from "node:assert/strict";
import test from "node:test";
import { MASTRA_AGENT_QUERY_TOOL_NAME, MASTRA_AGENT_RESULT_MESSAGE_TYPE, MASTRA_PI_AGENT_JOB_WORKFLOW_ID, MASTRA_STATUS_KEY } from "../const.js";
import type { MastraAgentAsyncJobSummary } from "../mastra/index.js";
import mastraPiExtension, { completionJobIdFromMessageEnd, formatAsyncAgentCompletion, hasCompletionReminder } from "./index.js";

const stubTheme: Record<string, (...args: string[]) => string> = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	dim: (text: string) => text,
};

test("formatAsyncAgentCompletion emits a system reminder with queued lifecycle and artifact chaining hint", () => {
	const text = formatAsyncAgentCompletion(fakeSummary({
		jobId: "job-1",
		jobName: "audit",
		agentId: "validator-agent",
		status: "done",
		lifecycleStatus: "agent_response_queued",
		threadId: "thread-1",
		runId: "run-1",
		artifactPath: "/tmp/output.txt",
		toolCalls: 1,
		toolResults: 1,
	}));

	assert.ok(text.startsWith("<system-reminder>\n"));
	assert.ok(text.endsWith("\n</system-reminder>"));
	assert.match(text, /Asynchronous Mastra agent task completed: job-1/);
	assert.match(text, /lifecycleStatus: agent_response_queued/);
	assert.match(text, /threadId: thread-1/);
	assert.match(text, /runId: run-1/);
	assert.match(text, /artifactPath: \/tmp\/output.txt/);
	assert.match(text, /Use agent_read with jobId=job-1/);
	assert.match(text, /artifactPath can be passed as an input_args value/);
});

test("completionJobIdFromMessageEnd only accepts matching custom completion messages", () => {
	assert.equal(
		completionJobIdFromMessageEnd({
			message: {
				role: "custom",
				customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE,
				details: { jobId: "job-1" },
			},
		}),
		"job-1",
	);
	assert.equal(
		completionJobIdFromMessageEnd({
			message: {
				role: "custom",
				customType: "other",
				details: { jobId: "job-1" },
			},
		}),
		undefined,
	);
	assert.equal(
		completionJobIdFromMessageEnd({
			message: {
				role: "assistant",
				customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE,
				details: { jobId: "job-1" },
			},
		}),
		undefined,
	);
	assert.equal(completionJobIdFromMessageEnd({ message: { role: "custom", customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE, details: {} } }), undefined);
});

test("hasCompletionReminder matches persisted custom completion entries by job id", () => {
	const entries = [
		{ type: "custom_message", customType: "other", details: { jobId: "job-1" } },
		{ type: "assistant_message", customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE, details: { jobId: "job-1" } },
		{ type: "custom_message", customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE, details: { jobId: "job-2" } },
	];

	assert.equal(hasCompletionReminder(entries, "job-1"), false);
	assert.equal(hasCompletionReminder(entries, "job-2"), true);
});

test("extension queues async agent completion as steer reminder and message_end collapses activity", async () => {
	const originalFetch = globalThis.fetch;
	const registeredTools: any[] = [];
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const sentMessages: Array<{ message: any; options: any }> = [];
	const statusCalls: Array<{ key: string; value: string }> = [];
	let widgetFactory: ((tui: any, theme: any) => any) | undefined;

	globalThis.fetch = (async (url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
		const requestUrl = String(url);
		if (requestUrl.endsWith("/agents?partial=true")) {
			return new Response(JSON.stringify({ "validator-agent": { id: "validator-agent", name: "Validator" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (requestUrl.endsWith("/workflows?partial=true")) {
			return new Response(JSON.stringify({ [MASTRA_PI_AGENT_JOB_WORKFLOW_ID]: { steps: {}, allSteps: {}, stepGraph: [] } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (requestUrl.includes(`/workflows/${encodeURIComponent(MASTRA_PI_AGENT_JOB_WORKFLOW_ID)}/runs?`)) {
			return new Response(JSON.stringify({ runs: [] }), { status: 200, headers: { "content-type": "application/json" } });
		}
		if (requestUrl.includes(`/workflows/${encodeURIComponent(MASTRA_PI_AGENT_JOB_WORKFLOW_ID)}/stream?`)) {
			return new Response(
				`data: ${JSON.stringify({ type: "pi-agent-stream-chunk", payload: { chunk: { type: "finish" } } })}\n\ndata: [DONE]\n\n`,
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			);
		}
		if (requestUrl.includes(`/workflows/${encodeURIComponent(MASTRA_PI_AGENT_JOB_WORKFLOW_ID)}/runs/`)) {
			return new Response(
				JSON.stringify({
					workflowName: MASTRA_PI_AGENT_JOB_WORKFLOW_ID,
					runId: requestUrl.split("/runs/")[1]?.split("?")[0] ?? "run",
					status: "success",
					result: { text: "extension result" },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		return new Response("not found", { status: 404, statusText: "Not Found" });
	}) as typeof fetch;

	try {
		const pi = {
			registerTool(tool: any) {
				registeredTools.push(tool);
			},
			registerMessageRenderer() {},
			registerCommand() {},
			on(event: string, handler: (...args: any[]) => unknown) {
				handlers.set(event, handler);
			},
			sendMessage(message: any, options: any) {
				sentMessages.push({ message, options });
			},
		};
		mastraPiExtension(pi as any);

		const sessionStart = handlers.get("session_start");
		assert.equal(typeof sessionStart, "function");
		await sessionStart?.(
			{},
			{
				cwd: "/workspace/project",
				hasUI: true,
				sessionManager: {
					getSessionId: () => "session-extension",
					getEntries: () => [],
				},
				ui: {
					notify() {},
					setWidget(_id: string, factory: (tui: any, theme: any) => any) {
						widgetFactory = factory;
					},
					setStatus(key: string, value: string) {
						statusCalls.push({ key, value });
					},
				},
			},
		);
		assert.equal(typeof widgetFactory, "function");
		const widget = widgetFactory!({ requestRender() {} }, stubTheme as any);

		const queryTool = registeredTools.find((tool) => tool.name === MASTRA_AGENT_QUERY_TOOL_NAME);
		assert.ok(queryTool, "agent_query tool should be registered by the extension");
		await queryTool.execute("call", { agentId: "validator-agent", message: "prompt", jobName: "extension job" });

		await waitFor(() => sentMessages.length === 1);
		const sent = sentMessages[0];
		assert.deepEqual(sent.options, { deliverAs: "steer", triggerTurn: true });
		assert.equal(sent.message.customType, MASTRA_AGENT_RESULT_MESSAGE_TYPE);
		assert.equal(sent.message.display, true);
		assert.match(sent.message.content, /^<system-reminder>\nAsynchronous Mastra agent task completed:/);
		assert.equal(sent.message.details.lifecycleStatus, "agent_response_queued");
		assert.equal(sent.message.details.status, "done");
		assert.ok(statusCalls.some((call) => call.key === MASTRA_STATUS_KEY && call.value === "mastra: 1 running"));
		assert.ok(widget.render(100).some((line: string) => line.includes("Mastra: validator-agent")), "queued completion should keep widget card visible");

		const messageEnd = handlers.get("message_end");
		assert.equal(typeof messageEnd, "function");
		await messageEnd?.({
			message: {
				role: "custom",
				customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE,
				details: { jobId: "other-job" },
			},
		});
		assert.ok(widget.render(100).some((line: string) => line.includes("Mastra: validator-agent")), "unmatched message_end should not collapse the card");

		await messageEnd?.({
			message: {
				role: "custom",
				customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE,
				details: { jobId: sent.message.details.jobId },
			},
		});

		assert.equal(statusCalls.at(-1)?.key, MASTRA_STATUS_KEY);
		assert.equal(statusCalls.at(-1)?.value, "mastra: 1 agents, 1 workflows");
		assert.deepEqual(widget.render(100), []);
		widget.dispose();
	} finally {
		globalThis.fetch = originalFetch;
	}
});

function fakeSummary(overrides: Partial<MastraAgentAsyncJobSummary> = {}): MastraAgentAsyncJobSummary {
	return {
		jobId: "job",
		jobName: "job",
		agentId: "agent",
		threadId: "thread",
		resourceId: "resource",
		status: "done",
		lifecycleStatus: "agent_response_queued",
		textPreview: "",
		toolCalls: 0,
		toolResults: 0,
		rawChunkCount: 0,
		chunksTruncated: false,
		errors: [],
		...overrides,
	};
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for predicate");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
