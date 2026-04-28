import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MASTRA_BASE_URL, agentStreamPath, agentsPath } from "../const.js";
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
	assert.equal(agentStreamPath("supervisor-agent"), "/agents/supervisor-agent/stream");
	assert.equal(joinMastraPath(DEFAULT_MASTRA_BASE_URL, agentStreamPath("a b")), "http://localhost:4111/api/agents/a%20b/stream");
});

