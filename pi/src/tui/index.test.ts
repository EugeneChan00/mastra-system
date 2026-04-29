import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { filterPromptScaffolding, MastraAgentActivityStore, MastraAgentCard, MastraAgentsWidget } from "./index.js";
import type { MastraAgentCallDetails, MastraAgentCallInput } from "../mastra/types.js";

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

test("MastraAgentsWidget uses default 4-card and 60-line budget", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 4; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: `output ${i}`,
		}));
	}

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store);
	const lines = widget.render(100);
	widget.dispose();

	assert.equal(lines.filter((line) => line.includes("Mastra: agent-")).length, 4);
	assert.ok(lines.length <= 60, `expected widget lines to honor default maxLines=60, got ${lines.length}`);
});

test("MastraAgentsWidget render uses full live width with no artificial cap", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-wide", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-wide",
		status: "running",
		text: "Working on the task.",
	}));

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store);
	const lines120 = widget.render(120);
	const lines80 = widget.render(80);
	widget.dispose();

	const topBorder = lines120.find((line) => line.includes("Mastra: agent-wide"));
	assert.ok(topBorder, "top border line should be present");
	assert.equal(visibleWidth(topBorder), 120);
	assert.ok(lines80.every((line) => visibleWidth(line) <= 80));
	assert.notEqual(lines120.join(""), lines80.join(""));
});

test("MastraAgentsWidget keeps lingering done card slots stable", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 4; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: `output ${i}`,
		}));
	}

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store);
	const before = widget.render(100).filter((line) => line.includes("Mastra: agent-"));
	store.finish("call-1", makeDetails({ agentId: "agent-1", status: "done", text: "complete" }));
	const after = widget.render(100).filter((line) => line.includes("Mastra: agent-"));
	widget.dispose();

	assert.deepEqual(after.map(agentLabel), before.map(agentLabel));
	assert.ok(after[0].includes("done"));
});

test("MastraAgentsWidget keeps newest jobs visible with newest at the bottom", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 4; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: `output ${i}`,
		}));
	}

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store, { maxCards: 4 });
	widget.render(100);
	store.finish("call-1", makeDetails({ agentId: "agent-1", status: "done", text: "complete" }));
	store.start("call-5", { agentId: "agent-5", message: "task 5" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-5",
		status: "running",
		text: "output 5",
	}));
	const labels = widget.render(100).filter((line) => line.includes("Mastra: agent-")).map(agentLabel);
	widget.dispose();

	assert.deepEqual(labels, ["agent-2", "agent-3", "agent-4", "agent-5"]);
});

test("MastraAgentsWidget puts overflow marker at the top", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 5; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: `output ${i}`,
		}));
	}

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store, { maxCards: 4 });
	const lines = widget.render(100);
	widget.dispose();

	assert.match(lines[0], /\+1 more/);
	assert.deepEqual(lines.filter((line) => line.includes("Mastra: agent-")).map(agentLabel), ["agent-2", "agent-3", "agent-4", "agent-5"]);
});

test("MastraAgentsWidget lets a single card use the total line budget", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n"),
	}));

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store, { maxCards: 4, maxLines: 30 });
	const lines = widget.render(100);
	widget.dispose();

	assert.ok(lines.length > 20, `single card should expand into budget, got ${lines.length}`);
	assert.ok(lines.length <= 30, `expected maxLines cap, got ${lines.length}`);
});

function agentLabel(line: string): string {
	const match = line.match(/Mastra: (agent-\d+)/);
	return match?.[1] ?? line;
}

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
