import assert from "node:assert/strict";
import test from "node:test";
import {
	MastraAsyncAgentManager,
	createMastraAgentInspectTool,
	createMastraAgentQueryTool,
	createMastraTools,
	createStreamRequest,
	createWorkflowStreamRequest,
	normalizeInspectAgentIds,
	MASTRA_AGENT_QUERY_PARAMETERS,
} from "./tool.js";
import { MASTRA_PI_AGENT_JOB_WORKFLOW_ID } from "../const.js";
import { MastraAgentActivityStore } from "../tui/index.js";
import { MastraHttpClient } from "./client.js";
import { defaultResourceId } from "./memory.js";

test("omitted modeId leaves requestContext unchanged", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "hello", requestContext: { tenant: "a" } },
		"thread",
		"resource",
	);
	assert.deepEqual(request.requestContext, { tenant: "a" });
});

test("input_args preserves literal placeholders in message and appends Input arguments section", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "Hello $1, you selected $2", input_args: { $1: "Alice", $2: "Option A" } },
		"thread",
		"resource",
	);
	// Literal placeholders preserved in message body; Input arguments section appended with bullet list and instruction
	assert.equal(
		request.messages[0].content,
		"Hello $1, you selected $2\n\nInput arguments:\n- $1: Alice\n- $2: Option A\n\nWhen the prompt references placeholders like $1, $2, etc., use the corresponding input argument above.",
	);
});

test("input_args preserves placeholders and sorts keys numerically ($1, $2, $10)", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "Process $2 and $1 and $10", input_args: { $1: "first", $2: "second", $10: "tenth" } },
		"thread",
		"resource",
	);
	// Literal placeholders preserved; Input arguments section sorted numerically ($1, $2, $10 not $1, $10, $2) with bullet list and instruction
	assert.equal(
		request.messages[0].content,
		"Process $2 and $1 and $10\n\nInput arguments:\n- $1: first\n- $2: second\n- $10: tenth\n\nWhen the prompt references placeholders like $1, $2, etc., use the corresponding input argument above.",
	);
});

test("input_args mirrors into requestContext.input_args", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "Hello $1", input_args: { $1: "World" } },
		"thread",
		"resource",
	);
	assert.deepEqual(request.requestContext, { input_args: { $1: "World" } });
});

test("input_args appears as top-level field in returned request", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "Hello $1", input_args: { $1: "World" } },
		"thread",
		"resource",
	);
	assert.deepEqual(request.input_args, { $1: "World" });
});

test("input_args omitted returns no input_args in request", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "Hello World" },
		"thread",
		"resource",
	);
	assert.equal(request.input_args, undefined);
	assert.equal(request.requestContext?.input_args, undefined);
});

test("top-level input_args overrides existing requestContext.input_args", () => {
	const request = createStreamRequest(
		{
			agentId: "agent",
			message: "Hello $1",
			input_args: { $1: "New" },
			requestContext: { input_args: { $1: "Old" }, tenant: "acme" },
		},
		"thread",
		"resource",
	);
	assert.deepEqual(request.requestContext, { input_args: { $1: "New" }, tenant: "acme" });
});

test("input_args preserves other requestContext fields", () => {
	const request = createStreamRequest(
		{
			agentId: "agent",
			message: "Hello $1",
			input_args: { $1: "World" },
			requestContext: { modeId: "test", tenant: "acme" },
		},
		"thread",
		"resource",
	);
	assert.deepEqual(request.requestContext, { input_args: { $1: "World" }, modeId: "test", tenant: "acme" });
});

test("input_args with empty input_args object does not append section", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "Hello World", input_args: {} },
		"thread",
		"resource",
	);
	assert.equal(request.messages[0].content, "Hello World");
	assert.equal(request.requestContext?.input_args, undefined);
});

test("input_args validates placeholder keys match pattern ^\\$[1-9][0-9]*$", () => {
	// Empty key
	assert.throws(
		() =>
			createStreamRequest(
				{ agentId: "agent", message: "Hello", input_args: { "": "value" } as any },
				"thread",
				"resource",
			),
		/input_args placeholder key must match pattern/,
	);
	// Invalid key $0 (zero not allowed)
	assert.throws(
		() =>
			createStreamRequest(
				{ agentId: "agent", message: "Hello", input_args: { $0: "value" } as any },
				"thread",
				"resource",
			),
		/input_args placeholder key must match pattern/,
	);
	// Non-numeric key $abc
	assert.throws(
		() =>
			createStreamRequest(
				{ agentId: "agent", message: "Hello", input_args: { $abc: "value" } as any },
				"thread",
				"resource",
			),
		/input_args placeholder key must match pattern/,
	);
});

test("modeId is forwarded to requestContext.modeId", () => {
	const request = createStreamRequest({ agentId: "agent", message: "hello", modeId: "plan" }, "thread", "resource");
	assert.deepEqual(request.requestContext, { modeId: "plan" });
});

test("top-level modeId overrides requestContext.modeId", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "hello", modeId: "implement", requestContext: { modeId: "old" } },
		"thread",
		"resource",
	);
	assert.deepEqual(request.requestContext, { modeId: "implement" });
});

test("harness-mode is forwarded to requestContext.harnessMode", () => {
	const request = createStreamRequest({ agentId: "agent", message: "hello", "harness-mode": "build" }, "thread", "resource");
	assert.deepEqual(request.requestContext, { harnessMode: "build" });
	assert.equal(request.harnessMode, "build");
});

test("top-level harness-mode overrides requestContext.harnessMode", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "hello", "harness-mode": "audit", requestContext: { harnessMode: "old" } },
		"thread",
		"resource",
	);
	assert.deepEqual(request.requestContext, { harnessMode: "audit" });
});

test("harnessModeId is accepted as resolved Harness mode context", () => {
	const request = createStreamRequest({ agentId: "agent", message: "hello", harnessModeId: "developer.build" }, "thread", "resource");
	assert.deepEqual(request.requestContext, { harnessMode: "developer.build", harnessModeId: "developer.build" });
	assert.equal(request.harnessMode, "developer.build");
	assert.equal(request.harnessModeId, "developer.build");
});

test("deprecated hardnessMode is still forwarded as compatibility context", () => {
	const request = createStreamRequest({ agentId: "agent", message: "hello", hardnessMode: "developer" }, "thread", "resource");
	assert.deepEqual(request.requestContext, { harnessMode: "developer", hardnessMode: "developer" });
	assert.equal(request.harnessMode, "developer");
	assert.equal(request.hardnessMode, "developer");
});

test("uses Mastra memory payload shape", () => {
	const request = createStreamRequest({ agentId: "agent", message: "hello" }, "thread", "resource");
	assert.deepEqual(request.memory, { thread: "thread", resource: "resource" });
	assert.deepEqual(request.messages, [{ role: "user", content: "hello" }]);
});

test("async agent manager uses unique default threads for concurrent jobs", async () => {
	const requests: any[] = [];
	const manager = new MastraAsyncAgentManager({
		async *streamAgent(_agentId: string, request: unknown) {
			requests.push(request);
			yield { type: "finish" };
		},
	} as any);

	await manager.start({ agentId: "agent", message: "first", jobId: "job-one", finalMessage: false });
	await manager.start({ agentId: "agent", message: "second", jobId: "job-two", finalMessage: false });

	await waitFor(() => requests.length === 2);
	assert.notEqual(requests[0].memory.thread, requests[1].memory.thread);
	assert.match(requests[0].memory.thread, /^pi-local-session-job-one-agent-pi-[a-f0-9]{12}$/);
	assert.match(requests[1].memory.thread, /^pi-local-session-job-two-agent-pi-[a-f0-9]{12}$/);
});

