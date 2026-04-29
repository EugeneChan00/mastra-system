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
	for (const key of ["agentId", "message", "jobName", "synchronous", "threadId", "resourceId", "requestContext", "includeToolResults", "includeReasoning", "timeoutMs", "input_args"]) {
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
		requestContext: { tenant: "acme" },
		input_args: { $1: "value" },
	});

	assert.equal((result.details as any).text, "answer");
	assert.equal("text" in result.content[0] ? result.content[0].text.includes("Reasoning:" ) : true, false);
	assert.equal(requests[0].agentId, "agent");
	assert.match(requests[0].request.messages[0].content, /Use \$1\n\nInput arguments:\n- \$1: value/);
	assert.deepEqual(requests[0].request.requestContext, { tenant: "acme", input_args: { $1: "value" } });
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
	let completed = false;
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
				start() {},
				update() {
					updates += 1;
				},
				finish() {},
			},
			onComplete() {
				completed = true;
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
	assert.equal(summary?.prompt, "prompt");
	assert.ok(updates >= 2);
	assert.ok(completed, "onComplete should fire when finalMessage: true");

	const output = await manager.read({ jobId: "test-job", mode: "full" });
	assert.equal(output.text, "hello world");
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
		],
	} as any);

	const result = await tool.execute("call", {});
	assert.equal(result.details.availableAgents?.length, 1);
	assert.equal(result.details.availableAgents?.[0]?.agentId, "validator-agent");
	assert.equal(result.details.availableAgents?.[0]?.status, "available");
	assert.equal(result.details.jobs?.[0]?.jobId, "job-1");
	assert.match("text" in result.content[0] ? result.content[0].text : "", /availableAgents/);
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
