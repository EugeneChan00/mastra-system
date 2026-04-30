import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS,
	DEFAULT_MASTRA_AGENT_VIEW_MODE,
	DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS,
	loadMastraAgentExtensionConfig,
} from "./config.js";

test("loadMastraAgentExtensionConfig uses defaults when config.yaml is missing", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-missing-"));
	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.found, false);
	assert.deepEqual(result.options, DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS);
	assert.equal(result.debugPiRedraw, false);
	assert.equal(result.defaultViewMode, DEFAULT_MASTRA_AGENT_VIEW_MODE);
	assert.deepEqual(result.shortcuts, DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS);
	assert.equal(result.warning, undefined);
});

test("loadMastraAgentExtensionConfig reads widget and debug values from config.yaml", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-valid-"));
	await writeFile(
		join(cwd, "config.yaml"),
		"mastra-agent-extension:\n  maxCards: 4\n  maxLines: 60\n  listMaxLines: 10\n  listMaxAgents: 5\n  reservedRows: 12\n  colors:\n    prompt: syntaxString\n    tool: syntaxString\n    reasoning: muted\n  defaultViewMode: cards\n  viewModeShortcut: ctrl+]\n  nextAgentShortcut: alt+n\n  previousAgentShortcut: alt+p\n  detailScrollDownShortcut: alt+d\n  detailScrollUpShortcut: alt+u\n  detailStreamOnlyShortcut: alt+t\n  debug: true\n  debugPiRedraw: true\n  debugLogPath: /tmp/mastra-widget.log\n",
		"utf8",
	);

	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.found, true);
	assert.deepEqual(result.options, {
		maxCards: 4,
		maxLines: 60,
		listMaxAgents: 5,
		colors: { prompt: "syntaxString", tool: "syntaxString", reasoning: "muted" },
		listMaxLines: 10,
		reservedRows: 12,
		debug: true,
		debugLogPath: "/tmp/mastra-widget.log",
	});
	assert.equal(result.debugPiRedraw, true);
	assert.equal(result.defaultViewMode, "cards");
	assert.deepEqual(result.shortcuts, {
		viewMode: "ctrl+]",
		nextAgent: "alt+n",
		previousAgent: "alt+p",
		detailScrollDown: "alt+d",
		detailScrollUp: "alt+u",
		detailStreamOnly: "alt+t",
	});
	assert.equal(result.warning, undefined);
});

test("loadMastraAgentExtensionConfig ignores invalid values and keeps valid values", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-invalid-values-"));
	await writeFile(join(cwd, "config.yaml"), "mastra-agent-extension:\n  maxCards: nope\n  maxLines: 60\n  listMaxAgents: nope\n", "utf8");

	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.found, true);
	assert.deepEqual(result.options, {
		maxCards: DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.maxCards,
		maxLines: 60,
		listMaxAgents: DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.listMaxAgents,
		colors: DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.colors,
	});
	assert.equal(result.debugPiRedraw, false);
	assert.match(result.warning ?? "", /maxCards/);
	assert.match(result.warning ?? "", /listMaxAgents/);
});

test("loadMastraAgentExtensionConfig validates configurable widget colors", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-colors-"));
	await writeFile(join(cwd, "config.yaml"), "mastra-agent-extension:\n  colors:\n    prompt: syntaxString\n    tool: nope\n    reasoning: muted\n", "utf8");

	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.found, true);
	assert.deepEqual(result.options.colors, { prompt: "syntaxString", tool: "syntaxString", reasoning: "muted" });
	assert.match(result.warning ?? "", /colors\.tool/);
});

test("loadMastraAgentExtensionConfig lets debug enable Pi redraw logging by default", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-debug-default-"));
	await writeFile(join(cwd, "config.yaml"), "mastra-agent-extension:\n  debug: true\n", "utf8");

	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.debugPiRedraw, true);
	assert.deepEqual(result.options, { ...DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS, debug: true });
});

test("loadMastraAgentExtensionConfig lets debugPiRedraw override debug", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-debug-override-"));
	await writeFile(join(cwd, "config.yaml"), "mastra-agent-extension:\n  debug: true\n  debugPiRedraw: false\n", "utf8");

	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.debugPiRedraw, false);
	assert.deepEqual(result.options, { ...DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS, debug: true });
});

test("loadMastraAgentExtensionConfig falls back to defaults for invalid YAML", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-invalid-yaml-"));
	await writeFile(join(cwd, "config.yaml"), "mastra-agent-extension:\n  maxCards: [", "utf8");

	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.found, true);
	assert.deepEqual(result.options, DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS);
	assert.equal(result.debugPiRedraw, false);
	assert.match(result.warning ?? "", /Could not parse/);
});
