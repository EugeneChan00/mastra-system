import assert from "node:assert/strict";
import test from "node:test";
import { MastraHttpClient } from "./client.js";

test("listAgents parses object-shaped Mastra registry", async () => {
	let requestUrl = "";
	const client = new MastraHttpClient({
		fetchImpl: async (url) => {
			requestUrl = String(url);
			return new Response(JSON.stringify({ "supervisor-agent": { id: "supervisor-agent", name: "Supervisor" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	const agents = await client.listAgents();
	assert.equal(agents["supervisor-agent"].name, "Supervisor");
	assert.match(requestUrl, /\/agents\?partial=true$/);
});

test("getAgent parses one agent metadata object", async () => {
	let requestUrl = "";
	const client = new MastraHttpClient({
		fetchImpl: async (url) => {
			requestUrl = String(url);
			return new Response(JSON.stringify({ id: "agent", name: "Agent" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	const agent = await client.getAgent("agent");
	assert.equal(agent.name, "Agent");
	assert.match(requestUrl, /\/agents\/agent$/);
});

test("listWorkflows parses object-shaped Mastra workflow registry", async () => {
	let requestUrl = "";
	const client = new MastraHttpClient({
		fetchImpl: async (url) => {
			requestUrl = String(url);
			return new Response(JSON.stringify({ "workspace-smoke-workflow": { steps: {}, allSteps: {}, stepGraph: [] } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	const workflows = await client.listWorkflows();
	assert.ok(workflows["workspace-smoke-workflow"]);
	assert.match(requestUrl, /\/workflows\?partial=true$/);
});

test("getWorkflowRun forwards fields and nested workflow query options", async () => {
	let requestUrl = "";
	const client = new MastraHttpClient({
		fetchImpl: async (url) => {
			requestUrl = String(url);
			return new Response(JSON.stringify({ workflowName: "wf", runId: "run", status: "success" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	const run = await client.getWorkflowRun("wf", "run", { fields: ["result", "error"], withNestedWorkflows: false });
	assert.equal(run.status, "success");
	assert.match(requestUrl, /\/workflows\/wf\/runs\/run\?fields=result%2Cerror&withNestedWorkflows=false$/);
});

test("streamAgent yields parsed chunks until DONE", async () => {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			controller.enqueue(encoder.encode('data: {"type":"text-delta","text":"hi"}\n\n'));
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
	const client = new MastraHttpClient({
		fetchImpl: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
	});

	const chunks = [];
	for await (const chunk of client.streamAgent("agent", { messages: [{ role: "user", content: "hello" }], memory: { thread: "t", resource: "r" } })) {
		chunks.push(chunk);
	}
	assert.deepEqual(chunks, [{ type: "text-delta", text: "hi" }]);
});

test("streamWorkflow posts workflow payload and yields parsed chunks until DONE", async () => {
	let requestUrl = "";
	let requestBody = "";
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			controller.enqueue(encoder.encode('data: {"status":"success","result":{"ok":true}}\n\n'));
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
	const client = new MastraHttpClient({
		fetchImpl: async (url, init) => {
			requestUrl = String(url);
			requestBody = String(init?.body);
			return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		},
	});

	const chunks = [];
	for await (const chunk of client.streamWorkflow("workflow", "run-1", { inputData: { hello: "world" } })) {
		chunks.push(chunk);
	}
	assert.deepEqual(chunks, [{ status: "success", result: { ok: true } }]);
	assert.match(requestUrl, /\/workflows\/workflow\/stream\?runId=run-1$/);
	assert.equal(requestBody, JSON.stringify({ inputData: { hello: "world" } }));
});

test("streamAgent honors pre-aborted signals before fetch", async () => {
	const abortController = new AbortController();
	abortController.abort(new Error("already cancelled"));
	let fetchCalls = 0;
	const client = new MastraHttpClient({
		fetchImpl: async () => {
			fetchCalls += 1;
			return new Response(null, { status: 500 });
		},
	});

	await assert.rejects(
		async () => {
			for await (const _chunk of client.streamAgent(
				"agent",
				{ messages: [{ role: "user", content: "hello" }], memory: { thread: "t", resource: "r" } },
				{ signal: abortController.signal },
			)) {
				// no-op
			}
		},
		/already cancelled/,
	);
	assert.equal(fetchCalls, 0);
});
