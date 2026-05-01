import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { workspaceRoot } from "../workspace-paths.js";
import { git } from "./git-ops.js";

export type SnapshotOwner = {
  agentId: string;
  sessionId?: string;
  runId?: string;
  childId?: string;
};

export type GitSnapshotAudit = {
  type: "git_snapshot";
  agentId: string;
  sessionId: string;
  runId: string;
  snapshotRepoPath: string;
  baselineRef: "refs/baseline/startup";
  latestRef: "refs/latest";
  turnRef: `refs/turn/main/t${number}`;
  turnNumber: number;
  commands: {
    listTurns: string;
    turnDiff: string;
    sessionDiff: string;
  };
};

export type SnapshotCapture = {
  snapshot: GitSnapshotAudit;
  snapshotRepoPath: string;
  sessionSnapshotPath: string;
  turnSnapshotPath: string;
  sessionDiffPath: string;
  turnDiffPath: string;
  latestRef: string;
  sessionRef: string;
  baselineRef: "refs/baseline/startup";
  turnRef: `refs/turn/main/t${number}`;
  turnNumber: number;
  sessionDiff: string;
  turnDiff: string;
  reminder: string;
};

const baselineRef = "refs/baseline/startup" as const;
const latestRef = "refs/latest" as const;
const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const snapshotAgentType = "mastra-agents";
const snapshotIgnoreDirs = new Set([".git", "node_modules", ".mastra", "dist", "build", "coverage"]);

export function snapshotRepoPath(owner: SnapshotOwner): string {
  return path.join(
    snapshotRootDir(),
    safePathPart(owner.agentId),
    safePathPart(owner.sessionId ?? "local-session"),
    safePathPart(owner.runId ?? owner.childId ?? "local-run"),
    "snapshots.git",
  );
}

export async function initializeSessionSnapshot(owner: SnapshotOwner): Promise<{
  snapshot: GitSnapshotAudit;
  snapshotRepoPath: string;
  sessionSnapshotPath: string;
  latestRef: string;
  sessionRef: string;
  baselineRef: "refs/baseline/startup";
}> {
  const repoPath = await ensureRepo(owner);
  if (!(await refExists(repoPath, baselineRef))) {
    const { commit } = await buildWorkspaceCommit(repoPath, snapshotMessage(owner, "baseline:startup"), null);
    await git([`--git-dir=${repoPath}`, "update-ref", baselineRef, commit]);
  }

  const snapshot = gitSnapshotAudit(owner, repoPath, 0);
  return {
    snapshot,
    snapshotRepoPath: repoPath,
    sessionSnapshotPath: `${repoPath}#${baselineRef}`,
    latestRef,
    sessionRef: baselineRef,
    baselineRef,
  };
}

export async function captureTurnSnapshot(owner: SnapshotOwner): Promise<SnapshotCapture> {
  const repoPath = await ensureRepo(owner);
  if (!(await refExists(repoPath, baselineRef))) {
    await initializeSessionSnapshot(owner);
  }

  const turnNumber = (await currentTurnNumber(repoPath)) + 1;
  const turnRef = `refs/turn/main/t${turnNumber}` as const;
  const parentRef = turnNumber > 1 ? `refs/turn/main/t${turnNumber - 1}` : baselineRef;
  const parent = (await resolveRef(repoPath, parentRef)) ?? null;
  const { commit } = await buildWorkspaceCommit(repoPath, snapshotMessage(owner, `turn:t${turnNumber}`), parent);

  await git([`--git-dir=${repoPath}`, "update-ref", turnRef, commit]);
  await git([`--git-dir=${repoPath}`, "update-ref", latestRef, commit]);

  const turnDiff = await rawTurnDiff(repoPath, turnRef);
  const sessionDiff = await rawSessionDiff(repoPath);
  const snapshot = gitSnapshotAudit(owner, repoPath, turnNumber);
  const capture = {
    snapshot,
    snapshotRepoPath: repoPath,
    sessionSnapshotPath: `${repoPath}#${baselineRef}`,
    turnSnapshotPath: `${repoPath}#${turnRef}`,
    sessionDiffPath: snapshot.commands.sessionDiff,
    turnDiffPath: snapshot.commands.turnDiff,
    latestRef,
    sessionRef: baselineRef,
    baselineRef,
    turnRef,
    turnNumber,
    sessionDiff,
    turnDiff,
    reminder: "",
  } satisfies SnapshotCapture;

  return { ...capture, reminder: formatSnapshotReminder(owner, capture) };
}

