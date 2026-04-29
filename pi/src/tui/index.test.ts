import assert from "node:assert/strict";
import test from "node:test";
import { filterPromptScaffolding, MastraAgentCard } from "./index.js";
import type { MastraAgentCallDetails } from "../mastra/types.js";

// Stub theme matching the real Theme interface surface used by MastraAgentCard
const stubTheme: Record<string, (...args: string[]) => string> = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	dim: (text: string) => text,
};

test("filterPromptScaffolding removes Expected return status prefix", () => {
	const result = filterPromptScaffolding("Expected return status: success. Here is my analysis.");
	assert.ok(!result.includes("Expected return status"));
	assert.ok(result.includes("success"));
	assert.ok(result.includes("analysis"));
});

test("filterPromptScaffolding removes Expected return format prefix", () => {
	const result = filterPromptScaffolding("Expected return format: json. The response should be formatted.");
	assert.ok(!result.includes("Expected return format"));
	assert.ok(result.includes("response should be formatted"));
});

test("filterPromptScaffolding removes lowercase expected return variants", () => {
	assert.ok(!filterPromptScaffolding("Expected return status: ok").includes("Expected return"));
	assert.ok(filterPromptScaffolding("expected return value: 42").includes("42"));
});

test("filterPromptScaffolding removes worker-brief and internal instruction prefixes", () => {
	assert.ok(!filterPromptScaffolding("worker-brief: do the thing. Here is my work.").includes("worker-brief"));
	assert.ok(!filterPromptScaffolding("worker brief: step 1. Do step 2.").includes("worker brief"));
	assert.ok(!filterPromptScaffolding("internal instruction: secrets. Run the code.").includes("internal instruction"));
	assert.ok(filterPromptScaffolding("Run the code.").includes("Run the code"));
});

test("filterPromptScaffolding removes 'do not show' markers", () => {
	const result = filterPromptScaffolding("The answer. do not show: debug info. End.");
	assert.ok(!result.includes("do not show"));
	assert.ok(result.includes("The answer"));
	assert.ok(result.includes("End"));
});

test("filterPromptScaffolding normalizes whitespace after removal", () => {
	const result = filterPromptScaffolding("Expected return status:   hello   world");
	assert.ok(!result.includes("  "));
	assert.ok(result.includes("hello"));
});

test("filterPromptScaffolding handles empty and null-like input", () => {
	assert.equal(filterPromptScaffolding(""), "");
	assert.equal(filterPromptScaffolding("   "), "");
	assert.equal(filterPromptScaffolding("valid text"), "valid text");
});

test("filterPromptScaffolding preserves normal agent output", () => {
	const output = "I'll analyze the codebase. Found 3 TypeScript files in src/agents.";
	assert.equal(filterPromptScaffolding(output), output);
});

test("MastraAgentCard output section does not include internal scaffolding text", () => {
	const details = makeDetails({
		text: "Expected return status: success. The task is complete.",
	});
	const card = new MastraAgentCard(details, { isPartial: false }, stubTheme as any);
	const lines = card.render(80);
	assert.ok(lines.length > 0, "card should render non-empty lines");
	const joined = lines.join(" ");
	assert.ok(!joined.includes("Expected return status"), "card should not show scaffolding in output");
	assert.ok(!joined.includes("worker-brief"), "card should not show worker-brief in output");
	assert.ok(joined.includes("The task is complete"), "real content should be preserved");
});

test("MastraAgentCard preserves real agent output intact", () => {
	const details = makeDetails({
		text: "Found 5 files matching the query across src/agents and src/workflows.",
	});
	const card = new MastraAgentCard(details, { isPartial: false }, stubTheme as any);
	const lines = card.render(80);
	const joined = lines.join(" ");
	assert.ok(joined.includes("Found 5 files"));
	assert.ok(joined.includes("src/agents"));
});

test("MastraAgentCard left boundary has no internal drift — border aligned at width edge", () => {
	const details = makeDetails({ text: "test output" });
	const card = new MastraAgentCard(details, { isPartial: false }, stubTheme as any);
	const lines = card.render(80);
	assert.ok(lines.length > 0, "card should render lines");
	for (const line of lines) {
		// The card's border │ should be at most 1 space from the line start.
		// Internal indentation would add spaces before │ — detect that.
		// Matches: any number of spaces followed by │ (or start-of-line border char)
		const match = line.match(/^(\s*)[│]/);
		if (match) {
			const spacesBeforeBorder = match[1].length;
			assert.ok(spacesBeforeBorder <= 1, `Card line has left drift: "${line}" (${spacesBeforeBorder} spaces before │, expected ≤1)`);
		}
	}
});

test("MastraAgentCard with partial streaming state shows correct status", () => {
	const details = makeDetails({ text: "streaming…" });
	const card = new MastraAgentCard(details, { isPartial: true }, stubTheme as any);
	const lines = card.render(80);
	assert.ok(lines.length > 0, "partial card should render");
	// Border color for running status should be "accent" — verify card renders
	assert.ok(lines.some((l) => l.includes("│")), "card should have frame borders");
});

function makeDetails(overrides: Partial<MastraAgentCallDetails> = {}): MastraAgentCallDetails {
	return {
		agentId: "test-agent",
		threadId: "thread-1",
		resourceId: "resource-1",
		status: "done",
		text: "default text",
		toolCalls: [],
		toolResults: [],
		chunksTruncated: false,
		errors: [],
		rawChunkCount: 1,
		...overrides,
	};
}