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
	const snapshotDir = await mkdtemp(path.join(os.tmpdir(), "pi-agent-job-snapshots-"));
	const previousArtifactDir = process.env.MASTRA_PI_AGENT_JOB_DIR;
	const previousSnapshotDir = process.env.AGENT_SNAPSHOTS_DIR;
	process.env.MASTRA_PI_AGENT_JOB_DIR = artifactDir;
	process.env.AGENT_SNAPSHOTS_DIR = snapshotDir;
	try {
		const uniqueId = path.basename(artifactDir);
		const threadId = `${uniqueId}-thread`;
		const resourceId = `${uniqueId}-resource`;
		const { runPiAgentJobStep } = await jiti.import("../src/workflows/pi-agent-job.ts");
		const writerChunks = [];
		let streamPrompt = "";
		let streamRequestContext;
		const harness = createFakeHarness({
			currentModeId: "supervisor.balanced",
			async sendMessage({ content, requestContext }) {
				streamPrompt = content;
				streamRequestContext = requestContext;
				this.emit({ type: "message_update", message: { content: [{ type: "text", text: "hello" }] } });
				this.emit({ type: "message_update", message: { content: [{ type: "text", text: "hello world" }] } });
			},
		});
		const mastra = { mastraAgentHarness: harness };
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
				runId: `${uniqueId}-workflow-run`,
				agentRunId: "agent-run",
				agentId: "validator-agent",
				harnessMode: "audit",
				message: "Review $1",
				threadId,
				resourceId,
				requestContext: { tenant: "acme" },
				input_args: { $1: "diff" },
			},
			mastra,
			writer,
			abortSignal: new AbortController().signal,
		});

		assert.equal(result.status, "done");
		assert.equal(result.text, "hello world");
		assert.equal(result.runId, `${uniqueId}-workflow-run`);
		assert.equal(result.agentRunId, "agent-run");
		assert.equal(result.harnessMode, "audit");
		assert.equal(result.harnessModeId, "validator.audit");
		assert.equal(result.hardnessMode, "validator.audit");
		assert.equal(harness.resourceId, resourceId);
		assert.equal(harness.threadId, threadId);
		assert.equal(harness.modeId, "validator.audit");
		assert.deepEqual(harness.state, {
			activeAgentId: "validator",
			harnessMode: "audit",
			harnessModeId: "validator.audit",
			hardnessMode: "validator.audit",
			lastSubmittedHarnessModeId: "validator.audit",
		});
		assert.equal(streamRequestContext.get("tenant"), "acme");
		assert.deepEqual(streamRequestContext.get("input_args"), { $1: "diff" });
		assert.equal(streamRequestContext.get("activeAgentId"), "validator");
		assert.equal(streamRequestContext.get("harnessMode"), "audit");
		assert.equal(streamRequestContext.get("harnessModeId"), "validator.audit");
		assert.equal(streamRequestContext.get("hardnessMode"), "validator.audit");
		assert.match(streamPrompt, /<harness-mode id="validator\.audit" agent="validator" mode="audit">/);
		assert.match(streamPrompt, /Review \$1/);
		assert.match(streamPrompt, /- \$1: diff/);
		assert.deepEqual(writerChunks.slice(0, 3), [
			{ type: "text-delta", text: "hello" },
			{ type: "text-delta", text: " world" },
			{
				type: "finish",
				payload: {
					activeAgentId: "validator",
					harnessMode: "audit",
					harnessModeId: "validator.audit",
					hardnessMode: "validator.audit",
				},
			},
		]);
		assert.equal(writerChunks[3].type, "snapshot-audit-context");
		assert.match(writerChunks[3].text, /Snapshot audit context:/);
		assert.equal(result.snapshot.type, "git_snapshot");
		assert.match(result.snapshotRepoPath, new RegExp(`snapshots/mastra-agents/validator-agent/session-1/${uniqueId}-workflow-run/snapshots\\.git$`));
		assert.equal(result.turnRef, "refs/turn/main/t1");
		assert.match(result.turnDiffPath, /git --git-dir=.* diff refs\/baseline\/startup refs\/turn\/main\/t1/);
		assert.match(await readFile(result.artifactPath, "utf8"), /hello world/);
		assert.match(await readFile(result.artifactPath, "utf8"), /Snapshot audit context:/);
		const events = (await readFile(result.eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(events.length, 4);
		assert.deepEqual(events.map((event) => event.chunk), writerChunks);
	} finally {
		if (previousArtifactDir === undefined) delete process.env.MASTRA_PI_AGENT_JOB_DIR;
		else process.env.MASTRA_PI_AGENT_JOB_DIR = previousArtifactDir;
		if (previousSnapshotDir === undefined) delete process.env.AGENT_SNAPSHOTS_DIR;
		else process.env.AGENT_SNAPSHOTS_DIR = previousSnapshotDir;
		await rm(artifactDir, { recursive: true, force: true });
		await rm(snapshotDir, { recursive: true, force: true });
	}
});