test("async agent manager uses configured Pi session in derived thread and run ids", async () => {
	const requests: any[] = [];
	const manager = new MastraAsyncAgentManager({
		async *streamAgent(_agentId: string, request: unknown) {
			requests.push(request);
			yield { type: "finish" };
		},
	} as any);
	manager.configureSession({ piSessionId: "session-abc", cwd: "/workspace/project" });

	await manager.start({ agentId: "validator-agent", message: "check this", jobId: "job-one", jobName: "review pass", finalMessage: false });

	await waitFor(() => requests.length === 1);
	const summary = manager.get("job-one");
	const resourceId = defaultResourceId("/workspace/project");
	assert.equal(summary?.piSessionId, "session-abc");
	assert.equal(summary?.resourceId, resourceId);
	assert.equal(requests[0].memory.resource, resourceId);
	assert.equal(requests[0].memory.thread, `pi-session-abc-review-pass-validator-agent-${resourceId.replace(":", "-")}`);
	assert.equal(summary?.threadId, requests[0].memory.thread);
	assert.equal(summary?.runId, `pi-session-abc-review-pass-validator-agent-${resourceId.replace(":", "-")}-job-one`);
});


test("createMastraTools registers agent_query and preserves workflow tools", () => {
	const manager = { start: async () => fakeAsyncSummary() } as any;
	const tools = createMastraTools({} as any, { asyncAgentManager: manager });
	const names = tools.map((tool) => tool.name);
	assert.equal(names[0], "agent_query");
	assert.equal((tools[0] as any).renderShell, "self");
	assert.equal(names.includes("agent_call"), false);
	assert.equal(names.includes("agent_start"), false);
	assert.equal(names.includes("agent_list"), false);
	assert.equal(names.includes("agent_status"), false);
	assert.equal(names.includes("agent_async_status"), false);
	assert.ok(names.includes("agent_inspect"));
	assert.ok(names.includes("workflow_call"));
	assert.ok(names.includes("workflow_list"));
	assert.ok(names.includes("workflow_status"));
});

test("agent_query schema is narrower than lower-level agent tools", () => {
	const properties = (MASTRA_AGENT_QUERY_PARAMETERS as any).properties;
	for (const key of ["agentId", "message", "jobName", "synchronous", "harness-mode", "hardnessMode", "threadId", "resourceId", "requestContext", "includeToolResults", "includeReasoning", "timeoutMs", "input_args"]) {
		assert.ok(key in properties, `${key} should be exposed`);
	}
	assert.equal("maxSteps" in properties, false);
	assert.equal("activeTools" in properties, false);
	assert.equal("modeId" in properties, false);
	assert.equal("jobId" in properties, false);
	assert.equal("finalMessage" in properties, false);
});

test("agent_query defaults to async and returns a job handle", async () => {
	const starts: any[] = [];
	const tool = createMastraAgentQueryTool({
		start: async (params: any) => {
			starts.push(params);
			return fakeAsyncSummary({ jobId: "query-job", agentId: params.agentId, threadId: "thread", resourceId: "resource" });
		},
	} as any, {} as any);

	const result = await tool.execute("call", { agentId: "agent", message: "hello" });
	assert.equal(starts.length, 1);
	assert.equal(starts[0].includeReasoning, false);
	assert.equal(starts[0].finalMessage, true);
	assert.equal("maxSteps" in starts[0], false);
	assert.equal("activeTools" in starts[0], false);
	assert.equal((result.details as any).jobId, "query-job");
	assert.match("text" in result.content[0] ? result.content[0].text : "", /Started async Mastra agent job: query-job/);
});

test("agent_query async path passes supported options through", async () => {
	const starts: any[] = [];
	const tool = createMastraAgentQueryTool({
		start: async (params: any) => {
			starts.push(params);
			return fakeAsyncSummary({ agentId: params.agentId, threadId: params.threadId, resourceId: params.resourceId });
		},
	} as any, {} as any);

	await tool.execute("call", {
		agentId: "agent",
		message: "hello $1",
		jobName: "review-pass",
		"harness-mode": "build",
		threadId: "thread-x",
		resourceId: "resource-x",
		requestContext: { tenant: "acme" },
		includeReasoning: true,
		includeToolResults: true,
		timeoutMs: 123,
		input_args: { $1: "world" },
	});

	assert.equal(starts[0].includeReasoning, true);
	assert.equal(starts[0].includeToolResults, true);
	assert.equal(starts[0].jobName, "review-pass");
	assert.equal(starts[0].harnessMode, "build");
	assert.equal(starts[0].threadId, "thread-x");
	assert.equal(starts[0].resourceId, "resource-x");
	assert.equal(starts[0].timeoutMs, 123);
	assert.deepEqual(starts[0].requestContext, { tenant: "acme" });
	assert.deepEqual(starts[0].input_args, { $1: "world" });
});

test("agent_query supports synchronous execution and input_args formatting", async () => {
	const requests: any[] = [];
	const tool = createMastraAgentQueryTool({
		start: async () => {
			throw new Error("async start should not be used for synchronous query");
		},
	} as any, {
		async *streamAgent(agentId: string, request: unknown) {
			requests.push({ agentId, request });
			yield { type: "text-delta", text: "answer" };
			yield { type: "reasoning-delta", text: "hidden" };
			yield { type: "finish" };
		},
	} as any);

	const result = await tool.execute("call", {
		agentId: "agent",
		message: "Use $1",
		synchronous: true,
		"harness-mode": "audit",
		requestContext: { tenant: "acme" },
		input_args: { $1: "value" },
	});

	assert.equal((result.details as any).text, "answer");
	assert.equal("text" in result.content[0] ? result.content[0].text.includes("Reasoning:" ) : true, false);
	assert.equal(requests[0].agentId, "agent");
	assert.match(requests[0].request.messages[0].content, /Use \$1\n\nInput arguments:\n- \$1: value/);
	assert.deepEqual(requests[0].request.requestContext, { tenant: "acme", harnessMode: "audit", input_args: { $1: "value" } });
});

test("agent_query renderers distinguish async summaries and sync details", () => {
	const tool = createMastraAgentQueryTool({ start: async () => fakeAsyncSummary() } as any, {} as any) as any;
	const asyncCallLines = tool.renderCall({ agentId: "agent", message: "hello" }, stubTheme).render(80).join("\n");
	const syncCallLines = tool.renderCall({ agentId: "agent", message: "hello", synchronous: true }, stubTheme).render(80).join("\n");
	assert.match(asyncCallLines, /mastra query/);
	assert.match(asyncCallLines, /agent/);
	assert.match(asyncCallLines, /mode=async/);
	assert.match(syncCallLines, /mode=sync/);

	const asyncLines = tool
		.renderResult({ content: [{ type: "text", text: "started" }], details: fakeAsyncSummary() }, {}, stubTheme)
		.render(80);
	assert.deepEqual(asyncLines, []);

	const syncLines = tool
		.renderResult({ content: [{ type: "text", text: "answer" }], details: fakeCallDetails({ text: "answer" }) }, {}, stubTheme)
		.render(80);
	assert.ok(syncLines.length > 0);
	assert.ok(syncLines.join("\n").includes("answer"));
});

