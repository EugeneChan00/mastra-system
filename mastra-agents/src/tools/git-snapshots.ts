/**
 * Core git-based snapshot capture logic.
 * Adapted from ~/just-claude/hooks/snapshot/capture.ts
 *
 * Creates bare git repositories for session snapshots with:
 * - refs/baseline/startup, end, resume-<iso>
 * - refs/turn/main/t1, t2, t3...
 * - refs/latest (most recent turn)
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { git } from "./git-ops.js";
import { snapshotRepoPath, pendingPathsFile } from "./git-snapshots-paths.js";
import { readPendingPaths, clearPendingPaths } from "./git-snapshots-touched.js";

export async function ensureRepo(sessionId: string): Promise<string> {
  const repoPath = snapshotRepoPath(sessionId);
  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });
    await git(["init", "--bare", repoPath]);
  }
  return repoPath;
}

/**
 * Build a commit from an explicit list of absolute paths, staged against a
 * root work-tree (`/`). This allows capturing files written anywhere on disk
 * via absolute paths.
 */
async function buildCommitFromPaths(
  repoPath: string,
  absPaths: string[],
  message: string,
  parent: string | null,
): Promise<{ commit: string; tree: string }> {
  const tmpIdx = path.join(
    os.tmpdir(),
    `snap-idx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const baseGitEnv = {
    GIT_INDEX_FILE: tmpIdx,
    GIT_WORK_TREE: "/",
  };
  try {
    // Seed the index with the parent tree so unchanged files keep their prior state
    if (parent) {
      await git([`--git-dir=${repoPath}`, "read-tree", parent], { env: baseGitEnv });
    }
    // Stage each touched path explicitly
    if (absPaths.length > 0) {
      await git(
        [`--git-dir=${repoPath}`, `--work-tree=/`, "add", "--ignore-errors", "--", ...absPaths],
        { env: baseGitEnv }
      );
    }
    return await writeTreeAndCommit(repoPath, baseGitEnv, message, parent);
  } finally {
    try { fs.unlinkSync(tmpIdx); } catch {}
  }
}

/** Shared write-tree + commit-tree tail */
async function writeTreeAndCommit(
  repoPath: string,
  baseGitEnv: Record<string, string>,
  message: string,
  parent: string | null
): Promise<{ commit: string; tree: string }> {
  const tree = (await git([`--git-dir=${repoPath}`, "write-tree"], { env: baseGitEnv })).trim();
  const parentArgs = parent ? ["-p", parent] : [];
  const authorEnv = {
    ...baseGitEnv,
    GIT_AUTHOR_NAME: "snapshot-hook",
    GIT_AUTHOR_EMAIL: "snapshot@local",
    GIT_COMMITTER_NAME: "snapshot-hook",
    GIT_COMMITTER_EMAIL: "snapshot@local",
  };
  const commit = (
    await git(
      [`--git-dir=${repoPath}`, "commit-tree", tree, ...parentArgs, "-m", message],
      { env: authorEnv }
    )
  ).trim();
  return { commit, tree };
}

function baselineRefName(source: "startup" | "resume" | "clear" | "compact" | "end"): string {
  if (source === "startup") return "refs/baseline/startup";
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  return `refs/baseline/${source}-${iso}`;
}

/**
 * Determine the next turn number by reading existing refs/turn/main/t<N> refs.
 */
export async function nextTurnN(repoPath: string): Promise<number> {
  let out = "";
  try {
    out = await git([`--git-dir=${repoPath}`, "for-each-ref", "--format=%(refname:lstrip=3)", "refs/turn/main/"]);
  } catch {
    return 1;
  }
  let maxN = 0;
  for (const line of out.split("\n")) {
    const m = line.match(/^t(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1]!, 10));
  }
  return maxN + 1;
}

export async function tipOfRef(repoPath: string, ref: string): Promise<string | null> {
  try {
    return (await git([`--git-dir=${repoPath}`, "rev-parse", "--verify", ref])).trim();
  } catch {
    return null;
  }
}

export async function treeOfCommit(repoPath: string, commit: string): Promise<string> {
  return (await git([`--git-dir=${repoPath}`, "rev-parse", `${commit}^{tree}`])).trim();
}

/**
 * Capture a turn commit from pending paths.
 * Called on Stop event to commit all mutations since last capture.
 */
export async function captureTurn(sessionId: string): Promise<{ commit: string; turnN: number; paths: string[] }> {
  const paths = readPendingPaths(sessionId);
  if (paths.length === 0) {
    return { commit: "", turnN: 1, paths: [] };
  }

  const repoPath = await ensureRepo(sessionId);
  const turnN = await nextTurnN(repoPath);
  const prevTurnRef = turnN > 1 ? `refs/turn/main/t${turnN - 1}` : "";

  // Find parent: previous turn or most recent baseline
  const baselineTip = await (async () => {
    try {
      return (await git([
        `--git-dir=${repoPath}`,
        "for-each-ref",
        "--sort=-committerdate",
        "--count=1",
        "--format=%(objectname)",
        "refs/baseline/*"
      ])).trim();
    } catch {
      return "";
    }
  })();

  const parentSha = (prevTurnRef ? await tipOfRef(repoPath, prevTurnRef) : "") || baselineTip || null;

  const msg = `snapshot:${sessionId}:main:t${turnN}:postresult:0`;
  const { commit, tree } = await buildCommitFromPaths(repoPath, paths, msg, parentSha);

  // Tree-equality no-op: if parent has identical tree, don't write the ref
  if (parentSha) {
    const prevTree = await treeOfCommit(repoPath, parentSha);
    if (prevTree === tree) {
      clearPendingPaths(sessionId);
      return { commit: "", turnN, paths };
    }
  }

  // Update refs
  const ref = `refs/turn/main/t${turnN}`;
  await git([`--git-dir=${repoPath}`, "update-ref", ref, commit, "0000000000000000000000000000000000000000"]);
  const prevLatest = (await tipOfRef(repoPath, "refs/latest")) || "0000000000000000000000000000000000000000";
  await git([`--git-dir=${repoPath}`, "update-ref", "refs/latest", commit, prevLatest]);

  clearPendingPaths(sessionId);
  return { commit, turnN, paths };
}

/**
 * Capture a baseline commit (startup, resume, end).
 * Called on SessionStart and SessionEnd events.
 */
export async function captureBaseline(
  sessionId: string,
  source: "startup" | "resume" | "clear" | "compact" | "end"
): Promise<string> {
  const repoPath = await ensureRepo(sessionId);
  const msg = `snapshot:${sessionId}:main:baseline:${source}:0`;
  const { commit } = await buildCommitFromPaths(repoPath, [], msg, null);
  const ref = baselineRefName(source);
  await git([`--git-dir=${repoPath}`, "update-ref", ref, commit, "0000000000000000000000000000000000000000"]);
  return commit;
}
