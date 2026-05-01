/**
 * Session management for Mastra agents.
 * Provides session ID management for git-based snapshots.
 */
import { randomUUID } from "crypto";
import { snapshotRepoPath, sessionDir } from "./tools/git-snapshots-paths.js";

let globalSessionId: string | null = null;
let sessionInitialized = false;

/**
 * Get or create a session ID.
 * Once created, returns the same ID for the lifetime of the process.
 */
export function getOrCreateSessionId(): string {
  if (!globalSessionId) {
    // Check environment variable first
    if (process.env.MASTRA_SESSION_ID) {
      globalSessionId = process.env.MASTRA_SESSION_ID;
    } else {
      globalSessionId = randomUUID();
    }
    sessionInitialized = true;
  }
  return globalSessionId;
}

/**
 * Set the session ID explicitly.
 */
export function setSessionId(sessionId: string): void {
  globalSessionId = sessionId;
  sessionInitialized = true;
}

/**
 * Clear the current session ID.
 */
export function clearSessionId(): void {
  globalSessionId = null;
  sessionInitialized = false;
}

/**
 * Check if session has been initialized.
 */
export function isSessionInitialized(): boolean {
  return sessionInitialized;
}

/**
 * Get the snapshot repo path for the current session.
 */
export function getSnapshotRepoPath(): string {
  return snapshotRepoPath(getOrCreateSessionId());
}

/**
 * Get the session directory for the current session.
 */
export function getSessionDir(): string {
  return sessionDir(getOrCreateSessionId());
}
