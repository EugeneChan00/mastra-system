import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "@mariozechner/jiti";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);

const prompts = await jiti.import("../src/prompts/index.ts");

const expectedAgentPromptFiles = [
	"advisor.ts",
	"architect.ts",
	"control.ts",
	"developer.ts",
	"researcher.ts",
	"scout.ts",
	"supervisor.ts",
	"validator.ts",
];

const expectedBuilders = [
	"buildAdvisorPrompt",
	"buildArchitectPrompt",
	"buildControlPrompt",
	"buildDeveloperPrompt",
	"buildResearcherPrompt",
	"buildScoutPrompt",
	"buildSupervisorPrompt",
	"buildValidatorPrompt",
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

test("prompt index exports stable non-empty builder prompts", () => {
	for (const builderName of expectedBuilders) {
		const builder = prompts[builderName];
		assert.equal(typeof builder, "function", `${builderName} should be a function`);

		const prompt = builder();
		assert.equal(typeof prompt, "string", `${builderName} should return a string`);
		assert.ok(prompt.length > 500, `${builderName} prompt should include substantive guidance`);
		assert.ok(!prompt.includes("undefined"), `${builderName} prompt should not leak undefined`);
		assert.ok(!prompt.includes("[object Object]"), `${builderName} prompt should not stringify objects`);
		assert.doesNotMatch(prompt, /daytona/i, `${builderName} prompt should not mention Daytona`);
		assert.doesNotMatch(prompt, /sandbox/i, `${builderName} prompt should not mention sandbox infrastructure`);
		assert.doesNotMatch(prompt, /control-plane/i, `${builderName} prompt should not mention control-plane infrastructure`);
	}
});

test("shared prompt primitives live in named root modules", () => {
	assert.equal(typeof prompts.evidenceDisciplinePrompt, "string");
	assert.equal(typeof prompts.blockerProtocolPrompt, "string");
	assert.equal(typeof prompts.specialistToolRuntimePrompt, "string");
	assert.equal(typeof prompts.supervisorToolPrompt, "string");
	assert.equal(typeof prompts.controlToolPrompt, "string");
});