export async function rawTurnDiff(repoPath: string, turnRef: string): Promise<string> {
  const parent = (await resolveRef(repoPath, `${turnRef}^`)) ?? emptyTree;
  return git([`--git-dir=${repoPath}`, "diff", "--no-color", parent, turnRef]).catch(() => "");
}

export async function rawSessionDiff(repoPath: string): Promise<string> {
  const latest = await resolveRef(repoPath, latestRef);
  if (!latest) return "";
  const baseline = await resolveRef(repoPath, baselineRef);
  const left = baseline ?? emptyTree;
  return git([`--git-dir=${repoPath}`, "diff", "--no-color", left, latestRef]).catch(() => "");
}

export function formatSnapshotReminder(owner: SnapshotOwner, capture: Omit<SnapshotCapture, "reminder">): string {
  return [
    "Snapshot audit context:",
    `- snapshot type: ${capture.snapshot.type}`,
    `- agent id: ${owner.agentId}`,
    `- session id: ${capture.snapshot.sessionId}`,
    `- run id: ${capture.snapshot.runId}`,
    `- turn number: ${capture.turnNumber}`,
    `- snapshot repo: ${capture.snapshotRepoPath}`,
    `- baseline ref: ${capture.baselineRef}`,
    `- latest ref: ${capture.latestRef}`,
    `- current turn ref: ${capture.turnRef}`,
    `- list turns: ${capture.snapshot.commands.listTurns}`,
    `- turn diff: ${capture.snapshot.commands.turnDiff}`,
    `- session diff: ${capture.snapshot.commands.sessionDiff}`,
    "Use this git snapshot object to inspect actual file changes before relying on agent claims.",
  ].join("\n");
}

async function ensureRepo(owner: SnapshotOwner): Promise<string> {
  const repoPath = snapshotRepoPath(owner);
  try {
    await fs.access(path.join(repoPath, "HEAD"));
  } catch {
    await fs.mkdir(path.dirname(repoPath), { recursive: true });
    await git(["init", "--bare", repoPath]);
  }
  return repoPath;
}

async function buildWorkspaceCommit(
  repoPath: string,
  message: string,
  parent: string | null,
): Promise<{ commit: string; tree: string }> {
  const tmpIndex = path.join(
    os.tmpdir(),
    `mastra-snapshot-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.idx`,
  );
  const env = {
    GIT_INDEX_FILE: tmpIndex,
    GIT_WORK_TREE: workspaceRoot,
  };

  try {
    await git([`--git-dir=${repoPath}`, "read-tree", "--empty"], { env });
    const files = await snapshotFileList();
    for (const chunk of chunkArray(files, 200)) {
      await git(
        [
          `--git-dir=${repoPath}`,
          `--work-tree=${workspaceRoot}`,
          "add",
          "--ignore-errors",
          "--",
          ...chunk,
        ],
        { env },
      );
    }
    const tree = (await git([`--git-dir=${repoPath}`, "write-tree"], { env })).trim();
    const parentArgs = parent ? ["-p", parent] : [];
    const commit = (
      await git([`--git-dir=${repoPath}`, "commit-tree", tree, ...parentArgs, "-m", message], {
        env: {
          ...env,
          GIT_AUTHOR_NAME: "mastra-snapshot",
          GIT_AUTHOR_EMAIL: "snapshot@local",
          GIT_COMMITTER_NAME: "mastra-snapshot",
          GIT_COMMITTER_EMAIL: "snapshot@local",
        },
      })
    ).trim();
    return { commit, tree };
  } finally {
    await fs.rm(tmpIndex, { force: true }).catch(() => undefined);
  }
}

async function snapshotFileList(): Promise<string[]> {
  try {
    const raw = await git(["ls-files", "--cached", "--modified", "--others", "--exclude-standard", "-z"], { cwd: workspaceRoot });
    const files = raw.split("\0").filter((entry) => entry.length > 0);
    return (await filterExistingSnapshotFiles(files)).sort();
  } catch {
    const files: string[] = [];
    await collectSnapshotFiles(workspaceRoot, "", files);
    return files.sort();
  }
}

