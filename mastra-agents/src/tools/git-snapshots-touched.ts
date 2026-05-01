/**
 * PostToolUse path tracking for git-based snapshots.
 * Adapted from ~/just-claude/hooks/snapshot/touched.ts
 *
 * Tracks Write/Edit tools and records their target paths for snapshot capture.
 */
import * as fs from "fs";
import * as path from "path";
import { sessionDir, pendingPathsFile } from "./git-snapshots-paths.js";

/** Tools whose tool_input.file_path represents a write target */
export const WRITE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "replaceInFile",
  "Write",
  "Edit",
  "MultiEdit",
  "create_file",
  "update_file",
]);

/**
 * Extract the absolute path a tool invocation wrote to.
 * Relative paths are resolved against cwd.
 */
export function extractWritePath(
  toolName: string,
  toolInput: any,
  cwd: string
): string | null {
  if (!WRITE_TOOLS.has(toolName)) return null;
  const raw = toolInput?.file_path || toolInput?.path || toolInput?.target;
  if (typeof raw !== "string" || raw.length === 0) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

/**
 * Append one path to the session's pending.paths file.
 */
export function recordTouchedPath(sessionId: string, absPath: string): void {
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(pendingPathsFile(sessionId), absPath + "\n");
}

/**
 * Read all pending paths for this session, deduplicated and trimmed.
 */
export function readPendingPaths(sessionId: string): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(pendingPathsFile(sessionId), "utf8");
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Clear the pending-paths file for this session.
 */
export function clearPendingPaths(sessionId: string): void {
  try {
    fs.unlinkSync(pendingPathsFile(sessionId));
  } catch {}
}