test("async agent manager honors explicit thread ids", async () => {
	const requests: any[] = [];
	const manager = new MastraAsyncAgentManager({
		async *streamAgent(_agentId: string, request: unknown) {
			requests.push(request);
			yield { type: "finish" };
		},
	} as any);

	await manager.start({ agentId: "agent", message: "first", jobId: "job-one", threadId: "shared-thread", finalMessage: false });
	await manager.start({ agentId: "agent", message: "second", jobId: "job-two", threadId: "shared-thread", finalMessage: false });

	await waitFor(() => requests.length === 2);
	assert.equal(requests[0].memory.thread, "shared-thread");
	assert.equal(requests[1].memory.thread, "shared-thread");
});

test("async agent manager starts immediately and captures streamed output", async () => {
	let updates = 0;
	const sinkEvents: string[] = [];
	const completions: any[] = [];
	const manager = new MastraAsyncAgentManager(
		{
			async *streamAgent() {
				yield { type: "text-delta", text: "hello" };
				yield { type: "text-delta", text: " world" };
				yield { type: "finish", usage: { totalTokens: 3 } };
			},
		} as any,
		{
			activitySink: {
				start() {
					sinkEvents.push("start");
				},
				update() {
					updates += 1;
					sinkEvents.push("update");
				},
				finish() {
					sinkEvents.push("finish");
				},
			},
			onComplete(summary) {
				completions.push(summary);
			},
		},
	);

	const started = await manager.start({ agentId: "agent", message: "prompt", jobId: "test-job", finalMessage: true });
	assert.equal(started.jobId, "test-job");
	assert.equal(started.status, "running");

	await waitFor(() => {
		const job = manager.get("test-job");
		return job?.status === "done";
	});
	const summary = manager.get("test-job");
	assert.equal(summary?.status, "done");
	assert.equal(summary?.lifecycleStatus, "agent_response_queued");
	assert.equal(summary?.prompt, "prompt");
	assert.ok(updates >= 2);
	assert.deepEqual(sinkEvents.filter((event) => event === "finish"), ["finish"]);
	assert.equal(completions.length, 1, "onComplete should fire once when finalMessage: true");
	assert.equal(completions[0].lifecycleStatus, "agent_response_queued");

	const output = await manager.read({ jobId: "test-job", mode: "full" });
	assert.equal(output.text, "hello world");
});

test("async agent manager drives workflow jobs through working to queued completion", async () => {
	const workflowStarts: any[] = [];
	const workflowObserves: any[] = [];
	const workflowRunReads: any[] = [];
	const sinkEvents: string[] = [];
	const completions: any[] = [];
	const manager = new MastraAsyncAgentManager(
		{
			async *streamWorkflow(workflowId: string, runId: string, payload: unknown) {
				workflowStarts.push({ workflowId, runId, payload });
				yield { type: "pi-agent-stream-chunk", payload: { chunk: { type: "text-delta", text: "hello" } } };
				yield { type: "pi-agent-stream-chunk", payload: { chunk: { type: "finish", usage: { totalTokens: 7 } } } };
			},
			async *observeWorkflow(workflowId: string, runId: string, payload: unknown) {
				workflowObserves.push({ workflowId, runId, payload });
			},
			async getWorkflowRun(workflowId: string, runId: string) {
				workflowRunReads.push({ workflowId, runId });
				return {
					workflowName: workflowId,
					runId,
					status: "success",
					result: { text: "final from workflow", artifactPath: "/tmp/output.txt", eventsPath: "/tmp/events.jsonl" },
				};
			},
		} as any,
		{
			activitySink: {
				start() {
					sinkEvents.push("start");
				},
				update() {
					sinkEvents.push("update");
				},
				finish() {
					sinkEvents.push("finish");
				},
			},
			onComplete(summary) {
				completions.push(summary);
			},
		},
	);
	manager.configureSession({ piSessionId: "session-abc", cwd: "/workspace/project" });

	const started = await manager.start({
		agentId: "validator-agent",
		message: "audit this",
		jobId: "workflow-job",
		jobName: "audit slice",
		requestContext: { tenant: "acme" },
		input_args: { $1: "context" },
	});

	assert.equal(started.lifecycleStatus, "working");
	assert.equal(started.status, "running");

	await waitFor(() => manager.get("workflow-job")?.lifecycleStatus === "agent_response_queued");
	const summary = manager.get("workflow-job");
	const startPayload = workflowStarts[0].payload;
	assert.equal(workflowStarts.length, 1);
	assert.equal(workflowStarts[0].workflowId, MASTRA_PI_AGENT_JOB_WORKFLOW_ID);
	assert.equal(startPayload.resourceId, defaultResourceId("/workspace/project"));
	assert.equal(startPayload.inputData.jobId, "workflow-job");
	assert.equal(startPayload.inputData.jobName, "audit-slice");
	assert.equal(startPayload.inputData.piSessionId, "session-abc");
	assert.equal(startPayload.inputData.runId, summary?.runId);
	assert.equal(startPayload.inputData.agentRunId, startPayload.inputData.runId);
	assert.equal(startPayload.inputData.threadId, summary?.threadId);
	assert.equal(startPayload.inputData.resourceId, summary?.resourceId);
	assert.deepEqual(startPayload.inputData.requestContext, { tenant: "acme" });
	assert.deepEqual(startPayload.inputData.input_args, { $1: "context" });
	assert.equal(workflowObserves.length, 0);
	assert.equal(workflowRunReads.length, 1);
	assert.equal(summary?.status, "done");
	assert.equal(summary?.lifecycleStatus, "agent_response_queued");
	assert.equal(summary?.textPreview, "hello");
	assert.equal(summary?.artifactPath, "/tmp/output.txt");
	assert.equal(summary?.eventsPath, "/tmp/events.jsonl");
	assert.ok(sinkEvents.filter((event) => event === "update").length >= 2, "workflow chunks should update the live activity card");
	assert.deepEqual(sinkEvents.filter((event) => event === "finish"), ["finish"]);
	assert.equal(completions.length, 1);
	assert.equal(completions[0].lifecycleStatus, "agent_response_queued");
});

test("async agent manager streams workflow jobs with deterministic run id and recovers final result text", async () => {
	const streamCalls: any[] = [];
	const getRunCalls: any[] = [];
	const manager = new MastraAsyncAgentManager({
		async *streamWorkflow(workflowId: string, runId: string, payload: unknown) {
			streamCalls.push({ workflowId, runId, payload });
			yield { type: "workflow-finish", payload: { workflowStatus: "success" } };
		},
		async getWorkflowRun(workflowId: string, runId: string) {
			getRunCalls.push({ workflowId, runId });
			return { workflowName: workflowId, runId, status: "success", result: { text: "final result text" } };
		},
	} as any);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "canonical-job", jobName: "canonical" });
	await waitFor(() => manager.get("canonical-job")?.lifecycleStatus === "agent_response_queued");

	const summary = manager.get("canonical-job");
	assert.equal(streamCalls[0].runId, summary?.runId);
	assert.equal(getRunCalls[0].runId, summary?.runId);
	assert.equal(summary?.status, "done");
	assert.equal(summary?.textPreview, "final result text");
});

