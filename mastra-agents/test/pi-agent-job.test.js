import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "@mariozechner/jiti";

const jiti = createJiti(import.meta.url);

test("pi agent job workflow is exported under the Mastra workflow id expected by Pi", async () => {
	const { piAgentJobWorkflows } = await jiti.import("../src/workflows/pi-agent-job.ts");
	assert.deepEqual(Object.keys(piAgentJobWorkflows), ["piAgentJob"]);
	assert.equal(piAgentJobWorkflows.piAgentJob.id, "pi.agent-job");
	assert.equal(piAgentJobWorkflows.piAgentJob.steps["run-pi-agent-job"].id, "run-pi-agent-job");
});

test("pi agent job workflow step streams agent output into artifacts and forwards run metadata", async () => {
	const artifactDir = await mkdtemp(path.join(os.tmpdir(), "pi-agent-job-"));
	const previousArtifactDir = process.env.MASTRA_PI_AGENT_JOB_DIR;
	process.env.MASTRA_PI_AGENT_JOB_DIR = artifactDir;
	try {
		const { runPiAgentJobStep } = await jiti.import("../src/workflows/pi-agent-job.ts");
		const writerChunks = [];
		let streamPrompt = "";
		let streamOptions;
		const mastra = {
			getAgentById(agentId) {
				assert.equal(agentId, "validator-agent");
				return {
					async stream(prompt, options) {
						streamPrompt = prompt;
						streamOptions = options;
						return {
							fullStream: [
								{ type: "text-delta", text: "hello" },
								{ type: "text-delta", payload: { text: " world" } },
							],
						};
					},
				};
			},
		};
		const writer = {
			async write(chunk) {
				writerChunks.push(chunk);
			},
		};

		const result = await runPiAgentJobStep.execute({
			inputData: {
				jobId: "job-1",
				jobName: "review",
				piSessionId: "session-1",
				runId: "workflow-run",
				agentRunId: "agent-run",
				agentId: "validator-agent",
				message: "Review $1",
				threadId: "thread-1",
				resourceId: "resource-1",
				requestContext: { tenant: "acme" },
				input_args: { $1: "diff" },
			},
			mastra,
			writer,
			abortSignal: new AbortController().signal,
		});

		assert.equal(result.status, "done");
		assert.equal(result.text, "hello world");
		assert.equal(result.runId, "workflow-run");
		assert.equal(result.agentRunId, "agent-run");
		assert.equal(streamOptions.runId, "agent-run");
		assert.deepEqual(streamOptions.memory, { thread: "thread-1", resource: "resource-1" });
		assert.deepEqual(streamOptions.requestContext, { tenant: "acme", input_args: { $1: "diff" } });
		assert.match(streamPrompt, /Review \$1/);
		assert.match(streamPrompt, /- \$1: diff/);
		assert.deepEqual(writerChunks, [
			{ type: "text-delta", text: "hello" },
			{ type: "text-delta", payload: { text: " world" } },
		]);
		assert.equal(await readFile(result.artifactPath, "utf8"), "hello world");
		const events = (await readFile(result.eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(events.length, 2);
		assert.deepEqual(events.map((event) => event.chunk), writerChunks);
	} finally {
		if (previousArtifactDir === undefined) delete process.env.MASTRA_PI_AGENT_JOB_DIR;
		else process.env.MASTRA_PI_AGENT_JOB_DIR = previousArtifactDir;
		await rm(artifactDir, { recursive: true, force: true });
	}
});

test("pi agent job workflow step reports agent stream errors and writes error artifacts", async () => {
	const artifactDir = await mkdtemp(path.join(os.tmpdir(), "pi-agent-job-error-"));
	const previousArtifactDir = process.env.MASTRA_PI_AGENT_JOB_DIR;
	process.env.MASTRA_PI_AGENT_JOB_DIR = artifactDir;
	try {
		const { runPiAgentJobStep } = await jiti.import("../src/workflows/pi-agent-job.ts");
		const writerChunks = [];
		const mastra = {
			getAgentById() {
				return {
					async stream() {
						throw new Error("agent exploded");
					},
				};
			},
		};
		const writer = {
			async write(chunk) {
				writerChunks.push(chunk);
			},
		};

		const result = await runPiAgentJobStep.execute({
			inputData: {
				jobId: "job-error",
				jobName: "review",
				piSessionId: "session-1",
				agentId: "validator-agent",
				message: "Review",
				threadId: "thread-1",
				resourceId: "resource-1",
			},
			mastra,
			writer,
			abortSignal: new AbortController().signal,
		});

		assert.equal(result.status, "error");
		assert.deepEqual(result.errors, ["agent exploded"]);
		assert.equal(writerChunks.length, 1);
		assert.equal(writerChunks[0].type, "error");
		assert.match(await readFile(result.artifactPath, "utf8"), /agent job error: agent exploded/);
		const events = (await readFile(result.eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(events[0].chunk.type, "error");
	} finally {
		if (previousArtifactDir === undefined) delete process.env.MASTRA_PI_AGENT_JOB_DIR;
		else process.env.MASTRA_PI_AGENT_JOB_DIR = previousArtifactDir;
		await rm(artifactDir, { recursive: true, force: true });
	}
});
