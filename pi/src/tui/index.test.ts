import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
	filterPromptScaffolding,
	MastraAgentActivityStore,
	MastraAgentCard,
	MastraAgentsListWidget,
	MastraAgentsWidget,
	MastraAgentsWidgetViewController,
} from "./index.js";
import type { MastraAgentCallDetails, MastraAgentCallInput } from "../mastra/types.js";

// Stub theme matching the real Theme interface surface used by MastraAgentCard
const stubTheme: Record<string, (...args: string[]) => string> = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	dim: (text: string) => text,
};
const markerTheme: Record<string, (...args: string[]) => string> = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	bold: (text: string) => `<bold>${text}</bold>`,
	dim: (text: string) => `<dim>${text}</dim>`,
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

test("MastraAgentsWidget clamps configured maxLines to terminal viewport rows", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n"),
	}));

	const widget = new MastraAgentsWidget(makeTui(24), stubTheme as any, store, { maxLines: 60 });
	const lines = widget.render(100);
	widget.dispose();

	assert.ok(lines.length <= 13, `expected terminal-aware content budget of 13 lines, got ${lines.length}`);
	assert.ok(lines.length + 1 <= 14, `expected content plus spacer to fit 14-row viewport budget, got ${lines.length + 1}`);
	assert.ok(lines.length > 1, "card should still use available viewport budget");
});

test("MastraAgentsWidget falls back to compact rendering when viewport cannot fit a whole card", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: "streaming output",
	}));

	const widget = new MastraAgentsWidget(makeTui(11), stubTheme as any, store, { maxLines: 60 });
	const lines = widget.render(100);
	widget.dispose();

	assert.ok(lines.length <= 1, `expected tiny viewport clamp, got ${lines.length}`);
	assert.equal(lines.filter((line) => line.includes("Mastra: agent-")).length, 0);
});

test("MastraAgentsWidget emits viewport budget metrics when debug logging is enabled", async () => {
	const previousDebug = process.env.MASTRA_WIDGET_DEBUG;
	const previousDebugPath = process.env.MASTRA_WIDGET_DEBUG_PATH;
	const dir = await mkdtemp(join(tmpdir(), "mastra-widget-debug-"));
	const logPath = join(dir, "widget.log");
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: "streaming output",
	}));

	try {
		process.env.MASTRA_WIDGET_DEBUG = "1";
		process.env.MASTRA_WIDGET_DEBUG_PATH = logPath;
		const widget = new MastraAgentsWidget(makeTui(24), stubTheme as any, store, { maxLines: 60 });
		widget.render(100);
		widget.dispose();

		const log = await readFile(logPath, "utf8");
		assert.match(log, /terminalRows=24/);
		assert.match(log, /configuredMaxLines=60/);
		assert.match(log, /effectiveMaxLines=13/);
		assert.match(log, /spacerRows=1/);
		assert.match(log, /occupiedRows=/);
		assert.match(log, /workingActivities=1/);
		assert.match(log, /hiddenQueuedActivities=0/);
		assert.match(log, /clamped=true/);
		assert.match(log, /renderedLines=/);
	} finally {
		if (previousDebug === undefined) delete process.env.MASTRA_WIDGET_DEBUG;
		else process.env.MASTRA_WIDGET_DEBUG = previousDebug;
		if (previousDebugPath === undefined) delete process.env.MASTRA_WIDGET_DEBUG_PATH;
		else process.env.MASTRA_WIDGET_DEBUG_PATH = previousDebugPath;
		await rm(dir, { recursive: true, force: true });
	}
});

test("MastraAgentsListWidget renders compact default list within spacer-aware budget", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 4; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: `output ${i}`,
			toolCalls: [{ id: `tool-${i}`, name: "workspaceReadFile", type: "call", args: { path: `file-${i}.ts` }, timestamp: i, raw: {} }],
		}));
	}

	const viewController = new MastraAgentsWidgetViewController("list");
	const widget = new MastraAgentsListWidget(makeTui(24), stubTheme as any, store, { viewController, listMaxLines: 11 });
	const lines = widget.render(100);
	widget.dispose();

	assert.ok(lines[0].includes("Mastra Agents"));
	assert.ok(lines.length + 1 <= 11);
	assert.ok(lines.some((line) => line.includes("+2 more")));
	assert.ok(lines.some((line) => line.includes("agent-4")));
	assert.equal(lines.filter((line) => line.includes("├ tools")).length, 2);
	assert.equal(lines.filter((line) => line.includes("└ now")).length, 2);
	assert.ok(lines.some((line) => line.includes("read_file")), "list mode should stream tool events");
	assert.equal(lines.some((line) => line.includes("Mastra: agent-")), false, "list mode should not render full cards");
});

