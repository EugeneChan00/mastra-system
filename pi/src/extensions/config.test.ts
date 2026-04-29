import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS, loadMastraAgentExtensionConfig } from "./config.js";

test("loadMastraAgentExtensionConfig uses defaults when config.yaml is missing", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-missing-"));
	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.found, false);
	assert.deepEqual(result.options, DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS);
	assert.equal(result.warning, undefined);
});

test("loadMastraAgentExtensionConfig reads maxCards and maxLines from config.yaml", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-valid-"));
	await writeFile(join(cwd, "config.yaml"), "mastra-agent-extension:\n  maxCards: 4\n  maxLines: 60\n", "utf8");

	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.found, true);
	assert.deepEqual(result.options, { maxCards: 4, maxLines: 60 });
	assert.equal(result.warning, undefined);
});

test("loadMastraAgentExtensionConfig ignores invalid values and keeps valid values", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-invalid-values-"));
	await writeFile(join(cwd, "config.yaml"), "mastra-agent-extension:\n  maxCards: nope\n  maxLines: 60\n", "utf8");

	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.found, true);
	assert.deepEqual(result.options, { maxCards: DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.maxCards, maxLines: 60 });
	assert.match(result.warning ?? "", /maxCards/);
});

test("loadMastraAgentExtensionConfig falls back to defaults for invalid YAML", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "mastra-config-invalid-yaml-"));
	await writeFile(join(cwd, "config.yaml"), "mastra-agent-extension:\n  maxCards: [", "utf8");

	const result = await loadMastraAgentExtensionConfig(cwd);
	assert.equal(result.found, true);
	assert.deepEqual(result.options, DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS);
	assert.match(result.warning ?? "", /Could not parse/);
});
