// Snapshot query tools for turn and session diffs
// Adapted from ~/just-claude/micro-apps/palmer/src/snapshots.ts

import { git } from "./git-ops.js";
import { snapshotRepoPath } from "./git-snapshots-paths.js";

export interface DiffFileEntry {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "binary";
  additions: number;
  deletions: number;
  binary?: boolean;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: string[];
}

// runGit wraps the git() function with --git-dir parameter
export async function runGit(repoPath: string, args: string[]): Promise<string> {
  return git(["--git-dir=" + repoPath, ...args]);
}

export async function currentTurnN(repoPath: string): Promise<number> {
  try {
    const out = await runGit(repoPath, [
      "for-each-ref",
      "--format=%(refname:lstrip=3)",
      "refs/turn/main/",
    ]);
    let max = 0;
    const lines = out.split("\n");
    for (const line of lines) {
      const m = line.match(/^t(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max;
  } catch {
    return 0;
  }
}

export function parseUnifiedDiff(diff: string): DiffFileEntry[] {
  if (!diff.trim()) return [];
  const lines = diff.split("\n");
  const entries: DiffFileEntry[] = [];
  let cur: DiffFileEntry | null = null;
  let curHunk: DiffHunk | null = null;

  const flush = () => {
    if (curHunk && cur) cur.hunks.push(curHunk);
    curHunk = null;
    if (cur) entries.push(cur);
    cur = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      const m = line.match(/^diff --git a\/(.*?) b\/(.+)$/);
      cur = {
        path: m ? m[2] : "",
        status: "modified",
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      continue;
    }
    if (!cur) continue;

    if (line.startsWith("rename from ")) {
      cur.oldPath = line.slice("rename from ".length);
      cur.status = "renamed";
      continue;
    }
    if (line.startsWith("rename to ")) {
      cur.path = line.slice("rename to ".length);
      continue;
    }
    if (line.startsWith("new file mode ")) { cur.status = "added"; continue; }
    if (line.startsWith("deleted file mode ")) { cur.status = "deleted"; continue; }
    if (line.startsWith("Binary files ")) {
      cur.binary = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      if (line === "--- /dev/null") cur.status = "added";
      continue;
    }
    if (line.startsWith("+++ ")) {
      if (line === "+++ /dev/null") cur.status = "deleted";
      continue;
    }
    if (line.startsWith("@@ ")) {
      if (curHunk) cur.hunks.push(curHunk);
      curHunk = { header: line.replace(/^(@@ [^@]+@@).*$/, "$1"), lines: [] };
      continue;
    }
    if (curHunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "")) {
      if (line.startsWith("+")) cur.additions++;
      else if (line.startsWith("-")) cur.deletions++;
      curHunk.lines.push(line);
    }
  }
  flush();
  return entries.filter(e => e.path || e.binary);
}

export async function rawTurnDiff(repoPath: string, turn: number | string): Promise<string> {
  const targetRef = typeof turn === "number" ? "refs/turn/main/t" + turn : turn;
  try {
    await runGit(repoPath, ["rev-parse", "--verify", targetRef]);
  } catch {
    return "";
  }

  let prevSha = "";
  try {
    prevSha = (await runGit(repoPath, ["rev-parse", "--verify", targetRef + "^"])).trim();
  } catch {
    prevSha = "";
  }

  const empty = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const left = prevSha || empty;

  return runGit(repoPath, ["diff", "--no-color", left, targetRef]);
}

export async function turnDiff(repoPath: string, turnN: number): Promise<DiffFileEntry[]> {
  return parseUnifiedDiff(await rawTurnDiff(repoPath, turnN));
}

export async function rawSessionDiff(repoPath: string): Promise<string> {
  let latest = "";
  try {
    latest = (await runGit(repoPath, ["rev-parse", "--verify", "refs/latest"])).trim();
  } catch {
    return "";
  }
  if (!latest) return "";

  let baseline = "";
  try {
    baseline = (await runGit(repoPath, ["rev-list", "--max-parents=0", latest]))
      .trim()
      .split("\n")[0] || "";
  } catch {
    baseline = "";
  }
  if (!baseline || baseline === latest) return "";

  return runGit(repoPath, ["diff", "--no-color", baseline, latest]);
}

export async function sessionDiff(repoPath: string): Promise<DiffFileEntry[]> {
  return parseUnifiedDiff(await rawSessionDiff(repoPath));
}

export async function listTurns(repoPath: string): Promise<string[]> {
  try {
    const out = await runGit(repoPath, [
      "for-each-ref",
      "--sort=creatordate",
      "--format=%(refname:lstrip=3)",
      "refs/turn/main/",
    ]);
    return out.split("\n").filter(line => line.trim().startsWith("t"));
  } catch {
    return [];
  }
}

export async function fileAtTurn(repoPath: string, turnRef: string, filePath: string): Promise<string | null> {
  try {
    const content = await runGit(repoPath, ["show", turnRef + ":" + filePath]);
    return content;
  } catch {
    return null;
  }
}
