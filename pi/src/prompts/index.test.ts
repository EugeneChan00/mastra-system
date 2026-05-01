import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	PI_AGENT_AS_TOOL_PROMPT,
	PI_AGENT_COMMUNICATION_POLICY,
	PI_AGENT_DEVELOPMENT_POLICY,
	PI_AGENT_ENVIRONMENT_EXECUTION_POLICY,
	PI_AGENT_EXECUTION_VERIFICATION_POLICY,
	PI_AGENT_NON_ORCHESTRATION_POLICY_PROMPT,
	PI_AGENT_ORCHESTRATION_AND_USAGE_POLICY_PROMPT,
	PI_AGENT_ORCHESTRATION_AND_USAGE_PROMPT,
	PI_AGENT_ORCHESTRATION_AND_USAGE_TOOLING_PROMPT,
	PI_AGENT_POLICY_PROMPT,
	PI_AGENT_PROMPT_TOOL_USAGE_PROMPT,
	PI_AGENT_STARTUP_CONTEXT_MESSAGE_TYPE,
	PI_AGENT_STARTUP_CONTEXT_PROMPT,
	PI_AGENT_SYSTEM_PROMPT,
	PI_AGENT_TOOLING_PROMPT,
	composePiAgentSystemPrompt,
	createPiAgentResourceLoader,
	createPiAgentStartupContextMessage,
} from "./index.js";

