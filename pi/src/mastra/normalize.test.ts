import assert from "node:assert/strict";
import test from "node:test";
import { applyNormalizedEvent, normalizeMastraChunk, truncateText } from "./normalize.js";
import type { MastraAgentCallDetails } from "./types.js";

test("normalizes and applies text deltas", () => {
	const details = makeDetails();
	applyNormalizedEvent(details, normalizeMastraChunk({ type: "text-delta", text: "hello" }));
	applyNormalizedEvent(details, normalizeMastraChunk({ type: "text-delta", delta: " world" }));
	assert.equal(details.text, "hello world");
});

test("normalizes tool lifecycle events", () => {
	const details = makeDetails();
	applyNormalizedEvent(details, normalizeMastraChunk({ type: "tool-call", toolCallId: "1", toolName: "read", args: { path: "x" } }));
	applyNormalizedEvent(details, normalizeMastraChunk({ type: "tool-result", toolCallId: "1", toolName: "read", result: "ok" }));
	applyNormalizedEvent(details, normalizeMastraChunk({ type: "tool-error", toolCallId: "2", toolName: "bash", error: "no" }));
	assert.equal(details.toolCalls.length, 1);
	assert.equal(details.toolResults.length, 2);
	assert.equal(details.toolResults[1].type, "error");
});

test("sets final status and usage on finish", () => {
	const details = makeDetails();
	applyNormalizedEvent(details, normalizeMastraChunk({ type: "finish", usage: { totalTokens: 42 } }));
	assert.equal(details.status, "done");
	assert.equal(details.usage?.totalTokens, 42);
});

test("records stream errors", () => {
	const details = makeDetails();
	applyNormalizedEvent(details, normalizeMastraChunk({ type: "error", message: "boom" }));
	assert.equal(details.status, "error");
	assert.deepEqual(details.errors, ["boom"]);
});

test("truncates text deterministically", () => {
	const result = truncateText("abcdef", 5);
	assert.equal(result.truncated, true);
	assert.equal(result.originalLength, 6);
	assert.match(result.text, /truncated/);
});

function makeDetails(): MastraAgentCallDetails {
	return {
		agentId: "agent",
		threadId: "thread",
		resourceId: "resource",
		status: "running",
		text: "",
		toolCalls: [],
		toolResults: [],
		chunksTruncated: false,
		errors: [],
		rawChunkCount: 0,
	};
}