test("async agent manager treats agent-level workflow output errors as failed jobs", async () => {
	const manager = new MastraAsyncAgentManager({
		async *streamWorkflow() {
			yield { type: "workflow-finish", payload: { workflowStatus: "success" } };
		},
		async getWorkflowRun(workflowId: string, runId: string) {
			return {
				workflowName: workflowId,
				runId,
				status: "success",
				result: { status: "error", text: "partial output", errors: ["agent failed"] },
			};
		},
	} as any);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "output-error-job", jobName: "output error" });
	await waitFor(() => manager.get("output-error-job")?.lifecycleStatus === "agent_response_queued");

	const summary = manager.get("output-error-job");
	assert.equal(summary?.status, "error");
	assert.equal(summary?.textPreview, "partial output");
	assert.ok(summary?.errors.includes("agent failed"));
});

test("async agent manager surfaces workflow failure as queued completion", async () => {
	const completions: any[] = [];
	const manager = new MastraAsyncAgentManager(
		{
			async *streamWorkflow() {
				yield { type: "workflow-finish", payload: { workflowStatus: "failed" } };
			},
			async getWorkflowRun(workflowId: string, runId: string) {
				return { workflowName: workflowId, runId, status: "failed", error: "boom" };
			},
		} as any,
		{
			onComplete(summary) {
				completions.push(summary);
			},
		},
	);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "failed-workflow" });
	await waitFor(() => manager.get("failed-workflow")?.lifecycleStatus === "agent_response_queued");

	const summary = manager.get("failed-workflow");
	assert.equal(summary?.status, "error");
	assert.equal(summary?.lifecycleStatus, "agent_response_queued");
	assert.match(summary?.errors.join("\n") ?? "", /failed|boom/);
	assert.equal(completions.length, 1);
	assert.equal(completions[0].status, "error");
});

test("async agent manager detachAll aborts workflow observers without queueing completion", async () => {
	let observeStarted = false;
	let completed = false;
	const sinkEvents: string[] = [];
	const manager = new MastraAsyncAgentManager(
		{
			async *streamWorkflow(_workflowId: string, _runId: string, _payload: unknown, options: { signal?: AbortSignal } = {}) {
				observeStarted = true;
				await new Promise((_resolve, reject) => {
					options.signal?.addEventListener("abort", () => reject(options.signal?.reason ?? new Error("aborted")), { once: true });
				});
			},
			async getWorkflowRun(workflowId: string, runId: string) {
				return { workflowName: workflowId, runId, status: "running" };
			},
		} as any,
		{
			activitySink: {
				start() {
					sinkEvents.push("start");
				},
				update() {
					sinkEvents.push("update");
				},
				finish() {
					sinkEvents.push("finish");
				},
				end() {
					sinkEvents.push("end");
				},
				reset() {
					sinkEvents.push("reset");
				},
			},
			onComplete() {
				completed = true;
			},
		},
	);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "detach-workflow" });
	await waitFor(() => observeStarted);
	manager.detachAll("test shutdown");
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(manager.get("detach-workflow"), undefined);
	assert.deepEqual(sinkEvents.filter((event) => event === "finish"), []);
	assert.deepEqual(sinkEvents.filter((event) => event === "end"), ["end"]);
	assert.deepEqual(sinkEvents.filter((event) => event === "reset"), ["reset"]);
	assert.equal(completed, false);
});

test("async agent manager detachAll also stops direct fallback jobs without completion", async () => {
	let streamStarted = false;
	let completed = false;
	const sinkEvents: string[] = [];
	const manager = new MastraAsyncAgentManager(
		{
			async *streamAgent(_agentId: string, _request: unknown, options: { signal?: AbortSignal } = {}) {
				streamStarted = true;
				await new Promise((_resolve, reject) => {
					options.signal?.addEventListener("abort", () => reject(options.signal?.reason ?? new Error("aborted")), { once: true });
				});
			},
		} as any,
		{
			activitySink: {
				start() {
					sinkEvents.push("start");
				},
				update() {
					sinkEvents.push("update");
				},
				finish() {
					sinkEvents.push("finish");
				},
				end() {
					sinkEvents.push("end");
				},
				reset() {
					sinkEvents.push("reset");
				},
			},
			onComplete() {
				completed = true;
			},
			useWorkflowJobs: false,
		},
	);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "detach-direct" });
	await waitFor(() => streamStarted);
	manager.detachAll("test shutdown");
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(manager.get("detach-direct"), undefined);
	assert.deepEqual(sinkEvents.filter((event) => event === "finish"), []);
	assert.deepEqual(sinkEvents.filter((event) => event === "end"), ["end"]);
	assert.deepEqual(sinkEvents.filter((event) => event === "reset"), ["reset"]);
	assert.equal(completed, false);
});

test("async agent manager cancellation keeps late direct stream updates out of activity store", async () => {
	const activityStore = new MastraAgentActivityStore();
	let streamStarted = false;
	const manager = new MastraAsyncAgentManager(
		{
			async *streamAgent(_agentId: string, _request: unknown, options: { signal?: AbortSignal } = {}) {
				streamStarted = true;
				yield { type: "text-delta", text: "started" };
				await new Promise<void>((resolve) => {
					options.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				yield { type: "text-delta", text: "late update after cancel" };
			},
		} as any,
		{
			activitySink: activityStore,
			useWorkflowJobs: false,
		},
	);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "cancel-direct-late" });
	await waitFor(() => streamStarted && activityStore.snapshot().length === 1);
	const summary = await manager.cancel("cancel-direct-late", "stop now");
	assert.equal(summary?.lifecycleStatus, "ended");
	assert.deepEqual(activityStore.snapshot(), []);

	await waitFor(() => manager.get("cancel-direct-late")?.status === "aborted");
	assert.deepEqual(activityStore.snapshot(), []);
});

test("async agent manager cancels workflow jobs without queueing a completion reminder", async () => {
	const cancelCalls: any[] = [];
	let observeStarted = false;
	let completed = false;
	const sinkEvents: string[] = [];
	const manager = new MastraAsyncAgentManager(
		{
			async *streamWorkflow(_workflowId: string, _runId: string, _payload: unknown, options: { signal?: AbortSignal } = {}) {
				observeStarted = true;
				await new Promise((_resolve, reject) => {
					options.signal?.addEventListener("abort", () => reject(options.signal?.reason ?? new Error("aborted")), { once: true });
				});
			},
			async getWorkflowRun(workflowId: string, runId: string) {
				return { workflowName: workflowId, runId, status: "running" };
			},
			async cancelWorkflowRun(workflowId: string, runId: string) {
				cancelCalls.push({ workflowId, runId });
			},
		} as any,
		{
			activitySink: {
				start() {
					sinkEvents.push("start");
				},
				update() {
					sinkEvents.push("update");
				},
				finish() {
					sinkEvents.push("finish");
				},
				end() {
					sinkEvents.push("end");
				},
			},
			onComplete() {
				completed = true;
			},
		},
	);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "cancel-workflow" });
	await waitFor(() => observeStarted);
	const summary = await manager.cancel("cancel-workflow", "stop now");

	assert.equal(summary?.status, "aborted");
	assert.equal(summary?.lifecycleStatus, "ended");
	assert.equal(cancelCalls.length, 1);
	assert.deepEqual(sinkEvents.filter((event) => event === "finish"), []);
	assert.deepEqual(sinkEvents.filter((event) => event === "end"), ["end"]);
	assert.equal(completed, false);
});

