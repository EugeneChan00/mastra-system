import assert from "node:assert/strict";
import test from "node:test";
import { filterPromptScaffolding } from "./index.js";
import { MastraAgentCard } from "./index.js";

// Minimal mock theme that returns plain strings from fg().
const mockTheme: any = {
	fg(color: string, text: string) { return `[${color}]${text}[/${color}]`; },
	bold(text: string) { return `**${text}**`; },
};

function mockDetails(overrides: Partial<any> = {}): any {
	return {
		status: "done",
		agentId: "test-agent",
		startedAt: Date.now() - 5_000,
		completedAt: Date.now(),
		toolCalls: [],
		toolResults: [],
		text: "",
		prompt: "",
		reasoning: undefined,
		errors: [],
		threadId: "thread-abc",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// filterPromptScaffolding
// ---------------------------------------------------------------------------

test("filterPromptScaffolding: removes 'Expected return status'", () => {
	const input = "Read the file. Expected return status: success.";
	const result = filterPromptScaffolding(input);
	assert.ok(!result.includes("Expected return status"), `Found scaffolding: "${result}"`);
	assert.ok(result.includes("Read the file"), "User content preserved");
});

test("filterPromptScaffolding: removes 'Expected return status:' variants", () => {
	assert.ok(!filterPromptScaffolding("Status: Expected return status: success").includes("Expected return status"));
});

test("filterPromptScaffolding: removes 'Expected return format'", () => {
	const input = "Search the code. Expected return format: JSON object.";
	const result = filterPromptScaffolding(input);
	assert.ok(!result.includes("Expected return format"), `Found scaffolding: "${result}"`);
	assert.ok(result.includes("Search the code"), "User content preserved");
});

test("filterPromptScaffolding: removes 'Expected return format:'", () => {
	const result = filterPromptScaffolding("Result should be: Expected return format: structured.");
	assert.ok(!result.includes("Expected return format"));
});

test("filterPromptScaffolding: removes lowercase 'expected return status'", () => {
	const result = filterPromptScaffolding("Outcome: expected return status: done");
	assert.ok(!result.includes("expected return status"));
});

test("filterPromptScaffolding: removes 'expected return value'", () => {
	const result = filterPromptScaffolding("expected return value: a number");
	assert.ok(!result.includes("expected return value"));
});

test("filterPromptScaffolding: removes 'worker brief' variants", () => {
	assert.ok(!filterPromptScaffolding("worker brief: analyze the repo").includes("worker brief"));
	assert.ok(!filterPromptScaffolding("Worker Brief: examine files").includes("Worker Brief"));
});

test("filterPromptScaffolding: removes 'worker-brief'", () => {
	assert.ok(!filterPromptScaffolding("worker-brief: review output").includes("worker-brief"));
});

test("filterPromptScaffolding: removes 'internal instruction'", () => {
	assert.ok(!filterPromptScaffolding("internal instruction: do not output extra").includes("internal instruction"));
});

test("filterPromptScaffolding: removes 'do not show'", () => {
	const result = filterPromptScaffolding("do not show this part; show the result");
	assert.ok(!result.includes("do not show"));
	assert.ok(result.includes("show the result"), "Valid content should remain");
});

test("filterPromptScaffolding: preserves ordinary user content", () => {
	const inputs = [
		"I would like to return the status of the project",
		"What is the expected format for this file?",
		"Please check the worker brief section in the docs",
		"Show the internal error message",
		"The details should be shown clearly",
		"Do not display that warning again",
		"Expected revenue should be calculated",
	];
	for (const input of inputs) {
		const result = filterPromptScaffolding(input);
		const strippedResult = result.replace(/\s+/g, " ").trim();
		assert.ok(strippedResult.length > 0, `Completely stripped: "${input}" → "${result}"`);
	}
});

test("filterPromptScaffolding: collapses extra whitespace", () => {
	const result = filterPromptScaffolding("Expected return status:   success  and continue");
	assert.ok(!result.includes("  "), "Extra spaces not collapsed: " + result);
});

test("filterPromptScaffolding: handles empty and non-string inputs", () => {
	assert.equal(filterPromptScaffolding(""), "");
	assert.equal(filterPromptScaffolding(null as any), "");
	assert.equal(filterPromptScaffolding(undefined as any), "");
});

test("filterPromptScaffolding: returns text unchanged when no matches", () => {
	const input = "The agent produced the following output.";
	assert.equal(filterPromptScaffolding(input), input);
});

// ---------------------------------------------------------------------------
// Card render alignment (no leading spaces)
// ---------------------------------------------------------------------------

test("MastraAgentCard render: top border line has no leading whitespace", () => {
	const card = new MastraAgentCard(mockDetails({ text: "hello world" }), {}, mockTheme);
	const lines = card.render(60);
	assert.ok(lines.length > 0, "Card produced no lines");
	const topLine = lines[0];
	// The first character of the raw line must NOT be whitespace.
	assert.ok(topLine[0] !== " ", `Top line starts with space: ${JSON.stringify(topLine)}`);
	assert.ok(topLine[0] !== "\t", `Top line starts with tab: ${JSON.stringify(topLine)}`);
});

test("MastraAgentCard render: no line has leading whitespace", () => {
	const card = new MastraAgentCard(mockDetails({ text: "test output content" }), {}, mockTheme);
	const lines = card.render(60);
	for (const line of lines) {
		assert.strictEqual(line[0], line.trimStart()[0], "Line has leading whitespace: " + JSON.stringify(line));
	}
});

test("MastraAgentCard render: bottom border line has no leading whitespace", () => {
	const card = new MastraAgentCard(mockDetails(), {}, mockTheme);
	const lines = card.render(60);
	const bottomLine = lines[lines.length - 1];
	assert.strictEqual(bottomLine[0], bottomLine.trimStart()[0], "Bottom line has leading whitespace");
});

test("MastraAgentCard render: inner content rows start with frame char or label", () => {
	// Check that inner rows have the `│ content │` structure with no extra left pad
	const card = new MastraAgentCard(mockDetails({ text: "inner text" }), {}, mockTheme);
	const lines = card.render(60);
	// All lines except top/bottom must start with the same char as their trimmed version
	const innerLines = lines.slice(1, -1);
	for (const line of innerLines) {
		assert.strictEqual(line[0], line.trimStart()[0], "Inner line has leading spaces: " + JSON.stringify(line));
	}
});

test("MastraAgentCard render: card with scaffolding text is filtered", () => {
	const card = new MastraAgentCard(
		mockDetails({ text: "Result: Expected return status: success. Output ready." }),
		{},
		mockTheme,
	);
	const rendered = card.render(80).join("\n");
	assert.ok(!rendered.includes("Expected return status"), "Scaffolding phrase found in output: " + rendered);
	assert.ok(rendered.includes("Result"), "User content should be preserved");
});

test("MastraAgentCard render: prompt with scaffolding is filtered", () => {
	const card = new MastraAgentCard(
		mockDetails({ prompt: "Expected return status: use the tool. worker brief: complete task." }),
		{},
		mockTheme,
	);
	const rendered = card.render(80).join("\n");
	assert.ok(!rendered.includes("Expected return status"), "Scaffolding in prompt visible: " + rendered);
	assert.ok(!rendered.includes("worker brief"), "worker brief visible in output: " + rendered);
});
