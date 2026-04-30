import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_HARNESS_MODE,
	PI_HARNESS_MODE_MESSAGE_TYPE,
	createHarnessModeMessage,
	createHarnessModeState,
	formatHarnessModeStatus,
	getHarnessModeDefinition,
	type HarnessMode,
} from "./mode.js";

const MODES: readonly HarnessMode[] = ["quick", "balanced", "precision", "auto"];

test("createHarnessModeState defaults to balanced", () => {
	const state = createHarnessModeState();
	assert.equal(state.get(), DEFAULT_HARNESS_MODE);
	assert.equal(state.get(), "balanced");
});

test("createHarnessModeState cycles in stable issue order", () => {
	const state = createHarnessModeState("quick");
	assert.equal(state.cycle(), "balanced");
	assert.equal(state.cycle(), "precision");
	assert.equal(state.cycle(), "auto");
	assert.equal(state.cycle(), "quick");
});

test("createHarnessModeState sets each valid mode", () => {
	const state = createHarnessModeState();
	for (const mode of MODES) {
		assert.equal(state.set(mode), mode);
		assert.equal(state.get(), mode);
	}
});

test("invalid harness modes are rejected", () => {
	assert.throws(() => createHarnessModeState("fast" as HarnessMode), /Invalid harness mode: fast/);
	const state = createHarnessModeState();
	assert.throws(() => state.set("deep" as HarnessMode), /Invalid harness mode: deep/);
	assert.throws(() => getHarnessModeDefinition("slow" as HarnessMode), /Invalid harness mode: slow/);
	assert.throws(() => createHarnessModeMessage("manual" as HarnessMode), /Invalid harness mode: manual/);
});

test("each harness mode has a label, highlight color, and prompt", () => {
	for (const mode of MODES) {
		const definition = getHarnessModeDefinition(mode);
		assert.equal(definition.id, mode);
		assert.equal(typeof definition.label, "string");
		assert.ok(definition.label.length > 0);
		assert.equal(typeof definition.highlightColor, "string");
		assert.ok(definition.highlightColor.length > 0);
		assert.match(definition.prompt, new RegExp(`\\[HARNESS MODE: ${mode.toUpperCase()}\\]`));
	}
});

test("createHarnessModeMessage returns hidden harness context", () => {
	const message = createHarnessModeMessage("precision");
	assert.equal(message.customType, PI_HARNESS_MODE_MESSAGE_TYPE);
	assert.equal(message.customType, "pi-harness-mode");
	assert.equal(message.display, false);
	assert.match(message.content, /\[HARNESS MODE: PRECISION\]/);
});

test("formatHarnessModeStatus returns concise status text", () => {
	assert.equal(formatHarnessModeStatus("auto"), "Mode: auto");
});