test("async agent manager records remote workflow cancel failures", async () => {
	let observeStarted = false;
	const manager = new MastraAsyncAgentManager({
		async *streamWorkflow(_workflowId: string, _runId: string, _payload: unknown, options: { signal?: AbortSignal } = {}) {
			observeStarted = true;
			await new Promise((_resolve, reject) => {
				options.signal?.addEventListener("abort", () => reject(options.signal?.reason ?? new Error("aborted")), { once: true });
			});
		},
		async getWorkflowRun(workflowId: string, runId: string) {
			return { workflowName: workflowId, runId, status: "running" };
		},
		async cancelWorkflowRun() {
			throw new Error("remote still running");
		},
	} as any);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "cancel-failure" });
	await waitFor(() => observeStarted);
	const summary = await manager.cancel("cancel-failure", "stop now");

	assert.equal(summary?.status, "aborted");
	assert.equal(summary?.lifecycleStatus, "ended");
	assert.match(summary?.errors.join("\n") ?? "", /Remote workflow cancellation failed: remote still running/);
});

test("async agent manager does not rewrite already-finished jobs as aborted on cancel", async () => {
	let releaseObserve!: () => void;
	const manager = new MastraAsyncAgentManager({
		async *streamWorkflow() {
			yield { type: "pi-agent-stream-chunk", payload: { chunk: { type: "finish" } } };
			await new Promise<void>((resolve) => {
				releaseObserve = resolve;
			});
		},
		async getWorkflowRun(workflowId: string, runId: string) {
			return { workflowName: workflowId, runId, status: "success" };
		},
		async cancelWorkflowRun() {
			throw new Error("cancel should not reach server after finish");
		},
	} as any);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "finish-race" });
	await waitFor(() => manager.get("finish-race")?.status === "done");
	const summary = await manager.cancel("finish-race", "too late");
	releaseObserve();

	assert.equal(summary?.status, "done");
	assert.equal(summary?.lifecycleStatus, "agent_response_queued");
	assert.equal(summary?.terminalReason, "finish");
});

test("async agent manager refreshes remote terminal workflow before canceling local-running jobs", async () => {
	let observeStarted = false;
	let releaseObserve!: () => void;
	const manager = new MastraAsyncAgentManager({
		async *streamWorkflow() {
			observeStarted = true;
			await new Promise<void>((resolve) => {
				releaseObserve = resolve;
			});
		},
		async getWorkflowRun(workflowId: string, runId: string) {
			return { workflowName: workflowId, runId, status: "success", result: { text: "remote done" } };
		},
		async cancelWorkflowRun() {
			throw new Error("cancel should not be called for terminal workflow");
		},
	} as any);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "remote-finished" });
	await waitFor(() => observeStarted);
	const summary = await manager.cancel("remote-finished", "too late");

	assert.equal(summary?.status, "done");
	assert.equal(summary?.lifecycleStatus, "agent_response_queued");
	assert.equal(summary?.textPreview, "remote done");
	releaseObserve();
});

test("async agent manager falls back to direct stream when workflow stream fails before agent chunks", async () => {
	const directRequests: any[] = [];
	const manager = new MastraAsyncAgentManager({
		async *streamWorkflow() {
			throw new Error("stream route missing");
		},
		async *streamAgent(_agentId: string, request: unknown) {
			directRequests.push(request);
			yield { type: "text-delta", text: "fallback" };
			yield { type: "finish" };
		},
	} as any);
	manager.configureSession({ piSessionId: "session-fallback", cwd: "/workspace/project" });

	await manager.start({ agentId: "agent", message: "prompt", jobId: "fallback-job", jobName: "fallback job" });
	await waitFor(() => manager.get("fallback-job")?.lifecycleStatus === "agent_response_queued");

	const summary = manager.get("fallback-job");
	assert.equal(directRequests.length, 1);
	assert.equal(directRequests[0].memory.thread, summary?.threadId);
	assert.equal(summary?.status, "done");
	assert.equal(summary?.textPreview, "fallback");
	assert.match(summary?.errors.join("\n") ?? "", /Workflow job runner unavailable, falling back to direct stream: stream route missing/);
});

test("async agent manager does not fall back to direct stream after workflow agent chunks", async () => {
	let directCalls = 0;
	const manager = new MastraAsyncAgentManager({
		async *streamWorkflow() {
			yield { type: "pi-agent-stream-chunk", payload: { chunk: { type: "text-delta", text: "partial" } } };
			throw new Error("workflow failed after streaming");
		},
		async *streamAgent() {
			directCalls += 1;
			throw new Error("direct fallback should not be called after workflow chunks");
		},
	} as any);
	manager.configureSession({ piSessionId: "session-no-fallback", cwd: "/workspace/project" });

	await manager.start({ agentId: "agent", message: "prompt", jobId: "no-fallback-job", jobName: "no fallback" });
	await waitFor(() => manager.get("no-fallback-job")?.lifecycleStatus === "agent_response_queued");

	const summary = manager.get("no-fallback-job");
	assert.equal(directCalls, 0);
	assert.equal(summary?.status, "error");
	assert.equal(summary?.textPreview, "partial");
	assert.match(summary?.errors.join("\n") ?? "", /workflow failed after streaming/);
});

test("restoring terminal workflow jobs queues each completion reminder once", async () => {
	const finishEvents: string[] = [];
	const completions: any[] = [];
	const resourceId = defaultResourceId("/workspace/project");
	const runId = `pi-session-restore-review-agent-${resourceId.replace(":", "-")}-restore-job`;
	const manager = new MastraAsyncAgentManager(
		{
			async *observeWorkflow() {
				throw new Error("terminal restored jobs should not be observed");
			},
			async listWorkflowRuns(workflowId: string) {
				return [
					{
						workflowName: workflowId,
						runId,
						resourceId,
						status: "success",
						result: { text: "restored output" },
						inputData: {
							jobId: "restore-job",
							jobName: "review",
							piSessionId: "session-restore",
							agentId: "agent",
							message: "prompt",
							threadId: `pi-session-restore-review-agent-${resourceId.replace(":", "-")}`,
							resourceId,
						},
					},
				];
			},
			async getWorkflowRun(workflowId: string, runId: string) {
				return { workflowName: workflowId, runId, status: "success", result: { text: "restored output" } };
			},
		} as any,
		{
			activitySink: {
				start() {},
				update() {},
				finish() {
					finishEvents.push("finish");
				},
			},
			onComplete(summary) {
				completions.push(summary);
			},
		},
	);
	manager.configureSession({ piSessionId: "session-restore", cwd: "/workspace/project", isCompletionAcknowledged: () => false });

	await manager.restoreSessionJobs();
	await manager.restoreSessionJobs();

	const summary = manager.get("restore-job");
	assert.equal(summary?.status, "done");
	assert.equal(summary?.lifecycleStatus, "agent_response_queued");
	assert.deepEqual(finishEvents, ["finish"]);
	assert.equal(completions.length, 1);
});

