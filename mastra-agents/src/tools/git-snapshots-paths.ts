/**
 * Path configuration for git-based snapshots.
 * Adapted from ~/just-claude/hooks/snapshot/paths.ts
 *
 * Storage layout: <root>/snapshots/<agent-type>/<session-id>/snapshots.git/
 */
import * as os from "os";
import * as path from "path";

export const AGENT_TYPE = "mastra-agents";
export const DEFAULT_TTL_HOURS = 72;

const AGENTS_DIR = path.join(os.homedir(), ".agents");

export function snapshotRootDir(): string {
  const root = process.env.AGENT_SNAPSHOTS_DIR || AGENTS_DIR;
  return path.join(root, "snapshots", AGENT_TYPE);
}

export function sessionDir(sessionId: string): string {
  return path.join(snapshotRootDir(), sessionId);
}

export function snapshotRepoPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), "snapshots.git");
}

export function pendingPathsFile(sessionId: string): string {
  return path.join(sessionDir(sessionId), "pending.paths");
}
