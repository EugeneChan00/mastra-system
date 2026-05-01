/**
 * Snapshot lifecycle hooks for Mastra agents.
 * Integrates git-based snapshots with agent lifecycle events.
 * 
 * Hooks:
 * - onSessionStart: Capture baseline at session start
 * - onStop: Capture turn from pending paths
 * - onSessionEnd: Capture final baseline
 * - onToolUse: Track write/edit paths for later capture
 */
import { captureTurn, captureBaseline } from "../tools/git-snapshots.js";
import { extractWritePath } from "../tools/git-snapshots-touched.js";

let currentSessionId: string | null = null;
let currentCwd: string = process.cwd();

/**
 * Set the current session context.
 * Called when a new agent session starts.
 */
export function setSessionContext(sessionId: string, cwd?: string): void {
  currentSessionId = sessionId;
  currentCwd = cwd || process.cwd();
}

/**
 * Get the current session ID.
 */
export function getSessionId(): string {
  return currentSessionId || "default";
}

/**
 * Hook: SessionStart - Capture baseline snapshot.
 * Called at session initialization or resume.
 */
export async function onSessionStart(source: "startup" | "resume" | "clear" | "compact" = "startup"): Promise<string> {
  const sessionId = getSessionId();
  try {
    const commit = await captureBaseline(sessionId, source);
    return commit;
  } catch (e) {
    console.error("Failed to capture baseline:", e);
    return "";
  }
}

/**
 * Hook: Stop - Capture turn snapshot from pending paths.
 * Called when agent completes a turn (stop event).
 */
export async function onStop(): Promise<{ commit: string; turnN: number; paths: string[] }> {
  const sessionId = getSessionId();
  try {
    const result = await captureTurn(sessionId);
    return result;
  } catch (e) {
    console.error("Failed to capture turn:", e);
    return { commit: "", turnN: 0, paths: [] };
  }
}

/**
 * Hook: SessionEnd - Capture final baseline.
 * Called when session terminates.
 */
export async function onSessionEnd(): Promise<string> {
  const sessionId = getSessionId();
  try {
    const commit = await captureBaseline(sessionId, "end");
    return commit;
  } catch (e) {
    console.error("Failed to capture session end baseline:", e);
    return "";
  }
}

/**
 * Hook: ToolUse - Track write/edit paths for snapshot capture.
 * Called after each tool execution.
 */
export function onToolUse(toolName: string, toolInput: any): void {
  const sessionId = getSessionId();
  try {
    const absPath = extractWritePath(toolName, toolInput, currentCwd);
    if (absPath) {
      // Import and call recordTouchedPath
      const { recordTouchedPath } = require("../tools/git-snapshots-touched.js");
      recordTouchedPath(sessionId, absPath);
    }
  } catch (e) {
    // Silently fail - path tracking is best-effort
  }
}

/**
 * Helper: Check if git is available.
 */
export async function isGitAvailable(): Promise<boolean> {
  try {
    const { gitAvailable } = await import("../tools/git-ops.js");
    return await gitAvailable();
  } catch {
    return false;
  }
}