test("restoring acknowledged terminal workflow jobs marks ended without queueing another reminder", async () => {
	const finishEvents: string[] = [];
	const endEvents: string[] = [];
	const completions: any[] = [];
	const resourceId = defaultResourceId("/workspace/project");
	const runId = `pi-session-ack-review-agent-${resourceId.replace(":", "-")}-ack-job`;
	const manager = new MastraAsyncAgentManager(
		{
			async *observeWorkflow() {
				throw new Error("terminal restored jobs should not be observed");
			},
			async listWorkflowRuns(workflowId: string) {
				return [
					{
						workflowName: workflowId,
						runId,
						resourceId,
						status: "success",
						result: { text: "already reminded" },
						inputData: {
							jobId: "ack-job",
							jobName: "review",
							piSessionId: "session-ack",
							agentId: "agent",
							message: "prompt",
							threadId: `pi-session-ack-review-agent-${resourceId.replace(":", "-")}`,
							resourceId,
						},
					},
				];
			},
			async getWorkflowRun(workflowId: string, runId: string) {
				return { workflowName: workflowId, runId, status: "success", result: { text: "already reminded" } };
			},
		} as any,
		{
			activitySink: {
				start() {},
				update() {},
				finish(jobId) {
					finishEvents.push(jobId);
				},
				end(jobId) {
					endEvents.push(jobId);
				},
			},
			onComplete(summary) {
				completions.push(summary);
			},
		},
	);
	manager.configureSession({ piSessionId: "session-ack", cwd: "/workspace/project", isCompletionAcknowledged: (jobId) => jobId === "ack-job" });

	await manager.restoreSessionJobs();

	const summary = manager.get("ack-job");
	assert.equal(summary?.status, "done");
	assert.equal(summary?.lifecycleStatus, "ended");
	assert.deepEqual(finishEvents, []);
	assert.deepEqual(endEvents, ["ack-job"]);
	assert.deepEqual(completions, []);
});

test("restoring terminal workflow jobs uses input piSessionId before run id naming and preserves output errors", async () => {
	const completions: any[] = [];
	const resourceId = defaultResourceId("/workspace/project");
	const manager = new MastraAsyncAgentManager(
		{
			async *observeWorkflow() {
				throw new Error("terminal restored jobs should not be observed");
			},
			async listWorkflowRuns(workflowId: string) {
				return [
					{
						workflowName: workflowId,
						runId: "canonical-run-from-store",
						resourceId,
						status: "success",
						result: { status: "error", text: "partial restored output", errors: ["restored agent failed"] },
						inputData: {
							jobId: "canonical-restore-job",
							jobName: "review",
							piSessionId: "session-canonical",
							agentId: "agent",
							message: "prompt",
							threadId: "pi-session-canonical-review-agent-resource",
							resourceId,
						},
					},
				];
			},
			async getWorkflowRun(workflowId: string, runId: string) {
				return {
					workflowName: workflowId,
					runId,
					status: "success",
					result: { status: "error", text: "partial restored output", errors: ["restored agent failed"] },
				};
			},
		} as any,
		{
			onComplete(summary) {
				completions.push(summary);
			},
		},
	);
	manager.configureSession({ piSessionId: "session-canonical", cwd: "/workspace/project", isCompletionAcknowledged: () => false });

	await manager.restoreSessionJobs();

	const summary = manager.get("canonical-restore-job");
	assert.equal(summary?.runId, "canonical-run-from-store");
	assert.equal(summary?.status, "error");
	assert.equal(summary?.lifecycleStatus, "agent_response_queued");
	assert.equal(summary?.textPreview, "partial restored output");
	assert.ok(summary?.errors.includes("restored agent failed"));
	assert.equal(completions.length, 1);
});