test("MastraAgentsWidget list mode preselects five newest agents before rendering rows", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 6; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: `output ${i}`,
			toolCalls: [{ id: `tool-${i}`, name: "workspaceReadFile", type: "call", args: { path: `file-${i}.ts` }, timestamp: i, raw: {} }],
		}));
	}

	const viewController = new MastraAgentsWidgetViewController("list");
	const widget = new MastraAgentsWidget(makeTui(60), stubTheme as any, store, { viewController, listMaxLines: 18, listMaxAgents: 5 });
	const lines = widget.render(100);
	widget.dispose();

	assert.equal(lines.length, 17);
	assert.ok(lines.some((line) => line.includes("+1 more")));
	assert.equal(lines.some((line) => line.includes("agent-1")), false);
	assert.deepEqual(lines.map(listAgentLabel).filter(Boolean), ["agent-2", "agent-3", "agent-4", "agent-5", "agent-6"]);
	assert.equal(lines.filter((line) => line.includes("├ tools")).length, 5);
	assert.equal(lines.filter((line) => line.includes("└ now")).length, 5);
	assert.equal(lines.some((line) => line.includes("Mastra: agent-")), false);
});

test("MastraAgentsWidget renders list mode and uses a fixed total card region", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: "output",
	}));

	const viewController = new MastraAgentsWidgetViewController("list");
	const widget = new MastraAgentsWidget(makeTui(24), stubTheme as any, store, { viewController, fixedRegion: true, maxLines: 10 });
	const listLines = widget.render(100);
	assert.ok(listLines.some((line) => line.includes("agent-1")));
	assert.equal(listLines.some((line) => line.includes("Mastra: agent-")), false, "list mode should not render full cards");

	viewController.setMode("cards");
	const lines = widget.render(100);
	widget.dispose();

	assert.equal(lines.length, 9);
	assert.ok(lines.length + 1 <= 10);
	assert.ok(lines.some((line) => line.includes("Mastra: agent-1")));
});

test("MastraAgentsWidget list mode does not retain detail region height", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 2; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: Array.from({ length: 20 }, (_, index) => `agent ${i} line ${index + 1}`).join("\n"),
		}));
	}

	const viewController = new MastraAgentsWidgetViewController("detail");
	const widget = new MastraAgentsWidget(makeTui(60), stubTheme as any, store, { viewController, maxLines: 30, listMaxLines: 18, listMaxAgents: 5 });
	const detailLines = widget.render(100);
	viewController.setMode("list");
	const listLines = widget.render(100);
	widget.dispose();

	assert.equal(detailLines.length, 29);
	assert.equal(detailLines.at(-1)?.startsWith("╰"), true);
	assert.equal(listLines.length, 7);
	assert.notEqual(listLines.at(-1), "", "list render should not end with old blank region padding");
	assert.equal(listLines.some((line) => line.includes("Mastra: agent-")), false);
});

test("MastraAgentsWidget detail mode dedicates the region to the focused agent", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 2; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: Array.from({ length: 20 }, (_, index) => `agent ${i} line ${index + 1}`).join("\n"),
		}));
	}

	const viewController = new MastraAgentsWidgetViewController("detail");
	viewController.focusNext(store.snapshot({ includeFinished: false }), 1);
	const widget = new MastraAgentsWidget(makeTui(30), stubTheme as any, store, { viewController, fixedRegion: true, maxLines: 12 });
	const firstFocus = widget.render(100);
	viewController.focusNext(store.snapshot({ includeFinished: false }), 1);
	const secondFocus = widget.render(100);
	widget.dispose();

	assert.equal(firstFocus.length, 11);
	assert.ok(firstFocus.length + 1 <= 12);
	assert.ok(firstFocus.some((line) => line.includes("Mastra: agent-1")));
	assert.equal(secondFocus.length, 11);
	assert.ok(secondFocus.length + 1 <= 12);
	assert.ok(secondFocus.some((line) => line.includes("Mastra: agent-2")));
	assert.equal(secondFocus.filter((line) => line.includes("Mastra: agent-")).length, 1);
});

