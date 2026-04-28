import assert from "node:assert/strict";
import test from "node:test";
import { createMastraAgentInspectTool, createStreamRequest, createWorkflowStreamRequest, normalizeInspectAgentIds } from "./tool.js";

test("omitted modeId leaves requestContext unchanged", () => {
	const request = createStreamRequest(
		{ agentId: "agent", message: "hello", requestContext: { tenant: "a" } },
		"thread",
		"resource",
	);
	assert.deepEqual(request.requestContext, { tenant: "a" });
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
