import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	PI_AGENT_ENV_EXECUTION_POLICY,
	PI_AGENT_POLICY_CONTENT,
	PI_AGENT_POLICY_PROMPT,
	PI_AGENT_STARTUP_CONTEXT_MESSAGE_TYPE,
	PI_AGENT_STARTUP_CONTEXT_PROMPT,
	PI_AGENT_SYSTEM_PROMPT,
	PI_AGENT_TOOLING_BEST_PRACTICES,
	PI_AGENT_TOOLING_DECISION_MATRIX,
	PI_AGENT_TOOLING_PROMPT,
	composePiAgentSystemPrompt,
	createPiAgentResourceLoader,
	createPiAgentStartupContextMessage,
} from "./index.js";

test("prompt barrel exports system prompt content", () => {
	assert.equal(typeof PI_AGENT_SYSTEM_PROMPT, "string");
	assert.match(PI_AGENT_SYSTEM_PROMPT, /You are Palmer/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /Primary operating principle/);
});

test("system prompt composer appends Palmer prompt once", () => {
	const base = "base prompt";
	const composed = composePiAgentSystemPrompt(base);
	assert.match(composed, /base prompt/);
	assert.match(composed, /You are Palmer/);
	assert.equal(composePiAgentSystemPrompt(composed), composed);
});

test("system prompt composer replaces an auto-loaded Palmer append block", () => {
	const base = [
		"base prompt",
		"You are Palmer, a Pi-based agent orchestrator operating through the Pi agentic harness.",
		"old global append content",
		"Finalize only when the evidence supports the result.",
		"tail context",
	].join("\n\n");
	const composed = composePiAgentSystemPrompt(base);
	assert.match(composed, /base prompt/);
	assert.match(composed, /tail context/);
	assert.doesNotMatch(composed, /old global append content/);
	assert.equal(composed.match(/You are Palmer, a Pi-based agent orchestrator/g)?.length, 1);
});

test("Pi agent resource loader uses SDK system prompt override", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-loader-cwd-"));
	const agentDir = await mkdtemp(join(tmpdir(), "pi-loader-agent-"));
	t.after(async () => {
		await Promise.all([
			rm(cwd, { recursive: true, force: true }),
			rm(agentDir, { recursive: true, force: true }),
		]);
	});

	const loader = createPiAgentResourceLoader({
		cwd,
		agentDir,
		systemPrompt: "base system prompt",
		appendSystemPrompt: ["global Palmer append should be ignored"],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();

	assert.match(loader.getSystemPrompt() ?? "", /base system prompt/);
	assert.match(loader.getSystemPrompt() ?? "", /You are Palmer/);
	assert.deepEqual(loader.getAppendSystemPrompt(), []);
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

test("startup context message composes tooling and policy prompts", () => {
	const message = createPiAgentStartupContextMessage();
	assert.equal(message.customType, PI_AGENT_STARTUP_CONTEXT_MESSAGE_TYPE);
	assert.equal(message.display, false);
	assert.equal(message.content, PI_AGENT_STARTUP_CONTEXT_PROMPT);
	assert.match(message.content, /Tooling decision matrix/);
	assert.match(message.content, /Environment execution policy/);
});
