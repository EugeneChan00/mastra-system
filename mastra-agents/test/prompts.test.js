import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "@mariozechner/jiti";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);

const prompts = await jiti.import("../src/prompts/index.ts");
const promptModules = {
	advisor: await jiti.import("../src/prompts/agents/advisor.ts"),
	architect: await jiti.import("../src/prompts/agents/architect.ts"),
	developer: await jiti.import("../src/prompts/agents/developer.ts"),
	researcher: await jiti.import("../src/prompts/agents/researcher.ts"),
	scout: await jiti.import("../src/prompts/agents/scout.ts"),
	supervisor: await jiti.import("../src/prompts/agents/supervisor.ts"),
	validator: await jiti.import("../src/prompts/agents/validator.ts"),
};
const agentModules = {
	advisor: await jiti.import("../src/agents/advisor-agent.ts"),
	architect: await jiti.import("../src/agents/architect-agent.ts"),
	developer: await jiti.import("../src/agents/developer-agent.ts"),
	researcher: await jiti.import("../src/agents/researcher-agent.ts"),
	scout: await jiti.import("../src/agents/scout-agent.ts"),
	supervisor: await jiti.import("../src/agents/agent.ts"),
	validator: await jiti.import("../src/agents/validator-agent.ts"),
};
const agentsIndex = await jiti.import("../src/agents/index.ts");

const expectedAgentPromptFiles = [
	"advisor.ts",
	"architect.ts",
	"developer.ts",
	"researcher.ts",
	"scout.ts",
	"supervisor.ts",
	"validator.ts",
];

const agentRegistrationFiles = [
	"advisor-agent.ts",
	"architect-agent.ts",
	"developer-agent.ts",
	"researcher-agent.ts",
	"scout-agent.ts",
	"agent.ts",
	"validator-agent.ts",
];

const removedBuilderExports = [
	"buildAdvisorPrompt",
	"buildArchitectPrompt",
	"buildDeveloperPrompt",
	"buildResearcherPrompt",
	"buildScoutPrompt",
	"buildSupervisorPrompt",
	"buildValidatorPrompt",
];

const removedSharedFragmentExports = [
	"evidenceDisciplinePrompt",
	"blockerProtocolPrompt",
	"specialistToolRuntimePrompt",
	"supervisorToolPrompt",
	"agentsAsToolsPrompt",
	"promptToolUsagePrompt",
];

const agentContracts = [
	{
		name: "advisor",
		agentExport: "advisorAgent",
		instructionsExport: "advisorInstructionsPrompt",
		policyExport: "advisorPolicyPrompts",
		toolExport: "advisorToolPrompts",
		agentContextNeedle: "Severity model:",
		sharedPolicyNeedle: "Agent orchestration policy",
		sharedToolNeedle: "Agents as tools",
		orchestratorCommon: true,
	},
	{
		name: "architect",
		agentExport: "architectAgent",
		instructionsExport: "architectInstructionsPrompt",
		policyExport: "architectPolicyPrompts",
		toolExport: "architectToolPrompts",
		agentContextNeedle: "Vertical-slice discipline:",
		sharedPolicyNeedle: "Agent behavior policy",
		sharedToolNeedle: "Operate inside the tools exposed",
	},
	{
		name: "developer",
		agentExport: "developerAgent",
		instructionsExport: "developerInstructionsPrompt",
		policyExport: "developerPolicyPrompts",
		toolExport: "developerToolPrompts",
		agentContextNeedle: "Implementation authority:",
		sharedPolicyNeedle: "Agent behavior policy",
		sharedToolNeedle: "Operate inside the tools exposed",
	},
	{
		name: "researcher",
		agentExport: "researcherAgent",
		instructionsExport: "researcherInstructionsPrompt",
		policyExport: "researcherPolicyPrompts",
		toolExport: "researcherToolPrompts",
		agentContextNeedle: "Source hierarchy:",
		sharedPolicyNeedle: "Agent behavior policy",
		sharedToolNeedle: "Operate inside the tools exposed",
	},
	{
		name: "scout",
		agentExport: "scoutAgent",
		instructionsExport: "scoutInstructionsPrompt",
		policyExport: "scoutPolicyPrompts",
		toolExport: "scoutToolPrompts",
		agentContextNeedle: "Boundary discipline:",
		sharedPolicyNeedle: "Agent behavior policy",
		sharedToolNeedle: "Operate inside the tools exposed",
	},
	{
		name: "supervisor",
		agentExport: "supervisorAgent",
		instructionsExport: "supervisorInstructionsPrompt",
		policyExport: "supervisorPolicyPrompts",
		toolExport: "supervisorToolPrompts",
		agentContextNeedle: "# Registered specialist agents",
		sharedPolicyNeedle: "Agent orchestration policy",
		sharedToolNeedle: "Agents as tools",
		orchestratorCommon: true,
	},
	{
		name: "validator",
		agentExport: "validatorAgent",
		instructionsExport: "validatorInstructionsPrompt",
		policyExport: "validatorPolicyPrompts",
		toolExport: "validatorToolPrompts",
		agentContextNeedle: "Validation setup:",
		sharedPolicyNeedle: "Agent behavior policy",
		sharedToolNeedle: "Operate inside the tools exposed",
	},
];

