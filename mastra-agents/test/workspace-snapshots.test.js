import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
	const previousRoot = process.env.MASTRA_WORKSPACE_ROOT;
	process.env.MASTRA_WORKSPACE_ROOT = root;

	try {
		await execFileAsync("git", ["-C", root, "init"]);
		const { workspaceTools } = await jiti.import("../src/tools/workspace.ts");

		const writeResult = await workspaceTools.writeFile.execute({ filePath: "notes.txt", content: "one\n", overwrite: false });
		assert.equal(writeResult.path, "notes.txt");
		assert.match(writeResult.snapshotPath, /^\.agents\/exec\/snapshots\/mastra-agents\/workspace-tool\/local-session\/workspace-mutations\/write-events\.jsonl$/);
		assert.match(writeResult.turnDiff, /\+one/);
		assert.match(writeResult.sessionDiff, /\+one/);

		const editResult = await workspaceTools.replaceInFile.execute({ filePath: "notes.txt", oldText: "one", newText: "two", replaceAll: false });
		assert.equal(editResult.path, "notes.txt");
		assert.match(editResult.turnDiff, /-one/);
		assert.match(editResult.turnDiff, /\+two/);

		const snapshots = await workspaceTools.readSnapshots.execute({ maxEvents: 10, filePath: "notes.txt" });
		assert.equal(snapshots.snapshotPath, ".agents/exec/snapshots/mastra-agents/workspace-tool/local-session/workspace-mutations/write-events.jsonl");
		assert.equal(snapshots.events.length, 2);
		assert.deepEqual(snapshots.events.map((event) => event.tool), ["write_file", "edit_file"]);
		assert.deepEqual(snapshots.events.map((event) => event.path), ["notes.txt", "notes.txt"]);

		const rawLog = await readFile(path.join(root, snapshots.snapshotPath), "utf8");
		assert.equal(rawLog.trim().split("\n").length, 2);

		const { initializeSessionSnapshot, captureTurnSnapshot } = await jiti.import("../src/tools/snapshots.ts");
		const owner = { agentId: "developer-agent", sessionId: "session-a", runId: "run-a", childId: "child-a" };
		const initial = await initializeSessionSnapshot(owner);
		assert.match(initial.snapshotRepoPath, /\.agents\/exec\/snapshots\/mastra-agents\/developer-agent\/session-a\/run-a$/);

		await writeFile(path.join(root, "notes.txt"), "three\n", "utf8");
		const turnOne = await captureTurnSnapshot(owner);
		assert.equal(turnOne.turnNumber, 1);
		assert.match(turnOne.turnDiff, /-two/);
		assert.match(turnOne.turnDiff, /\+three/);
		assert.match(turnOne.sessionDiff, /\+three/);

		await writeFile(path.join(root, "new-file.txt"), "turn two\n", "utf8");
		const turnTwo = await captureTurnSnapshot(owner);
		assert.equal(turnTwo.turnNumber, 2);
		assert.match(turnTwo.turnDiff, /new-file\.txt/);
		assert.match(turnTwo.sessionDiff, /notes\.txt/);
		assert.match(turnTwo.sessionDiff, /new-file\.txt/);
		assert.match(turnTwo.reminder, /Snapshot audit context:/);
		assert.match(await readFile(path.join(root, turnTwo.turnDiffPath), "utf8"), /new-file\.txt/);
	} finally {
		if (previousRoot === undefined) delete process.env.MASTRA_WORKSPACE_ROOT;
		else process.env.MASTRA_WORKSPACE_ROOT = previousRoot;
		await rm(root, { recursive: true, force: true });
	}
});
