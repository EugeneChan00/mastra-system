import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { resolveWorkspaceInputPath, toWorkspacePath, workspaceRoot } from "../workspace-paths.js";

export type SnapshotOwner = {
  agentId: string;
  sessionId?: string;
  runId?: string;
  childId?: string;
};

export type SnapshotCapture = {
  snapshotRepoPath: string;
  sessionSnapshotPath: string;
  turnSnapshotPath: string;
  sessionDiffPath: string;
  turnDiffPath: string;
  latestRef: string;
  sessionRef: string;
  turnRef: string;
  turnNumber: number;
  sessionDiff: string;
  turnDiff: string;
  reminder: string;
};

type FileSnapshot = Record<string, string>;

const snapshotIgnoreDirs = new Set([".git", "node_modules", ".mastra", "dist", "build"]);

export function snapshotRepoPath(owner: SnapshotOwner): string {
  return path.join(
    workspaceRoot,
    ".agents",
    "exec",
    "snapshots",
    "mastra-agents",
    safePathPart(owner.agentId),
    safePathPart(owner.sessionId ?? "local-session"),
    safePathPart(owner.runId ?? owner.childId ?? "local-run"),
  );
}

export async function initializeSessionSnapshot(owner: SnapshotOwner): Promise<{ snapshotRepoPath: string; sessionSnapshotPath: string; latestRef: string; sessionRef: string }> {
  const repoPath = snapshotRepoPath(owner);
  await fs.mkdir(repoPath, { recursive: true });
  const metadataPath = path.join(repoPath, "metadata.json");
  const baselinePath = path.join(repoPath, "session-baseline.json");
  const existingBaseline = await readSnapshotFile(baselinePath);
  if (!existingBaseline) {
    const baseline = await createWorkspaceSnapshot();
    await writeJsonFile(baselinePath, baseline);
    await writeJsonFile(path.join(repoPath, "latest.json"), baseline);
    await writeJsonFile(metadataPath, {
      agentId: owner.agentId,
      sessionId: owner.sessionId,
      runId: owner.runId,
      childId: owner.childId,
      turnNumber: 0,
      latestSnapshot: baseline,
      updatedAt: new Date().toISOString(),
    });
  }
  return {
    snapshotRepoPath: toWorkspacePath(repoPath),
    sessionSnapshotPath: toWorkspacePath(baselinePath),
    latestRef: "refs/latest",
    sessionRef: "refs/session/baseline",
  };
}

export async function captureTurnSnapshot(owner: SnapshotOwner): Promise<SnapshotCapture> {
  const repoPath = snapshotRepoPath(owner);
  await fs.mkdir(repoPath, { recursive: true });
  const metadataPath = path.join(repoPath, "metadata.json");
  const metadata = await readMetadata(metadataPath);
  const turnNumber = metadata.turnNumber + 1;
  const currentSnapshot = await createWorkspaceSnapshot();

  const baselinePath = path.join(repoPath, "session-baseline.json");
  let baseline = await readSnapshotFile(baselinePath);
  if (!baseline) {
    baseline = metadata.latestSnapshot ?? currentSnapshot;
    await writeJsonFile(baselinePath, baseline);
  }

  const previous = metadata.latestSnapshot ?? baseline;
  const sessionDiff = diffSnapshots(baseline, currentSnapshot);
  const turnDiff = diffSnapshots(previous, currentSnapshot);
  const turnSnapshotPath = path.join(repoPath, "turns", `turn-${turnNumber}.json`);
  const latestSnapshotPath = path.join(repoPath, "latest.json");
  const sessionDiffPath = path.join(repoPath, "session.diff");
  const turnDiffPath = path.join(repoPath, "turns", `turn-${turnNumber}.diff`);

  await fs.mkdir(path.dirname(turnSnapshotPath), { recursive: true });
  await writeJsonFile(turnSnapshotPath, currentSnapshot);
  await writeJsonFile(latestSnapshotPath, currentSnapshot);
  await fs.writeFile(sessionDiffPath, sessionDiff, "utf8");
  await fs.writeFile(turnDiffPath, turnDiff, "utf8");
  await writeJsonFile(metadataPath, {
    agentId: owner.agentId,
    sessionId: owner.sessionId,
    runId: owner.runId,
    childId: owner.childId,
    turnNumber,
    latestSnapshot: currentSnapshot,
    updatedAt: new Date().toISOString(),
  });

  const capture = {
    snapshotRepoPath: toWorkspacePath(repoPath),
    sessionSnapshotPath: toWorkspacePath(baselinePath),
    turnSnapshotPath: toWorkspacePath(turnSnapshotPath),
    sessionDiffPath: toWorkspacePath(sessionDiffPath),
    turnDiffPath: toWorkspacePath(turnDiffPath),
    latestRef: "refs/latest",
    sessionRef: "refs/session/baseline",
    turnRef: `refs/turn/${safePathPart(owner.agentId)}/t${turnNumber}`,
    turnNumber,
    sessionDiff,
    turnDiff,
    reminder: "",
  } satisfies SnapshotCapture;

  return { ...capture, reminder: formatSnapshotReminder(owner, capture) };
}

