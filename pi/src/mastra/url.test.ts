import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_MASTRA_BASE_URL,
	agentStreamPath,
	agentsPath,
	workflowRunPath,
	workflowsPath,
	workflowStreamPath,
} from "../const.js";
import { joinMastraPath, normalizeMastraBaseUrl } from "./url.js";

test("normalizes root Mastra URL to API URL", () => {
	assert.equal(normalizeMastraBaseUrl("http://localhost:4111"), DEFAULT_MASTRA_BASE_URL);
	assert.equal(normalizeMastraBaseUrl("http://localhost:4111/"), DEFAULT_MASTRA_BASE_URL);
});

test("preserves API Mastra URL", () => {
	assert.equal(normalizeMastraBaseUrl("http://localhost:4111/api"), DEFAULT_MASTRA_BASE_URL);
	assert.equal(normalizeMastraBaseUrl("http://localhost:4111/api/"), DEFAULT_MASTRA_BASE_URL);
});

test("builds endpoint paths", () => {
	assert.equal(agentsPath(), "/agents");
	assert.equal(agentsPath({ partial: true }), "/agents?partial=true");
	assert.equal(agentStreamPath("supervisor-agent"), "/agents/supervisor-agent/stream");
	assert.equal(joinMastraPath(DEFAULT_MASTRA_BASE_URL, agentStreamPath("a b")), "http://localhost:4111/api/agents/a%20b/stream");
});

test("builds workflow endpoint paths", () => {
	assert.equal(workflowsPath(), "/workflows");
	assert.equal(workflowsPath({ partial: true }), "/workflows?partial=true");
	assert.equal(workflowStreamPath("workspace smoke", "run 1"), "/workflows/workspace%20smoke/stream?runId=run%201");
	assert.equal(
		workflowRunPath("workspace", "run-1", { fields: ["result", "error"], withNestedWorkflows: false }),
		"/workflows/workspace/runs/run-1?fields=result%2Cerror&withNestedWorkflows=false",
	);
});