test("pi agent job workflow emits Harness mode prompt only when the thread mode changes", async () => {
	const artifactDir = await mkdtemp(path.join(os.tmpdir(), "pi-agent-job-mode-"));
	const snapshotDir = await mkdtemp(path.join(os.tmpdir(), "pi-agent-job-mode-snapshots-"));
	const previousArtifactDir = process.env.MASTRA_PI_AGENT_JOB_DIR;
	const previousSnapshotDir = process.env.AGENT_SNAPSHOTS_DIR;
	process.env.MASTRA_PI_AGENT_JOB_DIR = artifactDir;
	process.env.AGENT_SNAPSHOTS_DIR = snapshotDir;
	try {
		const uniqueId = path.basename(artifactDir);
		const { runPiAgentJobStep } = await jiti.import("../src/workflows/pi-agent-job.ts");
		const prompts = [];
		const harness = createFakeHarness({
			currentModeId: "validator.audit",
			async sendMessage({ content }) {
				prompts.push(content);
			},
		});
		const mastra = { mastraAgentHarness: harness };
		const writer = { async write() {} };
		const baseInput = {
			jobName: "mode-check",
			piSessionId: "session-1",
			agentId: "validator-agent",
			message: "Review",
			threadId: `${uniqueId}-thread`,
			resourceId: `${uniqueId}-resource`,
		};

		await runPiAgentJobStep.execute({
			inputData: { ...baseInput, jobId: "job-mode-1", harnessMode: "audit" },
			mastra,
			writer,
			abortSignal: new AbortController().signal,
		});
		await runPiAgentJobStep.execute({
			inputData: { ...baseInput, jobId: "job-mode-2", harnessMode: "audit" },
			mastra,
			writer,
			abortSignal: new AbortController().signal,
		});
		await runPiAgentJobStep.execute({
			inputData: { ...baseInput, jobId: "job-mode-3", harnessMode: "debug" },
			mastra,
			writer,
			abortSignal: new AbortController().signal,
		});

		assert.equal(prompts.length, 3);
		assert.match(prompts[0], /<harness-mode id="validator\.audit" agent="validator" mode="audit">/);
		assert.doesNotMatch(prompts[1], /<harness-mode/);
		assert.match(prompts[2], /<harness-mode id="validator\.debug" agent="validator" mode="debug">/);
	} finally {
		if (previousArtifactDir === undefined) delete process.env.MASTRA_PI_AGENT_JOB_DIR;
		else process.env.MASTRA_PI_AGENT_JOB_DIR = previousArtifactDir;
		if (previousSnapshotDir === undefined) delete process.env.AGENT_SNAPSHOTS_DIR;
		else process.env.AGENT_SNAPSHOTS_DIR = previousSnapshotDir;
		await rm(artifactDir, { recursive: true, force: true });
		await rm(snapshotDir, { recursive: true, force: true });
	}
});

test("pi agent job workflow step reports agent stream errors and writes error artifacts", async () => {
	const artifactDir = await mkdtemp(path.join(os.tmpdir(), "pi-agent-job-error-"));
	const snapshotDir = await mkdtemp(path.join(os.tmpdir(), "pi-agent-job-error-snapshots-"));
	const previousArtifactDir = process.env.MASTRA_PI_AGENT_JOB_DIR;
	const previousSnapshotDir = process.env.AGENT_SNAPSHOTS_DIR;
	process.env.MASTRA_PI_AGENT_JOB_DIR = artifactDir;
	process.env.AGENT_SNAPSHOTS_DIR = snapshotDir;
	try {
		const { runPiAgentJobStep } = await jiti.import("../src/workflows/pi-agent-job.ts");
		const writerChunks = [];
		const mastra = {
			mastraAgentHarness: createFakeHarness({
				async sendMessage() {
					throw new Error("agent exploded");
				},
			}),
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
		assert.equal(writerChunks.length, 2);
		assert.equal(writerChunks[0].type, "snapshot-audit-context");
		assert.equal(writerChunks[1].type, "error");
		assert.match(await readFile(result.artifactPath, "utf8"), /agent job error: agent exploded/);
		const events = (await readFile(result.eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(events[0].chunk.type, "snapshot-audit-context");
		assert.equal(events[1].chunk.type, "error");
	} finally {
		if (previousArtifactDir === undefined) delete process.env.MASTRA_PI_AGENT_JOB_DIR;
		else process.env.MASTRA_PI_AGENT_JOB_DIR = previousArtifactDir;
		if (previousSnapshotDir === undefined) delete process.env.AGENT_SNAPSHOTS_DIR;
		else process.env.AGENT_SNAPSHOTS_DIR = previousSnapshotDir;
		await rm(artifactDir, { recursive: true, force: true });
		await rm(snapshotDir, { recursive: true, force: true });
	}
});

function createFakeHarness(overrides = {}) {
	const listeners = [];
	const threadMetadata = { ...(overrides.threadMetadata ?? {}) };
	return {
		resourceId: undefined,
		threadId: undefined,
		modeId: overrides.currentModeId ?? "supervisor.balanced",
		state: { harnessMode: "balanced", harnessModeId: overrides.currentModeId ?? "supervisor.balanced", hardnessMode: overrides.currentModeId ?? "supervisor.balanced" },
		subscribe(listener) {
			listeners.push(listener);
			return () => {
				const index = listeners.indexOf(listener);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
		emit(event) {
			for (const listener of [...listeners]) listener(event);
		},
		async init() {},
		setResourceId({ resourceId }) {
			this.resourceId = resourceId;
		},
		async switchThread({ threadId }) {
			this.threadId = threadId;
		},
		async listThreads() {
			return this.threadId ? [{ id: this.threadId, metadata: threadMetadata }] : [];
		},
		async setThreadSetting({ key, value }) {
			threadMetadata[key] = value;
		},
		getCurrentModeId() {
			return this.modeId;
		},
		async switchMode({ modeId }) {
			const previousModeId = this.modeId;
			this.modeId = modeId;
			this.emit({ type: "mode_changed", modeId, previousModeId });
		},
		async setState(updates) {
			this.state = { ...this.state, ...updates };
			this.emit({ type: "state_changed", state: this.state, changedKeys: Object.keys(updates) });
		},
		abort() {
			this.aborted = true;
		},
		sendMessage: overrides.sendMessage ?? (async function () {}),
	};
}