export async function recordMutationSnapshot(params: {
  owner?: SnapshotOwner;
  tool: "write_file" | "edit_file";
  filePath: string;
  workspacePath: string;
  operation: "create" | "overwrite" | "replace";
  beforeContent: string;
  afterContent: string;
}) {
  const owner = params.owner ?? { agentId: "workspace-tool", sessionId: "local-session", runId: "workspace-mutations" };
  const repoPath = snapshotRepoPath(owner);
  const logPath = path.join(repoPath, "write-events.jsonl");
  const turnDiff = createFileDiff(params.workspacePath, params.beforeContent, params.afterContent);
  const event = {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    tool: params.tool,
    path: params.workspacePath,
    operation: params.operation,
    turnDiff,
    sessionDiff: turnDiff,
  };

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");

  return {
    snapshotPath: toWorkspacePath(logPath),
    snapshotEventId: event.eventId,
    turnDiff,
    sessionDiff: turnDiff,
  };
}

export async function readMutationSnapshots(query: { maxEvents?: number; filePath?: string; owner?: SnapshotOwner }) {
  const owner = query.owner ?? { agentId: "workspace-tool", sessionId: "local-session", runId: "workspace-mutations" };
  const logPath = path.join(snapshotRepoPath(owner), "write-events.jsonl");
  let raw = "";
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const fileFilter = query.filePath === undefined ? undefined : toWorkspacePath(resolveWorkspaceInputPath(query.filePath));
  const maxEvents = query.maxEvents ?? 20;
  const events = raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
    .filter((event) => fileFilter === undefined || event.path === fileFilter)
    .slice(-maxEvents);

  return { snapshotPath: toWorkspacePath(logPath), events };
}

export function formatSnapshotReminder(owner: SnapshotOwner, capture: Omit<SnapshotCapture, "reminder">): string {
  return [
    "Snapshot audit context:",
    `- agent id: ${owner.agentId}`,
    owner.sessionId ? `- session/run id: ${owner.sessionId}` : undefined,
    owner.runId ? `- child/delegation id: ${owner.runId}` : undefined,
    `- turn number: ${capture.turnNumber}`,
    `- snapshot repo: ${capture.snapshotRepoPath}`,
    `- session snapshot: ${capture.sessionSnapshotPath}`,
    `- latest session ref: ${capture.latestRef}`,
    `- current turn snapshot: ${capture.turnSnapshotPath}`,
    `- current turn ref: ${capture.turnRef}`,
    `- turn diff: ${capture.turnDiffPath}`,
    `- session diff: ${capture.sessionDiffPath}`,
    "Use these snapshots to inspect actual file changes before relying on agent claims.",
  ].filter(Boolean).join("\n");
}

async function readMetadata(metadataPath: string): Promise<{ turnNumber: number; latestSnapshot?: FileSnapshot }> {
  try {
    const parsed = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    return {
      turnNumber: typeof parsed.turnNumber === "number" ? parsed.turnNumber : 0,
      latestSnapshot: isSnapshot(parsed.latestSnapshot) ? parsed.latestSnapshot : undefined,
    };
  } catch {
    return { turnNumber: 0 };
  }
}

async function readSnapshotFile(snapshotPath: string): Promise<FileSnapshot | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    return isSnapshot(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function createWorkspaceSnapshot(): Promise<FileSnapshot> {
  const snapshot: FileSnapshot = {};
  await collectFiles(workspaceRoot, snapshot);
  return snapshot;
}

async function collectFiles(directory: string, snapshot: FileSnapshot): Promise<void> {
  const dirents = await fs.readdir(directory, { withFileTypes: true });
  for (const dirent of dirents.sort((left, right) => left.name.localeCompare(right.name))) {
    if (dirent.isDirectory() && snapshotIgnoreDirs.has(dirent.name)) continue;
    const absolutePath = path.join(directory, dirent.name);
    const workspacePath = toWorkspacePath(absolutePath);
    if (workspacePath.startsWith(".agents/exec/snapshots/")) continue;
    if (dirent.isDirectory()) {
      await collectFiles(absolutePath, snapshot);
      continue;
    }
    if (!dirent.isFile()) continue;
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      if (content.includes("\u0000")) continue;
      snapshot[workspacePath] = content;
    } catch {
      // Skip unreadable or non-UTF8 files; snapshots are an audit aid, not a runtime dependency.
    }
  }
}

function diffSnapshots(before: FileSnapshot, after: FileSnapshot): string {
  const files = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  const sections = files
    .filter((filePath) => before[filePath] !== after[filePath])
    .map((filePath) => createFileDiff(filePath, before[filePath] ?? "", after[filePath] ?? ""));
  return sections.length > 0 ? sections.join("\n") : "(no snapshot diff)";
}

function createFileDiff(filePath: string, beforeContent: string, afterContent: string): string {
  if (beforeContent === afterContent) return `(no turn diff for ${filePath})`;
  const beforeLines = splitDiffLines(beforeContent);
  const afterLines = splitDiffLines(afterContent);
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`, "@@"];
  for (const line of beforeLines) lines.push(`-${line}`);
  for (const line of afterLines) lines.push(`+${line}`);
  return lines.join("\n");
}

function splitDiffLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function isSnapshot(value: unknown): value is FileSnapshot {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  return fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
