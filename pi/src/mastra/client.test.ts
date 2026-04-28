import assert from "node:assert/strict";
import test from "node:test";
import { MastraHttpClient } from "./client.js";

test("listAgents parses object-shaped Mastra registry", async () => {
	const client = new MastraHttpClient({
		fetchImpl: async () =>
			new Response(JSON.stringify({ "supervisor-agent": { id: "supervisor-agent", name: "Supervisor" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
	});

	const agents = await client.listAgents();
	assert.equal(agents["supervisor-agent"].name, "Supervisor");
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