test("MastraAgentsWidget detail mode scrolls within fixed region", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n"),
	}));

	const viewController = new MastraAgentsWidgetViewController("detail");
	const widget = new MastraAgentsWidget(makeTui(30), stubTheme as any, store, { viewController, fixedRegion: true, maxLines: 12 });
	const liveLines = widget.render(100);
	viewController.scrollDetailUp("call-1", 10);
	const scrolledLines = widget.render(100);
	viewController.scrollDetailDown("call-1", 10);
	const returnedLines = widget.render(100);
	widget.dispose();

	assert.equal(liveLines.length, 11);
	assert.equal(scrolledLines.length, 11);
	assert.equal(returnedLines.length, 11);
	assert.ok(liveLines.join("\n").includes("line 40"), "live detail should follow newest output");
	assert.ok(scrolledLines.join("\n").includes("later lines"), "scrolled detail should show hidden later marker");
	assert.equal(scrolledLines.join("\n").includes("line 40"), false, "scrolling up should move away from live tail");
	assert.ok(returnedLines.join("\n").includes("line 40"), "scrolling down should return to live tail");
});

test("MastraAgentsWidget detail mode clamps displayed scroll offset to rendered content", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: "short output",
	}));

	const viewController = new MastraAgentsWidgetViewController("detail");
	viewController.scrollDetailUp("call-1", 100);
	const widget = new MastraAgentsWidget(makeTui(30), stubTheme as any, store, { viewController, fixedRegion: true, maxLines: 12 });
	const lines = widget.render(100);
	widget.dispose();

	assert.equal(lines.some((line) => line.includes("scroll +")), false, "short output should not show an impossible scroll offset");
	assert.equal(viewController.getDetailScrollOffset("call-1"), 0, "render should clear latent impossible scroll offsets");
});

test("MastraAgentsWidget detail mode avoids clipped card frames in tiny viewports", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: "short output",
	}));

	const viewController = new MastraAgentsWidgetViewController("detail");
	const widget = new MastraAgentsWidget(makeTui(13), stubTheme as any, store, { viewController, fixedRegion: true, maxLines: 60, reservedRows: 10 });
	const lines = widget.render(100);
	widget.dispose();

	assert.equal(lines.length, 2);
	assert.equal(lines.some((line) => line.startsWith("╭")), false);
	assert.equal(lines.some((line) => line.startsWith("╰")), false);
	assert.ok(lines.some((line) => line.includes("short output")));
});

test("MastraAgentsWidgetViewController resets and prunes detail-only state", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: "output",
	}));
	const viewController = new MastraAgentsWidgetViewController("detail");
	viewController.focusNext(store.snapshot({ includeFinished: false }), 1);
	viewController.toggleDetailStreamOnly();
	viewController.scrollDetailUp("call-1", 10);

	assert.equal(viewController.isDetailStreamOnly(), true);
	assert.equal(viewController.getDetailScrollOffset("call-1"), 10);

	viewController.syncActivities([]);
	assert.equal(viewController.getDetailScrollOffset("call-1"), 0, "scroll offsets should be dropped for non-visible jobs");

	viewController.reset("list");
	assert.equal(viewController.getMode(), "list");
	assert.equal(viewController.isDetailStreamOnly(), false, "new sessions should not inherit stream-only detail state");
});

test("MastraAgentsWidget detail stream-only mode hides prompt and reasoning", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "submitted prompt" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		prompt: "submitted prompt",
		text: "streamed output",
		reasoning: "private reasoning",
		toolCalls: [{ id: "tool-1", name: "workspaceReadFile", type: "call", args: { path: "src/index.ts" }, timestamp: 1, raw: {} }],
		toolResults: [{ id: "tool-1", name: "workspaceReadFile", type: "result", args: { path: "src/index.ts" }, result: "tool result body", timestamp: 2, raw: {} }],
	}));

	const viewController = new MastraAgentsWidgetViewController("detail");
	const widget = new MastraAgentsWidget(makeTui(30), stubTheme as any, store, { viewController, fixedRegion: true, maxLines: 18 });
	const fullLines = widget.render(100).join("\n");
	viewController.toggleDetailStreamOnly();
	const streamOnlyLines = widget.render(100).join("\n");
	widget.dispose();

	assert.ok(fullLines.includes("Prompt"));
	assert.ok(fullLines.includes("Reasoning"));
	assert.ok(streamOnlyLines.includes("stream-only"));
	assert.ok(streamOnlyLines.includes("streamed output"));
	assert.ok(streamOnlyLines.includes("read_file"), "stream-only detail should keep tool events visible");
	assert.equal(streamOnlyLines.includes("submitted prompt"), false);
	assert.equal(streamOnlyLines.includes("private reasoning"), false);
});