test("prompt barrel exports Pi coding orchestrator identity", () => {
	assert.equal(typeof PI_AGENT_SYSTEM_PROMPT, "string");
	assert.match(PI_AGENT_SYSTEM_PROMPT, /You are Pi, a coding-agent orchestrator/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /## Identity/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /## Orchestration Judgment/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /Specialist agents/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /Team lead agents/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /Advisor agents/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /Persist until the task is fully handled end-to-end/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /Treat execution as the default/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /Continue through implementation, targeted verification, and repair/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /you -> advisor agent -> user/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /Ask an advisor first/);
	assert.match(PI_AGENT_SYSTEM_PROMPT, /worker agents are not authorities/i);
	assert.doesNotMatch(PI_AGENT_SYSTEM_PROMPT, /Palmer/);
});

test("system prompt composer appends Pi prompt once", () => {
	const base = "base prompt";
	const composed = composePiAgentSystemPrompt(base);
	assert.match(composed, /base prompt/);
	assert.match(composed, /You are Pi, a coding-agent orchestrator/);
	assert.equal(composePiAgentSystemPrompt(composed), composed);
	assert.equal(composed.match(/You are Pi, a coding-agent orchestrator/g)?.length, 1);
});

test("system prompt composer replaces an auto-loaded Pi append block", () => {
	const base = [
		"base prompt",
		"You are Pi, a coding-agent orchestrator operating through the Pi harness.",
		"old global append content",
		"Use the active startup policy, tooling prompts, harness mode context, and user instructions as the operating contract.",
		"tail context",
	].join("\n\n");
	const composed = composePiAgentSystemPrompt(base);
	assert.match(composed, /base prompt/);
	assert.match(composed, /tail context/);
	assert.doesNotMatch(composed, /old global append content/);
	assert.equal(composed.match(/You are Pi, a coding-agent orchestrator/g)?.length, 1);
});

test("system prompt composer replaces a legacy Palmer append block", () => {
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
	assert.doesNotMatch(composed, /You are Palmer/);
	assert.equal(composed.match(/You are Pi, a coding-agent orchestrator/g)?.length, 1);
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
	assert.match(loader.getSystemPrompt() ?? "", /You are Pi, a coding-agent orchestrator/);
	assert.doesNotMatch(loader.getSystemPrompt() ?? "", /You are Palmer/);
	assert.deepEqual(loader.getAppendSystemPrompt(), []);
});

test("tooling prompt composes agent tooling and prompt-to-tool binding guidance", () => {
	assert.match(PI_AGENT_AS_TOOL_PROMPT, /Agents as tools/);
	assert.match(PI_AGENT_AS_TOOL_PROMPT, /input_args/);
	assert.match(PI_AGENT_PROMPT_TOOL_USAGE_PROMPT, /Prompt-to-tool binding/);
	assert.match(PI_AGENT_PROMPT_TOOL_USAGE_PROMPT, /TARGET_FILE: \$1/);
	assert.ok(
		PI_AGENT_ORCHESTRATION_AND_USAGE_TOOLING_PROMPT.includes(
			PI_AGENT_AS_TOOL_PROMPT,
		),
	);
	assert.ok(
		PI_AGENT_ORCHESTRATION_AND_USAGE_TOOLING_PROMPT.includes(
			PI_AGENT_PROMPT_TOOL_USAGE_PROMPT,
		),
	);
	assert.equal(
		PI_AGENT_TOOLING_PROMPT,
		PI_AGENT_ORCHESTRATION_AND_USAGE_TOOLING_PROMPT,
	);
	assert.doesNotMatch(PI_AGENT_TOOLING_PROMPT, /Agent roles/);
	assert.doesNotMatch(PI_AGENT_TOOLING_PROMPT, /Scout handles local repository/);
});

test("policy prompt composes environment, development, and verification policy", () => {
	assert.match(PI_AGENT_COMMUNICATION_POLICY, /Policy vs tool guidance/);
	assert.match(PI_AGENT_COMMUNICATION_POLICY, /input_args binding/);
	assert.match(PI_AGENT_ENVIRONMENT_EXECUTION_POLICY, /Environment execution policy/);
	assert.match(PI_AGENT_DEVELOPMENT_POLICY, /Preserve unrelated worktree changes/);
	assert.match(PI_AGENT_EXECUTION_VERIFICATION_POLICY, /Core invariant: agent output is an unverified claim/);
	assert.match(PI_AGENT_EXECUTION_VERIFICATION_POLICY, /False-positive patterns/);
	assert.match(PI_AGENT_EXECUTION_VERIFICATION_POLICY, /Verification decision matrix/);
	assert.match(PI_AGENT_NON_ORCHESTRATION_POLICY_PROMPT, /Agent behavior policy/);
	assert.match(PI_AGENT_NON_ORCHESTRATION_POLICY_PROMPT, /Development policy/);
	assert.doesNotMatch(
		PI_AGENT_NON_ORCHESTRATION_POLICY_PROMPT,
		/Agent orchestration policy/,
	);
	assert.match(
		PI_AGENT_ORCHESTRATION_AND_USAGE_POLICY_PROMPT,
		/Agent communication policy/,
	);
	assert.match(
		PI_AGENT_ORCHESTRATION_AND_USAGE_POLICY_PROMPT,
		/Agent orchestration policy/,
	);
	assert.doesNotMatch(
		PI_AGENT_ORCHESTRATION_AND_USAGE_POLICY_PROMPT,
		/Development policy/,
	);
	assert.ok(
		PI_AGENT_ORCHESTRATION_AND_USAGE_PROMPT.includes(
			PI_AGENT_ORCHESTRATION_AND_USAGE_TOOLING_PROMPT,
		),
	);
	assert.ok(
		PI_AGENT_ORCHESTRATION_AND_USAGE_PROMPT.includes(
			PI_AGENT_ORCHESTRATION_AND_USAGE_POLICY_PROMPT,
		),
	);
	assert.ok(
		PI_AGENT_POLICY_PROMPT.includes(PI_AGENT_NON_ORCHESTRATION_POLICY_PROMPT),
	);
	assert.ok(
		PI_AGENT_POLICY_PROMPT.includes(
			PI_AGENT_ORCHESTRATION_AND_USAGE_POLICY_PROMPT,
		),
	);
	assert.ok(PI_AGENT_POLICY_PROMPT.includes(PI_AGENT_COMMUNICATION_POLICY));
	assert.ok(PI_AGENT_POLICY_PROMPT.includes(PI_AGENT_ENVIRONMENT_EXECUTION_POLICY));
	assert.ok(PI_AGENT_POLICY_PROMPT.includes(PI_AGENT_DEVELOPMENT_POLICY));
	assert.ok(PI_AGENT_POLICY_PROMPT.includes(PI_AGENT_EXECUTION_VERIFICATION_POLICY));
});

test("startup context message composes tooling and policy prompts", () => {
	const message = createPiAgentStartupContextMessage();
	assert.equal(message.customType, PI_AGENT_STARTUP_CONTEXT_MESSAGE_TYPE);
	assert.equal(message.display, false);
	assert.equal(message.content, PI_AGENT_STARTUP_CONTEXT_PROMPT);
	assert.match(message.content, /Agents as tools/);
	assert.match(message.content, /Environment execution policy/);
	assert.match(message.content, /Execution and verification policy/);
	assert.ok(message.content.includes(PI_AGENT_NON_ORCHESTRATION_POLICY_PROMPT));
	assert.ok(message.content.includes(PI_AGENT_ORCHESTRATION_AND_USAGE_PROMPT));
});
