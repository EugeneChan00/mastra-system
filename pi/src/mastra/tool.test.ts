import assert from "node:assert/strict";
import test from "node:test";
import { MastraAsyncAgentManager, createMastraAgentInspectTool, createStreamRequest, createWorkflowStreamRequest, normalizeInspectAgentIds } from "./tool.js";

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
	// Literal placeholders preserved in message body; Input arguments section appended with instruction
	assert.equal(
		request.messages[0].content,
		"Hello $1, you selected $2\n\nInput arguments:\n- $1: Alice\n- $2: Option A\n\nUse the above arguments when referencing placeholders like $1, $2 in your response.",
	);
});

test("input_args preserves placeholders and sorts keys numerically ($1, $2, $10)", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "Process $2 and $1 and $10", input_args: { $1: "first", $2: "second", $10: "tenth" } },
		"thread",
		"resource",
	);
	// Literal placeholders preserved; Input arguments section sorted numerically ($1, $2, $10 not $1, $10, $2)
	assert.equal(
		request.messages[0].content,
		"Process $2 and $1 and $10\n\nInput arguments:\n- $1: first\n- $2: second\n- $10: tenth\n\nUse the above arguments when referencing placeholders like $1, $2, $10 in your response.",
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
	assert.match(requests[0].memory.thread, /:job-one$/);
	assert.match(requests[1].memory.thread, /:job-two$/);
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

	const started = await manager.start({ agentId: "agent", message: "prompt", jobId: "test-job" });
	assert.equal(started.jobId, "test-job");
	assert.equal(started.status, "running");

	await waitFor(() => completed);
	const summary = manager.get("test-job");
	assert.equal(summary?.status, "done");
	assert.equal(summary?.prompt, "prompt");
	assert.ok(updates >= 2);

	const output = await manager.read({ jobId: "test-job", mode: "full" });
	assert.equal(output.text, "hello world");
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

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for predicate");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
