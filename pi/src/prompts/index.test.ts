import assert from "node:assert/strict";
import test from "node:test";
import {
	PI_AGENT_ENV_EXECUTION_POLICY,
	PI_AGENT_POLICY_CONTENT,
	PI_AGENT_POLICY_PROMPT,
	PI_AGENT_SYSTEM_PROMPT,
	PI_AGENT_TOOLING_BEST_PRACTICES,
	PI_AGENT_TOOLING_DECISION_MATRIX,
	PI_AGENT_TOOLING_PROMPT,
} from "./index.js";

test("prompt barrel exports system prompt content", () => {
	assert.equal(typeof PI_AGENT_SYSTEM_PROMPT, "string");
	assert.match(PI_AGENT_SYSTEM_PROMPT, /interactive coding harness/);
});

test("tooling prompt composes decision matrix and best practices", () => {
	assert.match(PI_AGENT_TOOLING_DECISION_MATRIX, /Tooling decision matrix/);
	assert.match(PI_AGENT_TOOLING_BEST_PRACTICES, /Tooling best practices/);
	assert.ok(PI_AGENT_TOOLING_PROMPT.includes(PI_AGENT_TOOLING_DECISION_MATRIX));
	assert.ok(PI_AGENT_TOOLING_PROMPT.includes(PI_AGENT_TOOLING_BEST_PRACTICES));
});

test("policy prompt exports environment policy and content map", () => {
	assert.match(PI_AGENT_ENV_EXECUTION_POLICY, /Environment execution policy/);
	assert.deepEqual(Object.keys(PI_AGENT_POLICY_CONTENT), [
		"envExecution",
		"fileMutation",
		"evidenceVerification",
		"delegation",
		"userInterruption",
		"riskBlocker",
	]);
	assert.ok(PI_AGENT_POLICY_PROMPT.includes(PI_AGENT_ENV_EXECUTION_POLICY));
	assert.ok(PI_AGENT_POLICY_PROMPT.includes(PI_AGENT_POLICY_CONTENT.fileMutation));
});
