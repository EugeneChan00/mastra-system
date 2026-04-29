import assert from "node:assert/strict";
import test from "node:test";
import { parseSseJsonData, parseSseText, SseParseError } from "./sse.js";

test("parses normal SSE data chunks", () => {
	assert.deepEqual(parseSseText('data: {"type":"text-delta","text":"hi"}\n\n'), [
		{ data: '{"type":"text-delta","text":"hi"}', event: undefined, id: undefined },
	]);
});

test("parses multiple events from one buffer", () => {
	assert.deepEqual(parseSseText("data: 1\n\ndata: 2\n\n").map((event) => event.data), ["1", "2"]);
});

test("parses multiline data", () => {
	assert.deepEqual(parseSseText("event: chunk\ndata: hello\ndata: world\n\n"), [
		{ data: "hello\nworld", event: "chunk", id: undefined },
	]);
});

test("skips comment-only heartbeat frames", () => {
	assert.deepEqual(parseSseText(": ping\n\n"), []);
});

test("skips event/id-only frames without data", () => {
	assert.deepEqual(parseSseText("event: keepalive\nid: 123\n\n"), []);
});

test("accepts DONE sentinel", () => {
	assert.equal(parseSseJsonData("[DONE]"), "[DONE]");
});

test("throws structured parse error for invalid JSON", () => {
	assert.throws(() => parseSseJsonData("{"), SseParseError);
});