test("restoring terminal workflow jobs handles real Mastra snapshot list shape", async () => {
	const completions: any[] = [];
	const requestUrls: string[] = [];
	const resourceId = defaultResourceId("/workspace/project");
	const inputData = {
		jobId: "snapshot-restore-job",
		jobName: "review",
		piSessionId: "session-snapshot",
		agentId: "agent",
		message: "prompt",
		threadId: "pi-session-snapshot-review-agent-resource",
		resourceId,
	};
	const client = new MastraHttpClient({
		fetchImpl: async (url) => {
			requestUrls.push(String(url));
			if (String(url).includes("/runs?")) {
				return new Response(
					JSON.stringify({
						runs: [
							{
								workflowName: MASTRA_PI_AGENT_JOB_WORKFLOW_ID,
								runId: "canonical-snapshot-run",
								resourceId,
								createdAt: "2026-04-29T00:00:00.000Z",
								updatedAt: "2026-04-29T00:01:00.000Z",
								snapshot: JSON.stringify({
									status: "success",
									context: { input: inputData },
									result: { status: "error", text: "snapshot partial", errors: ["snapshot agent failed"] },
								}),
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response(
				JSON.stringify({
					workflowName: MASTRA_PI_AGENT_JOB_WORKFLOW_ID,
					runId: "canonical-snapshot-run",
					resourceId,
					status: "success",
					payload: inputData,
					result: { status: "error", text: "snapshot partial", errors: ["snapshot agent failed"] },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
	});
	const manager = new MastraAsyncAgentManager(client as any, {
		onComplete(summary) {
			completions.push(summary);
		},
	});
	manager.configureSession({ piSessionId: "session-snapshot", cwd: "/workspace/project", isCompletionAcknowledged: () => false });

	await manager.restoreSessionJobs();

	const summary = manager.get("snapshot-restore-job");
	assert.equal(summary?.runId, "canonical-snapshot-run");
	assert.equal(summary?.status, "error");
	assert.equal(summary?.lifecycleStatus, "agent_response_queued");
	assert.equal(summary?.textPreview, "snapshot partial");
	assert.ok(summary?.errors.includes("snapshot agent failed"));
	assert.equal(completions.length, 1);
	assert.ok(requestUrls.some((url) => url.includes("/runs?resourceId=")));
	assert.ok(requestUrls.some((url) => url.includes("/runs/canonical-snapshot-run?fields=result%2Cerror%2Cpayload")));
	assert.ok(!requestUrls.some((url) => url.includes("fields=result%2Cerror%2Cstatus")));
});

test("restoring active workflow jobs attaches only one observer", async () => {
	let releaseObserve!: () => void;
	let observeCalls = 0;
	const resourceId = defaultResourceId("/workspace/project");
	const runId = `pi-session-active-review-agent-${resourceId.replace(":", "-")}-active-job`;
	const manager = new MastraAsyncAgentManager({
		async *observeWorkflow() {
			observeCalls += 1;
			yield { type: "pi-agent-stream-chunk", payload: { chunk: { type: "text-delta", text: "tick" } } };
			await new Promise<void>((resolve) => {
				releaseObserve = resolve;
			});
			yield { type: "pi-agent-stream-chunk", payload: { chunk: { type: "finish" } } };
		},
		async listWorkflowRuns(workflowId: string) {
			return [
				{
					workflowName: workflowId,
					runId,
					resourceId,
					status: "running",
					inputData: {
						jobId: "active-job",
						jobName: "review",
						piSessionId: "session-active",
						agentId: "agent",
						message: "prompt",
						threadId: `pi-session-active-review-agent-${resourceId.replace(":", "-")}`,
						resourceId,
					},
				},
			];
		},
		async getWorkflowRun(workflowId: string, runId: string) {
			return { workflowName: workflowId, runId, status: "success" };
		},
	} as any);
	manager.configureSession({ piSessionId: "session-active", cwd: "/workspace/project" });

	await manager.restoreSessionJobs();
	await waitFor(() => manager.get("active-job")?.textPreview === "tick");
	await manager.restoreSessionJobs();
	assert.equal(observeCalls, 1);
	releaseObserve();
	await waitFor(() => manager.get("active-job")?.lifecycleStatus === "agent_response_queued");
});

test("restoring active workflow jobs handles real Mastra snapshot list shape", async () => {
	let releaseObserve!: () => void;
	let observeCalls = 0;
	const requestUrls: string[] = [];
	const resourceId = defaultResourceId("/workspace/project");
	const inputData = {
		jobId: "active-snapshot-job",
		jobName: "review",
		piSessionId: "session-active-snapshot",
		agentId: "agent",
		message: "prompt",
		threadId: `pi-session-active-snapshot-review-agent-${resourceId.replace(":", "-")}`,
		resourceId,
	};
	const client = new MastraHttpClient({
		fetchImpl: async (url) => {
			const requestUrl = String(url);
			requestUrls.push(requestUrl);
			if (requestUrl.includes("/runs?")) {
				return new Response(
					JSON.stringify({
						runs: [
							{
								workflowName: MASTRA_PI_AGENT_JOB_WORKFLOW_ID,
								runId: "active-snapshot-run",
								resourceId,
								snapshot: JSON.stringify({
									status: "running",
									context: { input: inputData },
								}),
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (requestUrl.includes("/observe?")) {
				observeCalls += 1;
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						const encoder = new TextEncoder();
						controller.enqueue(encoder.encode('data: {"type":"pi-agent-stream-chunk","payload":{"chunk":{"type":"text-delta","text":"tick"}}}\n\n'));
						releaseObserve = () => {
							controller.enqueue(encoder.encode('data: {"type":"pi-agent-stream-chunk","payload":{"chunk":{"type":"finish"}}}\n\n'));
							controller.enqueue(encoder.encode("data: [DONE]\n\n"));
							controller.close();
						};
					},
				});
				return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
			}
			return new Response(
				JSON.stringify({
					workflowName: MASTRA_PI_AGENT_JOB_WORKFLOW_ID,
					runId: "active-snapshot-run",
					resourceId,
					status: "success",
					payload: inputData,
					result: { text: "final active result" },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
	});
	const manager = new MastraAsyncAgentManager(client as any);
	manager.configureSession({ piSessionId: "session-active-snapshot", cwd: "/workspace/project" });

	await manager.restoreSessionJobs();
	await waitFor(() => manager.get("active-snapshot-job")?.textPreview === "tick");
	await manager.restoreSessionJobs();
	assert.equal(observeCalls, 1);
	releaseObserve();
	await waitFor(() => manager.get("active-snapshot-job")?.lifecycleStatus === "agent_response_queued");

	const summary = manager.get("active-snapshot-job");
	assert.equal(summary?.status, "done");
	assert.equal(summary?.textPreview, "tick");
	assert.ok(requestUrls.some((url) => url.includes("/runs?resourceId=")));
	assert.ok(requestUrls.some((url) => url.includes("/observe?runId=active-snapshot-run")));
	assert.ok(requestUrls.some((url) => url.includes("/runs/active-snapshot-run?fields=result%2Cerror%2Cpayload")));
});

test("restoring terminal workflow retries completion reminder if previous send failed", async () => {
	let attempts = 0;
	const resourceId = defaultResourceId("/workspace/project");
	const runId = `pi-session-retry-review-agent-${resourceId.replace(":", "-")}-retry-job`;
	const manager = new MastraAsyncAgentManager(
		{
			async *observeWorkflow() {
				throw new Error("terminal restored jobs should not be observed");
			},
			async listWorkflowRuns(workflowId: string) {
				return [
					{
						workflowName: workflowId,
						runId,
						resourceId,
						status: "success",
						result: { text: "restored output" },
						inputData: {
							jobId: "retry-job",
							jobName: "review",
							piSessionId: "session-retry",
							agentId: "agent",
							message: "prompt",
							threadId: `pi-session-retry-review-agent-${resourceId.replace(":", "-")}`,
							resourceId,
						},
					},
				];
			},
			async getWorkflowRun(workflowId: string, runId: string) {
				return { workflowName: workflowId, runId, status: "success", result: { text: "restored output" } };
			},
		} as any,
		{
			onComplete() {
				attempts += 1;
				if (attempts === 1) throw new Error("send failed");
			},
		},
	);
	manager.configureSession({ piSessionId: "session-retry", cwd: "/workspace/project", isCompletionAcknowledged: () => false });

	await manager.restoreSessionJobs();
	assert.equal(attempts, 1);
	assert.match(manager.get("retry-job")?.errors.join("\n") ?? "", /Completion reminder failed/);

	await manager.restoreSessionJobs();
	assert.equal(attempts, 2);
});

test("restoring terminal workflow retries queued activity sink notification if previous finish failed", async () => {
	let finishAttempts = 0;
	const resourceId = defaultResourceId("/workspace/project");
	const runId = `pi-session-sink-review-agent-${resourceId.replace(":", "-")}-sink-job`;
	const manager = new MastraAsyncAgentManager(
		{
			async *observeWorkflow() {
				throw new Error("terminal restored jobs should not be observed");
			},
			async listWorkflowRuns(workflowId: string) {
				return [
					{
						workflowName: workflowId,
						runId,
						resourceId,
						status: "success",
						result: { text: "restored output" },
						inputData: {
							jobId: "sink-job",
							jobName: "review",
							piSessionId: "session-sink",
							agentId: "agent",
							message: "prompt",
							threadId: `pi-session-sink-review-agent-${resourceId.replace(":", "-")}`,
							resourceId,
						},
					},
				];
			},
			async getWorkflowRun(workflowId: string, runId: string) {
				return { workflowName: workflowId, runId, status: "success", result: { text: "restored output" } };
			},
		} as any,
		{
			activitySink: {
				start() {},
				update() {},
				finish() {
					finishAttempts += 1;
					if (finishAttempts === 1) throw new Error("sink failed");
				},
			},
		},
	);
	manager.configureSession({ piSessionId: "session-sink", cwd: "/workspace/project", isCompletionAcknowledged: () => false });

	await manager.restoreSessionJobs();
	assert.equal(finishAttempts, 1);
	assert.match(manager.get("sink-job")?.errors.join("\n") ?? "", /Completion activity sink failed/);

	await manager.restoreSessionJobs();
	assert.equal(finishAttempts, 2);
});

test("async agent manager fires onComplete callback by default", async () => {
	let completed = false;
	const manager = new MastraAsyncAgentManager(
		{
			async *streamAgent() {
				yield { type: "finish" };
			},
		} as any,
		{
			onComplete() {
				completed = true;
			},
		},
	);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "default-no-message" });
	await waitFor(() => manager.get("default-no-message")?.status === "done");
	assert.equal(completed, true);
});

test("async agent manager suppresses onComplete during shutdown even if start is racing", async () => {
	let completed = false;
	const manager = new MastraAsyncAgentManager(
		{
			async *streamAgent() {
				yield { type: "finish" };
			},
		} as any,
		{
			onComplete() {
				completed = true;
			},
		},
	);

	void manager.start({ agentId: "agent", message: "prompt", jobId: "shutdown-job", finalMessage: true });
	manager.cancelAll("test shutdown", { suppressCompletionMessage: true });
	await waitFor(() => {
		const job = manager.get("shutdown-job");
		return job !== undefined && job.status !== "running";
	});
	assert.equal(completed, false);
});

test("async agent manager marks stream EOF without finish as incomplete error", async () => {
	const manager = new MastraAsyncAgentManager({
		async *streamAgent() {
			yield { type: "text-delta", text: "partial output" };
		},
	} as any);

	await manager.start({ agentId: "agent", message: "prompt", jobId: "incomplete-job" });
	await waitFor(() => manager.get("incomplete-job")?.status === "error");

	const summary = manager.get("incomplete-job");
	assert.equal(summary?.terminalReason, "stream_eof");
	assert.equal(summary?.incomplete, true);
	assert.match(summary?.errors.join("\n") ?? "", /terminal finish event/);

	const output = await manager.read({ jobId: "incomplete-job", mode: "tail" });
	assert.match(output.text, /partial output/);
	assert.match(output.text, /async job incomplete/);
});

test("uses Mastra workflow stream payload shape", () => {
	const request = createWorkflowStreamRequest({
		workflowId: "workflow",
		runId: "run",
		inputData: { hello: "world" },
		initialState: { count: 1 },
		resourceId: "resource",
		requestContext: { tenant: "a" },
		perStep: true,
		closeOnSuspend: true,
	});

	assert.deepEqual(request, {
		inputData: { hello: "world" },
		initialState: { count: 1 },
		resourceId: "resource",
		requestContext: { tenant: "a" },
		perStep: true,
		closeOnSuspend: true,
	});
});

test("normalizes agent inspect ids from array and comma-separated inputs", () => {
	assert.deepEqual(
		normalizeInspectAgentIds({
			agentId: "supervisor-agent",
			agentIds: ["architect-agent", " supervisor-agent "],
			agents: "validator-agent,architect-agent",
		}),
		["supervisor-agent", "architect-agent", "validator-agent"],
	);
});

test("agent inspect returns tools, modes, workspace, and memory metadata by default", async () => {
	const tool = createMastraAgentInspectTool({
		getAgent: async (agentId: string) => ({
			id: agentId,
			name: "Supervisor",
			description: "Routes work",
			instructions: "Use evidence.",
			tools: {
				readFile: {
					description: "Read a file",
					inputSchema: { type: "object" },
				},
			},
			workspaceId: "workspace-1",
			memory: { enabled: true },
		}),
	} as any);

	const result = await tool.execute("call", { agents: "supervisor-agent" });
	assert.equal(result.details.count, 1);
	assert.equal(result.details.agents[0].instructions, undefined);
	assert.equal(result.details.agents[0].tools[0].id, "readFile");
	assert.equal(result.details.agents[0].modesSource, "not_exposed");
	assert.equal(result.details.agents[0].workspaceId, "workspace-1");
	assert.deepEqual(result.details.agents[0].memory, { enabled: true });
	assert.equal("instructions" in result.details.agents[0].raw, false);
});

test("agent inspect can include instructions when requested", async () => {
	const tool = createMastraAgentInspectTool({
		getAgent: async (agentId: string) => ({
			id: agentId,
			name: "Supervisor",
			instructions: "Use evidence.",
			tools: {},
		}),
	} as any);

	const result = await tool.execute("call", { agentId: "supervisor-agent", includeInstructions: true });
	assert.equal(result.details.agents[0].instructions, "Use evidence.");
	assert.equal(result.content[0].type, "text");
	assert.match("text" in result.content[0] ? result.content[0].text : "", /Use evidence/);
});

test("agent inspect with no ids lists available agents and current session jobs", async () => {
	const tool = createMastraAgentInspectTool({
		listAgents: async () => ({
			"developer-agent": { id: "developer-agent", name: "Developer" },
			"validator-agent": { id: "validator-agent", name: "Validator" },
			"reviewer-agent": { id: "reviewer-agent", name: "Reviewer" },
			"free-agent": { id: "free-agent", name: "Free" },
		}),
	} as any, {
		inspectJobs: () => [
			{
				jobId: "job-1",
				jobName: "implementation",
				agentId: "developer-agent",
				status: "working",
				threadId: "thread",
				resourceId: "resource",
			},
			{
				jobId: "job-2",
				jobName: "validation",
				agentId: "validator-agent",
				status: "agent_response_queued",
				threadId: "thread-2",
				resourceId: "resource",
				runId: "run-2",
			},
			{
				jobId: "job-3",
				jobName: "review",
				agentId: "reviewer-agent",
				status: "ended",
				threadId: "thread-3",
				resourceId: "resource",
				runId: "run-3",
			},
		],
	} as any);

	const result = await tool.execute("call", {});
	assert.equal(result.details.availableAgents?.length, 4);
	assert.deepEqual(result.details.availableAgents?.map((agent) => agent.agentId), [
		"developer-agent",
		"validator-agent",
		"reviewer-agent",
		"free-agent",
	]);
	assert.equal(result.details.availableAgents?.[0]?.status, "available");
	assert.deepEqual(result.details.jobs?.map((job) => [job.jobId, job.status]), [
		["job-1", "working"],
		["job-2", "agent_response_queued"],
		["job-3", "ended"],
	]);
	assert.match("text" in result.content[0] ? result.content[0].text : "", /availableAgents/);
	assert.match("text" in result.content[0] ? result.content[0].text : "", /agent_response_queued/);
	assert.match("text" in result.content[0] ? result.content[0].text : "", /ended/);
});

test("agent inspect can list real manager job statuses across lifecycle states", async () => {
	let releaseWorking!: () => void;
	const manager = new MastraAsyncAgentManager({
		async *streamAgent(agentId: string, _request: unknown) {
			if (agentId === "queued-agent") {
				yield { type: "finish" };
				return;
			}
			await new Promise<void>((resolve) => {
				releaseWorking = resolve;
			});
			yield { type: "finish" };
		},
	} as any);
	const tool = createMastraAgentInspectTool({
		listAgents: async () => ({
			"working-agent": { id: "working-agent", name: "Working" },
			"queued-agent": { id: "queued-agent", name: "Queued" },
			"free-agent": { id: "free-agent", name: "Free" },
		}),
	} as any, manager);

	await manager.start({ agentId: "working-agent", message: "hold", jobId: "working-job", finalMessage: false });
	await manager.start({ agentId: "queued-agent", message: "done", jobId: "queued-job", finalMessage: false });
	await waitFor(() => manager.get("queued-job")?.lifecycleStatus === "agent_response_queued");

	const queuedResult = await tool.execute("call", {});
	const queuedStatuses = new Map(queuedResult.details.jobs?.map((job) => [job.jobId, job.status]));
	assert.equal(queuedStatuses.get("working-job"), "working");
	assert.equal(queuedStatuses.get("queued-job"), "agent_response_queued");
	assert.deepEqual(queuedResult.details.availableAgents?.map((agent) => agent.agentId), [
		"working-agent",
		"queued-agent",
		"free-agent",
	]);

	manager.markEnded("queued-job");
	const endedResult = await tool.execute("call", {});
	const endedStatuses = new Map(endedResult.details.jobs?.map((job) => [job.jobId, job.status]));
	assert.equal(endedStatuses.get("queued-job"), "ended");
	releaseWorking();
	await waitFor(() => manager.get("working-job")?.lifecycleStatus === "agent_response_queued");
});


const stubTheme: Record<string, (...args: string[]) => string> = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	dim: (text: string) => text,
};

function fakeAsyncSummary(overrides: Record<string, unknown> = {}): any {
	return {
		jobId: "job",
		agentId: "agent",
		threadId: "thread",
		resourceId: "resource",
		status: "running",
		textPreview: "",
		toolCalls: 0,
		toolResults: 0,
		rawChunkCount: 0,
		chunksTruncated: false,
		errors: [],
		...overrides,
	};
}

function fakeCallDetails(overrides: Record<string, unknown> = {}): any {
	return {
		agentId: "agent",
		threadId: "thread",
		resourceId: "resource",
		status: "done",
		text: "answer",
		toolCalls: [],
		toolResults: [],
		chunksTruncated: false,
		errors: [],
		rawChunkCount: 1,
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