test("MastraAgentCard renders expanded tool output through markdown", () => {
	const details = makeDetails({
		text: "answer",
		toolResults: [{
			id: "tool-1",
			name: "workspaceReadFile",
			type: "result",
			args: { path: "README.md" },
			result: "Tool says **bold**\n\n- first\n- second",
			timestamp: 1,
			raw: {},
		}],
	});
	const card = new MastraAgentCard(details, { expanded: true, fixedTotalLines: 28 }, stubTheme as any);
	const joined = card.render(100).join("\n");

	assert.ok(joined.includes("read_file"));
	assert.ok(joined.includes("Tool says"));
	assert.ok(joined.includes("bold"));
	assert.equal(joined.includes("**bold**"), false);
});

test("MastraAgentCard stream-only tool output keeps markdown body at normal contrast", () => {
	const details = makeDetails({
		text: "answer",
		toolResults: [{
			id: "tool-1",
			name: "workspaceReadFile",
			type: "result",
			args: { path: "README.md" },
			result: "Tool says **bold**",
			timestamp: 1,
			raw: {},
		}],
	});
	const card = new MastraAgentCard(details, { expanded: true, streamOnly: true, fixedTotalLines: 24 }, markerTheme as any);
	const joined = card.render(120).join("\n");

	assert.ok(joined.includes("Tool says"));
	assert.ok(joined.includes("<dim>  ⎿ </dim>"), "tool-output prefix should remain secondary");
	assert.equal(joined.includes("<dim>Tool says"), false, "tool-output body should not inherit dim styling");
	assert.equal(joined.includes("**bold**"), false);
});

test("MastraAgentCard renders reasoning through markdown in expanded mode", () => {
	const details = makeDetails({
		text: "answer",
		reasoning: "Reasoning says **bold**",
	});
	const card = new MastraAgentCard(details, { expanded: true, fixedTotalLines: 18 }, stubTheme as any);
	const joined = card.render(100).join("\n");

	assert.ok(joined.includes("Reasoning"));
	assert.ok(joined.includes("bold"));
	assert.equal(joined.includes("**bold**"), false);
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

test("MastraAgentsWidget removes completed jobs from visible cards immediately", () => {
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

	assert.deepEqual(before.map(agentLabel), ["agent-1", "agent-2", "agent-3", "agent-4"]);
	assert.deepEqual(after.map(agentLabel), ["agent-2", "agent-3", "agent-4"]);
	assert.equal(after.some((line) => line.includes("done")), false);
	assert.equal(store.snapshot().some((activity) => activity.toolCallId === "call-1" && activity.lifecycleStatus === "agent_response_queued"), true);
});

test("MastraAgentsWidget keeps queued completion hidden after late updates", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: "running",
	}));
	store.finish("call-1", makeDetails({ agentId: "agent-1", status: "done", text: "complete" }));
	store.update("call-1", makeDetails({ agentId: "agent-1", status: "running", text: "late running update" }));

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store);
	const lines = widget.render(100);
	widget.dispose();

	assert.deepEqual(lines, []);
	assert.equal(store.snapshot()[0]?.lifecycleStatus, "agent_response_queued");
});

test("MastraAgentActivityStore keeps queued completions until explicit end", async () => {
	const store = new MastraAgentActivityStore(0);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: "running",
	}));
	store.finish("call-1", makeDetails({ agentId: "agent-1", status: "done", text: "complete" }));

	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(store.snapshot()[0]?.lifecycleStatus, "agent_response_queued");

	store.update("call-1", makeDetails({ agentId: "agent-1", status: "running", text: "late running update" }));
	assert.equal(store.snapshot()[0]?.lifecycleStatus, "agent_response_queued");

	store.end("call-1");
	assert.deepEqual(store.snapshot(), []);
});

test("MastraAgentActivityStore ignores late updates after explicit end", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: "running",
	}));

	store.end("call-1");
	store.update("call-1", makeDetails({ agentId: "agent-1", status: "aborted", text: "late update" }));
	store.finish("call-1", makeDetails({ agentId: "agent-1", status: "aborted", text: "late finish" }));

	assert.deepEqual(store.snapshot(), []);
});

test("MastraAgentsWidget treats a later same-agent dispatch as newest active work", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 4; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			threadId: "thread-shared",
			status: "running",
			text: `output ${i}`,
		}));
	}

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store, { maxCards: 5 });
	store.finish("call-1", makeDetails({ agentId: "agent-1", threadId: "thread-shared", status: "done", text: "complete" }));
	store.start("call-5", { agentId: "agent-1", message: "retry task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		threadId: "thread-shared",
		status: "running",
		text: "new output",
	}));
	const lines = widget.render(100);
	const labels = lines.filter((line) => line.includes("Mastra: agent-")).map(agentLabel);
	widget.dispose();

	assert.deepEqual(labels, ["agent-2", "agent-3", "agent-4", "agent-1"]);
	assert.equal(labels.filter((label) => label === "agent-1").length, 1);
	assert.ok(lines.some((line) => line.includes("new output")));
	assert.equal(lines.some((line) => line.includes("complete")), false);
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

