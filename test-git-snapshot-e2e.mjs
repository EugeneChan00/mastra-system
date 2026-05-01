#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createJiti } from "@mariozechner/jiti";

const execFileAsync = promisify(execFile);
const workspaceRoot = process.cwd();
const runStamp = Date.now();
const testDir = path.join(workspaceRoot, "test-git-snapshots-e2e");
const artifactDir = await mkdtempCompat("mastra-git-snapshot-artifacts-");
const snapshotDir = await mkdtempCompat("mastra-git-snapshot-root-");
const previousEnv = {
  MASTRA_WORKSPACE_ROOT: process.env.MASTRA_WORKSPACE_ROOT,
  MASTRA_PI_AGENT_JOB_DIR: process.env.MASTRA_PI_AGENT_JOB_DIR,
  AGENT_SNAPSHOTS_DIR: process.env.AGENT_SNAPSHOTS_DIR,
};

process.env.MASTRA_WORKSPACE_ROOT = workspaceRoot;
process.env.MASTRA_PI_AGENT_JOB_DIR = artifactDir;
process.env.AGENT_SNAPSHOTS_DIR = snapshotDir;

try {
  await mkdir(testDir, { recursive: true });
  await rm(path.join(testDir, "story-alpha.md"), { force: true });

  const jiti = createJiti(import.meta.url);
  const { runPiAgentJobStep } = await jiti.import("./mastra-agents/src/workflows/pi-agent-job.ts");
  const { workspaceTools } = await jiti.import("./mastra-agents/src/tools/workspace.ts");

  const runId = `git-snapshot-e2e-${runStamp}`;
  const baseInput = {
    jobName: "git-snapshot-e2e",
    piSessionId: `git-snapshot-session-${runStamp}`,
    runId,
    agentId: "developer-agent",
    harnessMode: "build",
    message: "Mutate the controlled markdown file for the git snapshot E2E.",
    threadId: `git-snapshot-thread-${runStamp}`,
    resourceId: `git-snapshot-resource-${runStamp}`,
  };

  console.log("=== Git Snapshot E2E ===");
  console.log("workspaceRoot:", workspaceRoot);
  console.log("snapshotRoot:", snapshotDir);
  console.log("runId:", runId);

  const first = await runJob(runPiAgentJobStep, {
    ...baseInput,
    jobId: "git-snapshot-e2e-create",
  }, async (harness) => {
    await writeFile(
      path.join(testDir, "story-alpha.md"),
      "# Alpha Story\n\nA first version created by the E2E harness.\n",
      "utf8",
    );
    harness.emitText("Created story-alpha.md");
  });

  assert.equal(first.status, "done", JSON.stringify(first, null, 2));
  assert.equal(first.snapshot?.type, "git_snapshot");
  assert.equal(first.snapshot.turnNumber, 1);
  assert.equal(first.snapshot.turnRef, "refs/turn/main/t1");

  const second = await runJob(runPiAgentJobStep, {
    ...baseInput,
    jobId: "git-snapshot-e2e-edit",
  }, async (harness) => {
    const filePath = path.join(testDir, "story-alpha.md");
    const current = await readFile(filePath, "utf8");
    await writeFile(filePath, `${current}\n## Revision\n\nEdited by the second E2E turn.\n`, "utf8");
    harness.emitText("Edited story-alpha.md");
  });

  assert.equal(second.status, "done", JSON.stringify(second, null, 2));
  assert.equal(second.snapshot?.type, "git_snapshot");
  assert.equal(second.snapshot.turnNumber, 2);
  assert.equal(second.snapshot.turnRef, "refs/turn/main/t2");

  const repoPath = second.snapshot.snapshotRepoPath;
  const bare = await execFileAsync("git", [`--git-dir=${repoPath}`, "rev-parse", "--is-bare-repository"]);
  assert.equal(bare.stdout.trim(), "true");

  const refs = await execFileAsync("git", [
    `--git-dir=${repoPath}`,
    "for-each-ref",
    "--format=%(refname)",
    "refs/baseline",
    "refs/turn",
    "refs/latest",
  ]);
  assert.match(refs.stdout, /refs\/baseline\/startup/);
  assert.match(refs.stdout, /refs\/turn\/main\/t1/);
  assert.match(refs.stdout, /refs\/turn\/main\/t2/);
  assert.match(refs.stdout, /refs\/latest/);

  const turns = await workspaceTools.gitSnapshotQuery.execute({
    queryType: "list_turns",
    snapshot: second.snapshot,
  });
  assert.deepEqual(turns.turns, ["t1", "t2"]);

  const turnDiff = await workspaceTools.gitSnapshotQuery.execute({
    queryType: "turn_diff",
    snapshot: second.snapshot,
    turnN: 2,
  });
  assert.match(turnDiff.rawDiff, /story-alpha\.md/);
  assert.match(turnDiff.rawDiff, /\+## Revision/);
  assert.ok(turnDiff.files.some((file) => file.path === "test-git-snapshots-e2e/story-alpha.md" && file.status === "modified"));

  const sessionDiff = await workspaceTools.gitSnapshotQuery.execute({
    queryType: "session_diff",
    snapshot: second.snapshot,
  });
  assert.match(sessionDiff.rawDiff, /story-alpha\.md/);
  assert.match(sessionDiff.rawDiff, /\+# Alpha Story/);
  assert.match(sessionDiff.rawDiff, /\+## Revision/);

  const jsonlCheck = await execFileAsync("find", [snapshotDir, "-name", "*.jsonl", "-print"]);
  assert.equal(jsonlCheck.stdout.trim(), "");

  console.log("Snapshot DTO:", JSON.stringify(second.snapshot, null, 2));
  console.log("Turn diff files:", JSON.stringify(turnDiff.files));
  console.log("Session diff files:", JSON.stringify(sessionDiff.files));
  console.log("PASS: Mastra workflow returned a git_snapshot object with queryable turn/session diffs.");
} finally {
  restoreEnv(previousEnv);
  await rm(testDir, { recursive: true, force: true });
  await rm(artifactDir, { recursive: true, force: true });
  if (process.env.KEEP_E2E_SNAPSHOTS !== "1") {
    await rm(snapshotDir, { recursive: true, force: true });
  } else {
    console.log("Kept snapshotRoot:", snapshotDir);
  }
}

process.exit(0);

async function runJob(runPiAgentJobStep, inputData, mutate) {
  const harness = createFakeHarness(mutate);
  const writerChunks = [];
  return runPiAgentJobStep.execute({
    inputData,
    mastra: { mastraAgentHarness: harness },
    writer: { async write(chunk) { writerChunks.push(chunk); } },
    abortSignal: new AbortController().signal,
  });
}

function createFakeHarness(onSendMessage) {
  const listeners = [];
  return {
    resourceId: undefined,
    threadId: undefined,
    modeId: "supervisor.balanced",
    state: {},
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    emitText(text) {
      this.emit({ type: "message_update", message: { content: [{ type: "text", text }] } });
    },
    async init() {},
    setResourceId({ resourceId }) { this.resourceId = resourceId; },
    async switchThread({ threadId }) { this.threadId = threadId; },
    getCurrentModeId() { return this.modeId; },
    async switchMode({ modeId }) { this.modeId = modeId; },
    async setState(state) { this.state = { ...this.state, ...state }; },
    async setThreadSetting() {},
    async listThreads() { return []; },
    abort() {},
    async sendMessage() { await onSendMessage(this); },
  };
}

async function mkdtempCompat(prefix) {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