async function filterExistingSnapshotFiles(files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const file of files) {
    if (isIgnoredSnapshotPath(file)) continue;
    try {
      const stat = await fs.stat(path.join(workspaceRoot, file));
      if (stat.isFile()) out.push(file);
    } catch {
      // A missing file is represented by absence from the new tree.
    }
  }
  return out;
}

async function collectSnapshotFiles(directory: string, relativeDirectory: string, out: string[]): Promise<void> {
  const dirents = await fs.readdir(directory, { withFileTypes: true });
  for (const dirent of dirents) {
    const relativePath = relativeDirectory ? path.join(relativeDirectory, dirent.name) : dirent.name;
    if (isIgnoredSnapshotPath(relativePath)) continue;
    const absolutePath = path.join(directory, dirent.name);
    if (dirent.isDirectory()) {
      await collectSnapshotFiles(absolutePath, relativePath, out);
    } else if (dirent.isFile()) {
      out.push(relativePath);
    }
  }
}

function isIgnoredSnapshotPath(relativePath: string): boolean {
  const parts = relativePath.split(path.sep);
  if (parts.length >= 3 && parts[0] === ".agents" && parts[1] === "exec" && parts[2] === "snapshots") {
    return true;
  }
  if (parts.some((part) => snapshotIgnoreDirs.has(part))) return true;
  if (parts.some((part) => part.startsWith(".") && part !== ".agents")) return true;
  const basename = parts[parts.length - 1] ?? "";
  return basename.startsWith(".env") || basename === ".gitignore" || basename.startsWith("~");
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function currentTurnNumber(repoPath: string): Promise<number> {
  let out = "";
  try {
    out = await git([`--git-dir=${repoPath}`, "for-each-ref", "--format=%(refname:lstrip=3)", "refs/turn/main/"]);
  } catch {
    return 0;
  }

  let max = 0;
  for (const line of out.split("\n")) {
    const match = line.trim().match(/^t(\d+)$/);
    if (match) max = Math.max(max, Number.parseInt(match[1]!, 10));
  }
  return max;
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  return (await resolveRef(repoPath, ref)) !== undefined;
}

async function resolveRef(repoPath: string, ref: string): Promise<string | undefined> {
  try {
    return (await git([`--git-dir=${repoPath}`, "rev-parse", "--verify", ref])).trim();
  } catch {
    return undefined;
  }
}

function gitSnapshotAudit(owner: SnapshotOwner, repoPath: string, turnNumber: number): GitSnapshotAudit {
  const turnRef = `refs/turn/main/t${Math.max(1, turnNumber)}` as const;
  return {
    type: "git_snapshot",
    agentId: owner.agentId,
    sessionId: owner.sessionId ?? "local-session",
    runId: owner.runId ?? owner.childId ?? "local-run",
    snapshotRepoPath: repoPath,
    baselineRef,
    latestRef,
    turnRef,
    turnNumber,
    commands: {
      listTurns: `${gitDirCommand(repoPath)} for-each-ref refs/turn/main/`,
      turnDiff: `${gitDirCommand(repoPath)} diff ${turnNumber > 1 ? `refs/turn/main/t${turnNumber - 1}` : baselineRef} ${turnRef}`,
      sessionDiff: `${gitDirCommand(repoPath)} diff ${baselineRef} ${latestRef}`,
    },
  };
}

function snapshotMessage(owner: SnapshotOwner, label: string): string {
  return `snapshot:${owner.sessionId ?? "local-session"}:${safePathPart(owner.agentId)}:${safePathPart(owner.runId ?? owner.childId ?? "local-run")}:${label}`;
}

function snapshotRootDir(): string {
  const root = process.env.AGENT_SNAPSHOTS_DIR || path.join(os.homedir(), ".agents");
  return path.join(root, "snapshots", snapshotAgentType);
}

function gitDirCommand(repoPath: string): string {
  return `git --git-dir=${shellQuote(repoPath)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function safePathPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "unknown";
}