test("prompt modules follow the issue 19 vertical layout", async () => {
	const promptsDir = path.join(__dirname, "../src/prompts");
	const agentPromptFiles = (await readdir(path.join(promptsDir, "agents"))).sort();

	assert.deepEqual(agentPromptFiles, expectedAgentPromptFiles);
	await access(path.join(promptsDir, "index.ts"));
	await access(path.join(promptsDir, "policy.ts"));
	await access(path.join(promptsDir, "tools.ts"));
	await access(path.join(promptsDir, "runtime/README.md"));
	await assert.rejects(access(path.join(promptsDir, "shared.ts")));
});

test("prompt index exports grouped surfaces without builder prompts", () => {
	for (const builderName of removedBuilderExports) {
		assert.equal(builderName in prompts, false, `${builderName} should not be exported`);
	}
	for (const fragmentName of removedSharedFragmentExports) {
		assert.equal(fragmentName in prompts, false, `${fragmentName} should not be exported individually`);
	}

	assert.deepEqual(Object.keys(prompts.sharedPolicyPrompts).sort(), ["orchestrator", "specialist"]);
	assert.deepEqual(Object.keys(prompts.sharedToolPrompts).sort(), ["orchestrator", "specialist"]);
});

test("agent registrations import agent prompt modules directly", async () => {
	const agentsDir = path.join(__dirname, "../src/agents");

	for (const fileName of agentRegistrationFiles) {
		const source = await readFile(path.join(agentsDir, fileName), "utf8");
		assert.doesNotMatch(source, /\.\.\/prompts\/index\.js/);
		assert.match(source, /\.\.\/prompts\/agents\//);
	}
});

test("agent prompt modules expose instructions and grouped user prompt fragments", () => {
	for (const contract of agentContracts) {
		const module = promptModules[contract.name];
		assert.equal(typeof module[contract.instructionsExport], "string");
		assert.ok(module[contract.instructionsExport].length > 200);

		assert.ok(Array.isArray(module[contract.policyExport]));
		assert.ok(module[contract.policyExport].length > 0);
		assert.match(module[contract.policyExport].join("\n\n"), new RegExp(escapeRegExp(contract.agentContextNeedle)));

		assert.ok(Array.isArray(module[contract.toolExport]));
		assert.equal(module[contract.toolExport].length, 0, `${contract.toolExport} should be a placeholder`);
	}
});

test("agent registrations bake runtime policy and tooling into instructions for now", async () => {
	for (const contract of agentContracts) {
		const agent = agentModules[contract.name][contract.agentExport];
		const promptModule = promptModules[contract.name];
		const instructions = await agent.getInstructions();
		const defaultOptions = await agent.getDefaultOptions();

		assert.ok(String(instructions).startsWith(promptModule[contract.instructionsExport]));
		assert.match(instructions, /# Runtime Policy And Tooling/);
		assert.match(instructions, new RegExp(escapeRegExp(contract.sharedPolicyNeedle)));
		assert.match(instructions, new RegExp(escapeRegExp(contract.sharedToolNeedle)));
		assert.match(instructions, new RegExp(escapeRegExp(contract.agentContextNeedle)));
		if (contract.orchestratorCommon) {
			assert.match(instructions, /Agent communication policy/);
			assert.match(instructions, /Prompt-to-tool binding/);
		} else {
			assert.doesNotMatch(instructions, /Agent orchestration policy/);
			assert.doesNotMatch(instructions, /Agents as tools/);
		}
		assert.equal(defaultOptions.context, undefined);
	}
});

test("agents expose shared local modes and Harness mode composition", () => {
	const expectedAgentModes = {
		supervisorAgent: ["balanced", "scope", "plan", "build", "verify"],
		scoutAgent: ["balanced", "scope", "research"],
		researcherAgent: ["balanced", "research", "brainstorm", "analysis"],
		architectAgent: ["balanced", "scope", "analysis"],
		advisorAgent: ["balanced", "scope", "analysis", "audit"],
		developerAgent: ["balanced", "build", "verify"],
		validatorAgent: ["balanced", "test", "audit", "debug"],
	};
	const registeredAgents = Object.entries(agentsIndex.mastraAgents);
	assert.equal(registeredAgents.length, 7);

	for (const [agentKey, agent] of registeredAgents) {
		const expectedModes = expectedAgentModes[agentKey];
		assert.ok(expectedModes, `unexpected agent registration ${agentKey}`);
		assert.equal(agent.mode, "balanced");
		assert.deepEqual(agent.modes.map((mode) => mode.id), expectedModes);
		assert.deepEqual(agent.modes.map((mode) => mode.default), expectedModes.map((modeId) => modeId === "balanced"));
	}

	const expectedHarnessModeIds = [
		"supervisor.balanced",
		"supervisor.scope",
		"supervisor.plan",
		"supervisor.build",
		"supervisor.verify",
		"scout.balanced",
		"scout.scope",
		"scout.research",
		"researcher.balanced",
		"researcher.research",
		"researcher.brainstorm",
		"researcher.analysis",
		"architect.balanced",
		"architect.scope",
		"architect.analysis",
		"advisor.balanced",
		"advisor.scope",
		"advisor.analysis",
		"advisor.audit",
		"developer.balanced",
		"developer.build",
		"developer.verify",
		"validator.balanced",
		"validator.test",
		"validator.audit",
		"validator.debug",
	];
	assert.deepEqual(agentsIndex.mastraAgentHarnessModes.map((mode) => mode.id), expectedHarnessModeIds);
	assert.deepEqual(
		agentsIndex.mastraAgentHarness.listModes().map((mode) => mode.id),
		expectedHarnessModeIds,
	);
	assert.equal(agentsIndex.mastraAgentHarness.getState().harnessMode, "balanced");
	assert.equal(agentsIndex.mastraAgentHarness.getState().harnessModeId, "supervisor.balanced");
	assert.equal(agentsIndex.mastraAgentHarness.getState().hardnessMode, "supervisor.balanced");
	assert.equal(agentsIndex.resolveMastraAgentHarnessModeId({ agentId: "validator-agent" }), "validator.balanced");
	assert.equal(agentsIndex.resolveMastraAgentHarnessModeId({ harnessMode: "audit", agentId: "validator-agent" }), "validator.audit");
	assert.equal(agentsIndex.resolveMastraAgentHarnessModeId({ harnessMode: "developer.build", agentId: "validator-agent" }), "developer.build");
	assert.equal(agentsIndex.resolveMastraAgentHarnessModeId({ hardnessMode: "developer", agentId: "validator-agent" }), "developer.balanced");
	assert.match(
		agentsIndex.formatMastraAgentHarnessModePrompt(
			agentsIndex.resolveMastraAgentHarnessMode({ harnessMode: "build", agentId: "developer-agent" }),
		),
		/<harness-mode id="developer\.build" agent="developer" mode="build">/,
	);
	assert.throws(
		() => agentsIndex.resolveMastraAgentHarnessModeId({ harnessMode: "unknown" }),
		/Unknown harness mode/,
	);
});

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