test("MastraAgentsWidget appends new cards from the bottom after ended cards collapse", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 4; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: `output ${i}`,
		}));
	}

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store, { maxCards: 4 });
	store.finish("call-1", makeDetails({ agentId: "agent-1", status: "done", text: "complete" }));
	assert.deepEqual(widget.render(100).filter((line) => line.includes("Mastra: agent-")).map(agentLabel), ["agent-2", "agent-3", "agent-4"]);

	store.end("call-1");
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
	assert.ok(lines.length + 1 <= 30, `expected total maxLines cap including spacer, got ${lines.length + 1}`);
});

test("MastraAgentsWidget pads short single-card content inside the frame", () => {
	const store = new MastraAgentActivityStore(60_000);
	store.start("call-1", { agentId: "agent-1", message: "task" } as MastraAgentCallInput, makeDetails({
		agentId: "agent-1",
		status: "running",
		text: "short output",
	}));

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store, { maxCards: 4, maxLines: 30 });
	const lines = widget.render(100);
	widget.dispose();

	assert.equal(lines.length, 29);
	assert.equal(lines.at(-1)?.startsWith("╰"), true);
	assert.equal(lines.some((line) => line === ""), false, "fixed card region should not use trailing blank lines outside the frame");
});

test("MastraAgentsWidget divides total height budget across multiple long cards", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 3; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: Array.from({ length: 80 }, (_, index) => `agent ${i} line ${index + 1}`).join("\n"),
		}));
	}

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store, { maxCards: 4, maxLines: 30 });
	const lines = widget.render(100);
	widget.dispose();

	assert.equal(lines.filter((line) => line.includes("Mastra: agent-")).length, 3);
	assert.ok(lines.length <= 30, `expected aggregate maxLines cap, got ${lines.length}`);
	assert.notEqual(lines.at(-1), "", "shared card region should not end with blank padding");
	for (const label of ["agent-1", "agent-2", "agent-3"]) {
		assert.ok(lines.some((line) => line.includes(`Mastra: ${label}`)), `${label} should stay visible`);
	}
	for (let i = 1; i <= 3; i++) {
		assert.ok(lines.some((line) => line.includes(`agent ${i} line 80`)), `agent-${i} should retain body output within shared budget`);
	}
});

test("MastraAgentsWidget preserves whole newest cards under tight height budget", () => {
	const store = new MastraAgentActivityStore(60_000);
	for (let i = 1; i <= 5; i++) {
		store.start(`call-${i}`, { agentId: `agent-${i}`, message: `task ${i}` } as MastraAgentCallInput, makeDetails({
			agentId: `agent-${i}`,
			status: "running",
			text: Array.from({ length: 20 }, (_, index) => `agent ${i} line ${index + 1}`).join("\n"),
		}));
	}

	const widget = new MastraAgentsWidget({ requestRender() {} }, stubTheme as any, store, { maxCards: 4, maxLines: 13 });
	const lines = widget.render(100);
	widget.dispose();

	assert.ok(lines.length + 1 <= 13, `expected tight total maxLines cap, got ${lines.length + 1}`);
	assert.match(lines[0], /\+3 more/);
	assert.deepEqual(lines.filter((line) => line.includes("Mastra: agent-")).map(agentLabel), ["agent-4", "agent-5"]);
	assert.equal(lines.filter((line) => line.startsWith("╭")).length, 2);
	assert.equal(lines.filter((line) => line.startsWith("╰")).length, 2);
	assert.equal(lines.at(-1)?.startsWith("╰"), true, "render should end at a whole-card bottom border");
	assert.notEqual(lines.at(-1), "", "tight card region should not end with blank padding");
});

function agentLabel(line: string): string {
	const match = line.match(/Mastra: (agent-\d+)/);
	return match?.[1] ?? line;
}

function listAgentLabel(line: string): string | undefined {
	return line.match(/\b(agent-\d+)\b/)?.[1];
}

function makeTui(rows?: number): { requestRender(): void; terminal?: { rows: number } } {
	return rows === undefined ? { requestRender() {} } : { requestRender() {}, terminal: { rows } };
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
