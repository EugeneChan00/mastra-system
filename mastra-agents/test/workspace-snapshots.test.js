import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "@mariozechner/jiti";

const execFileAsync = promisify(execFile);
const jiti = createJiti(import.meta.url);

test("workspace write/edit tools record queryable mutation snapshots", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "mastra-workspace-snapshots-"));
	const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "mastra-git-snapshots-"));
	const previousRoot = process.env.MASTRA_WORKSPACE_ROOT;
	const previousSnapshotRoot = process.env.AGENT_SNAPSHOTS_DIR;
	process.env.MASTRA_WORKSPACE_ROOT = root;
	process.env.AGENT_SNAPSHOTS_DIR = snapshotRoot;

	try {
		await execFileAsync("git", ["-C", root, "init"]);
		const { workspaceTools } = await jiti.import("../src/tools/workspace.ts");

		const writeResult = await workspaceTools.writeFile.execute({ filePath: "notes.txt", content: "one\n", overwrite: false });
		assert.equal(writeResult.path, "notes.txt");
		assert.equal(writeResult.bytesWritten, 4);
		assert.equal(writeResult.overwritten, false);

		const editResult = await workspaceTools.replaceInFile.execute({ filePath: "notes.txt", oldText: "one", newText: "two", replaceAll: false });
		assert.equal(editResult.path, "notes.txt");
		assert.equal(editResult.replacements, 1);

		const { initializeSessionSnapshot, captureTurnSnapshot } = await jiti.import("../src/tools/snapshots.ts");
		const owner = { agentId: "developer-agent", sessionId: "session-a", runId: "run-a", childId: "child-a" };
		const initial = await initializeSessionSnapshot(owner);
		assert.match(initial.snapshotRepoPath, /snapshots\/mastra-agents\/developer-agent\/session-a\/run-a\/snapshots\.git$/);
		assert.equal(initial.snapshot.type, "git_snapshot");
		assert.equal(initial.baselineRef, "refs/baseline/startup");

		await writeFile(path.join(root, "notes.txt"), "three\n", "utf8");
		const turnOne = await captureTurnSnapshot(owner);
		assert.equal(turnOne.turnNumber, 1);
		assert.match(turnOne.turnDiff, /-two/);
		assert.match(turnOne.turnDiff, /\+three/);
		assert.match(turnOne.sessionDiff, /\+three/);
		assert.equal(turnOne.snapshot.type, "git_snapshot");
		assert.equal(turnOne.snapshot.turnRef, "refs/turn/main/t1");
		assert.match(turnOne.snapshot.commands.turnDiff, /git --git-dir=.* diff refs\/baseline\/startup refs\/turn\/main\/t1/);

		await writeFile(path.join(root, "new-file.txt"), "turn two\n", "utf8");
		const turnTwo = await captureTurnSnapshot(owner);
		assert.equal(turnTwo.turnNumber, 2);
		assert.match(turnTwo.turnDiff, /new-file\.txt/);
		assert.match(turnTwo.sessionDiff, /notes\.txt/);
		assert.match(turnTwo.sessionDiff, /new-file\.txt/);
		assert.match(turnTwo.reminder, /Snapshot audit context:/);
		assert.match(turnTwo.reminder, /snapshot type: git_snapshot/);

		const refs = await execFileAsync("git", [
			`--git-dir=${turnTwo.snapshotRepoPath}`,
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

		const turnQuery = await workspaceTools.gitSnapshotQuery.execute({
			queryType: "turn_diff",
			snapshotRepoPath: turnTwo.snapshotRepoPath,
			turnN: 2,
		});
		assert.match(turnQuery.rawDiff, /new-file\.txt/);
		assert.ok(turnQuery.files.some((file) => file.path === "new-file.txt" && file.status === "added"));

		const sessionQuery = await workspaceTools.gitSnapshotQuery.execute({
			queryType: "session_diff",
			snapshot: turnTwo.snapshot,
		});
		assert.match(sessionQuery.rawDiff, /notes\.txt/);
		assert.match(sessionQuery.rawDiff, /new-file\.txt/);
	} finally {
		if (previousRoot === undefined) delete process.env.MASTRA_WORKSPACE_ROOT;
		else process.env.MASTRA_WORKSPACE_ROOT = previousRoot;
		if (previousSnapshotRoot === undefined) delete process.env.AGENT_SNAPSHOTS_DIR;
		else process.env.AGENT_SNAPSHOTS_DIR = previousSnapshotRoot;
		await rm(root, { recursive: true, force: true });
		await rm(snapshotRoot, { recursive: true, force: true });
	}
});
