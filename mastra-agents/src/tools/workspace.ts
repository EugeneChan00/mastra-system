import { promises as fs } from "node:fs";
import path from "node:path";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  allowedWorkspaceRootsDescription,
  resolveWorkspaceInputPath,
  toWorkspacePath,
  workspaceAccessRoots,
  workspaceRoot,
} from "../workspace-paths.js";
import { recordTouchedPath } from "./git-snapshots-touched.js";
import { captureTurn, captureBaseline } from "./git-snapshots.js";
import { snapshotRepoPath } from "./git-snapshots-paths.js";
import { turnDiff, sessionDiff, listTurns, currentTurnN, fileAtTurn, rawTurnDiff, rawSessionDiff, parseUnifiedDiff } from "./snapshot-queries.js";
import { getOrCreateSessionId } from "../session.js";

type WorkspaceFile = {
  path: string;
  type: "file" | "directory";
};

type ListFilesInput = z.input<typeof listFilesQuerySchema>;
type ReadFileInput = z.input<typeof readFileQuerySchema>;
type WriteFileInput = z.input<typeof writeFileQuerySchema>;
type ReplaceInFileInput = z.input<typeof replaceInFileQuerySchema>;
type ReadSnapshotsInput = z.input<typeof readSnapshotsQuerySchema>;

const maxReadBytes = Number.parseInt(
  process.env.MASTRA_WORKSPACE_MAX_READ_BYTES ?? "200000",
  10,
);

const listFilesQuerySchema = z.object({
  directory: z.string().default("."),
  maxDepth: z.number().int().min(0).max(8).default(3),
});

const listFilesResultSchema = z.object({
  root: z.string(),
  accessRoots: z.array(z.string()),
  directory: z.string(),
  entries: z.array(
    z.object({
      path: z.string(),
      type: z.enum(["file", "directory"]),
    }),
  ),
});

const readFileQuerySchema = z.object({
  filePath: z.string(),
});

const readFileResultSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const writeFileQuerySchema = z.object({
  filePath: z.string(),
  content: z.string(),
  overwrite: z.boolean().default(false),
});

const writeFileResultSchema = z.object({
  path: z.string(),
  bytesWritten: z.number().int(),
  overwritten: z.boolean(),
});

const replaceInFileQuerySchema = z.object({
  filePath: z.string(),
  oldText: z.string().min(1),
  newText: z.string(),
  replaceAll: z.boolean().default(false),
});

const replaceInFileResultSchema = z.object({
  path: z.string(),
  replacements: z.number().int(),
});

// Git-based snapshot query schemas
const gitSnapshotAuditInputSchema = z.object({
  type: z.literal("git_snapshot").optional(),
  snapshotRepoPath: z.string(),
}).passthrough();

const gitSnapshotQuerySchema = z.object({
  queryType: z.enum(["session_diff", "turn_diff", "list_turns", "current_turn", "file_at_turn"]),
  snapshotRepoPath: z.string().optional(),
  snapshot: gitSnapshotAuditInputSchema.optional(),
  sessionId: z.string().optional(),
  turnN: z.number().int().min(1).optional(),
  turnRef: z.string().optional(),
  filePath: z.string().optional(),
});

const readSnapshotsQuerySchema = gitSnapshotQuerySchema.extend({
  queryType: z.enum(["session_diff", "turn_diff", "list_turns", "current_turn", "file_at_turn"]).default("session_diff"),
});

const gitSnapshotResultSchema = z.object({
  snapshotRepoPath: z.string(),
  queryType: z.string(),
  rawDiff: z.string().optional(),
  files: z.array(z.object({
    path: z.string(),
    status: z.string(),
    additions: z.number(),
    deletions: z.number(),
  })).optional(),
  turns: z.array(z.string()).optional(),
  currentTurn: z.number().optional(),
  content: z.string().optional(),
  snapshot: gitSnapshotAuditInputSchema.optional(),
});

const readSnapshotsResultSchema = gitSnapshotResultSchema;

async function listDirectoryEntries(
  directoryPath: string,
  maxDepth: number,
  currentDepth = 0,
): Promise<WorkspaceFile[]> {
  const dirents = await fs.readdir(directoryPath, { withFileTypes: true });
  const entries = dirents
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".mastra")
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: WorkspaceFile[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push({ path: toWorkspacePath(absolutePath), type: "directory" });

      if (currentDepth < maxDepth) {
        files.push(...(await listDirectoryEntries(absolutePath, maxDepth, currentDepth + 1)));
      }
    } else if (entry.isFile()) {
      files.push({ path: toWorkspacePath(absolutePath), type: "file" });
    }
  }

  return files;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function executeListFiles(query: ListFilesInput) {
  const directory = query.directory ?? ".";
  const maxDepth = query.maxDepth ?? 3;
  const directoryPath = resolveWorkspaceInputPath(directory);
  const stat = await fs.stat(directoryPath);

  if (!stat.isDirectory()) {
    throw new Error("Path is not a directory.");
  }

  return {
    root: workspaceRoot,
    accessRoots: workspaceAccessRoots,
    directory: toWorkspacePath(directoryPath),
    entries: await listDirectoryEntries(directoryPath, maxDepth),
  };
}

async function executeReadFile(query: ReadFileInput) {
  const filePath = resolveWorkspaceInputPath(query.filePath);
  const stat = await fs.stat(filePath);

  if (!stat.isFile()) {
    throw new Error("Path is not a file.");
  }

  if (stat.size > maxReadBytes) {
    throw new Error(`File is too large to read (${stat.size} bytes).`);
  }

  return {
    path: toWorkspacePath(filePath),
    content: await fs.readFile(filePath, "utf8"),
  };
}

async function executeWriteFile(query: WriteFileInput) {
  const sessionId = getOrCreateSessionId();
  const filePath = resolveWorkspaceInputPath(query.filePath);
  const overwrite = query.overwrite ?? false;
  const existed = await fileExists(filePath);

  if (existed && !overwrite) {
    throw new Error("File already exists. Set overwrite=true to replace it.");
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, query.content, "utf8");

  // Record path for git-based snapshot capture
  recordTouchedPath(sessionId, filePath);

  const workspacePath = toWorkspacePath(filePath);

  return {
    path: workspacePath,
    bytesWritten: Buffer.byteLength(query.content, "utf8"),
    overwritten: existed,
  };
}

async function executeReplaceInFile(query: ReplaceInFileInput) {
  const filePath = resolveWorkspaceInputPath(query.filePath);
  const content = await fs.readFile(filePath, "utf8");
  const matches = content.split(query.oldText).length - 1;

  if (matches === 0) {
    throw new Error("oldText was not found in the file.");
  }

  if (!query.replaceAll && matches > 1) {
    throw new Error("oldText appears multiple times. Set replaceAll=true or provide more context.");
  }

  const updatedContent = query.replaceAll
    ? content.replaceAll(query.oldText, query.newText)
    : content.replace(query.oldText, query.newText);

  await fs.writeFile(filePath, updatedContent, "utf8");

  // Record path for git-based snapshot capture
  const editSessionId = getOrCreateSessionId();
  recordTouchedPath(editSessionId, filePath);

  const workspacePath = toWorkspacePath(filePath);

  return {
    path: workspacePath,
    replacements: query.replaceAll ? matches : 1,
  };
}

async function executeReadSnapshots(query: ReadSnapshotsInput) {
  return executeGitSnapshotQuery(query);
}

async function executeGitSnapshotQuery(query: z.input<typeof gitSnapshotQuerySchema> | z.input<typeof readSnapshotsQuerySchema>) {
  const repoPath = resolveGitSnapshotRepoPath(query);
  const queryType = query.queryType ?? "session_diff";
  const snapshot = query.snapshot;

  switch (queryType) {
    case "session_diff": {
      const rawDiff = await rawSessionDiff(repoPath);
      const diffs = await sessionDiff(repoPath);
      return {
        snapshotRepoPath: repoPath,
        queryType,
        snapshot,
        rawDiff,
        files: diffs.map(d => ({
          path: d.path,
          status: d.status,
          additions: d.additions,
          deletions: d.deletions,
        })),
      };
    }
    case "turn_diff": {
      const turnN = query.turnN || 1;
      const rawDiff = await rawTurnDiff(repoPath, query.turnRef || turnN);
      const diffs = query.turnRef ? parseUnifiedDiff(rawDiff) : await turnDiff(repoPath, turnN);
      return {
        snapshotRepoPath: repoPath,
        queryType,
        snapshot,
        rawDiff,
        files: diffs.map(d => ({
          path: d.path,
          status: d.status,
          additions: d.additions,
          deletions: d.deletions,
        })),
      };
    }
    case "list_turns": {
      const turns = await listTurns(repoPath);
      return {
        snapshotRepoPath: repoPath,
        queryType,
        snapshot,
        turns,
      };
    }
    case "current_turn": {
      const currentTurn = await currentTurnN(repoPath);
      return {
        snapshotRepoPath: repoPath,
        queryType,
        snapshot,
        currentTurn,
      };
    }
    case "file_at_turn": {
      const turnRef = query.turnRef || `refs/turn/main/t${query.turnN || 1}`;
      const filePath = query.filePath || "";
      const content = await fileAtTurn(repoPath, turnRef, filePath);
      return {
        snapshotRepoPath: repoPath,
        queryType,
        snapshot,
        content,
      };
    }
    default:
      throw new Error(`Unknown query type: ${queryType}`);
  }
}

function resolveGitSnapshotRepoPath(query: z.input<typeof gitSnapshotQuerySchema> | z.input<typeof readSnapshotsQuerySchema>): string {
  if (query.snapshot?.snapshotRepoPath) return query.snapshot.snapshotRepoPath;
  if (query.snapshotRepoPath) return query.snapshotRepoPath;
  const sessionId = query.sessionId || process.env.MASTRA_SESSION_ID || "default";
  return snapshotRepoPath(sessionId);
}

export const workspaceSchemas = {
  listFilesQuery: listFilesQuerySchema,
  listFilesResult: listFilesResultSchema,
  readFileQuery: readFileQuerySchema,
  readFileResult: readFileResultSchema,
  writeFileQuery: writeFileQuerySchema,
  writeFileResult: writeFileResultSchema,
  replaceInFileQuery: replaceInFileQuerySchema,
  replaceInFileResult: replaceInFileResultSchema,
  readSnapshotsQuery: readSnapshotsQuerySchema,
  readSnapshotsResult: readSnapshotsResultSchema,
  gitSnapshotQuery: gitSnapshotQuerySchema,
  gitSnapshotResult: gitSnapshotResultSchema,
};

export const workspaceTools = {
  listFiles: createTool({
    id: "workspace.list-files",
    description: `List files and directories under the configured workspace root. Relative paths resolve under ${workspaceRoot}; absolute paths are allowed under: ${allowedWorkspaceRootsDescription()}.`,
    inputSchema: listFilesQuerySchema,
    outputSchema: listFilesResultSchema,
    execute: executeListFiles,
  }),
  readFile: createTool({
    id: "workspace.read-file",
    description: `Read a UTF-8 text file from the configured workspace root. Relative paths resolve under ${workspaceRoot}; absolute paths are allowed under: ${allowedWorkspaceRootsDescription()}.`,
    inputSchema: readFileQuerySchema,
    outputSchema: readFileResultSchema,
    execute: executeReadFile,
  }),
  writeFile: createTool({
    id: "workspace.write-file",
    description: `Create or overwrite a UTF-8 text file under the configured workspace root. Relative paths resolve under ${workspaceRoot}; absolute paths are allowed under: ${allowedWorkspaceRootsDescription()}. The path is registered for the next git snapshot capture; use the returned git snapshot object after the agent response to audit diffs.`,
    inputSchema: writeFileQuerySchema,
    outputSchema: writeFileResultSchema,
    execute: executeWriteFile,
  }),
  replaceInFile: createTool({
    id: "workspace.replace-in-file",
    description: `Replace exact text in a UTF-8 file under the configured workspace root. Relative paths resolve under ${workspaceRoot}; absolute paths are allowed under: ${allowedWorkspaceRootsDescription()}. The path is registered for the next git snapshot capture; use the returned git snapshot object after the agent response to audit diffs.`,
    inputSchema: replaceInFileQuerySchema,
    outputSchema: replaceInFileResultSchema,
    execute: executeReplaceInFile,
  }),
  readSnapshots: createTool({
    id: "workspace.read-snapshots",
    description: `Compatibility alias for querying git-based snapshots. Prefer git_snapshot_query with snapshotRepoPath from the agent completion snapshot object.`,
    inputSchema: readSnapshotsQuerySchema,
    outputSchema: readSnapshotsResultSchema,
    execute: executeReadSnapshots,
  }),
  gitSnapshotQuery: createTool({
    id: "workspace.git-snapshot-query",
    description: `Query git-based snapshots for turn and session diffs. Use after Stop events or to audit subagent mutations. Session diff shows all changes from baseline. Turn diff shows changes in a specific turn.`,
    inputSchema: gitSnapshotQuerySchema,
    outputSchema: gitSnapshotResultSchema,
    execute: executeGitSnapshotQuery,
  }),
  captureSnapshot: createTool({
    id: "workspace.capture-snapshot",
    description: `Capture a git snapshot of all pending file mutations. Call this after write_file or edit_file operations to commit changes to the git snapshot repo. Use capture_type "turn" for incremental changes, "baseline" for session boundaries.`,
    inputSchema: z.object({
      captureType: z.enum(["turn", "baseline"]).default("turn"),
      source: z.enum(["startup", "resume", "clear", "compact", "end"]).optional(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      commit: z.string(),
      turnN: z.number().optional(),
      paths: z.array(z.string()),
      snapshotRepoPath: z.string(),
    }),
    execute: async (query) => {
      const sessionId = getOrCreateSessionId();
      const repoPath = snapshotRepoPath(sessionId);

      if (query.captureType === "turn") {
        const result = await captureTurn(sessionId);
        return {
          success: !!result.commit,
          commit: result.commit,
          turnN: result.turnN,
          paths: result.paths,
          snapshotRepoPath: repoPath,
        };
      } else {
        const source = query.source || "startup";
        const commit = await captureBaseline(sessionId, source);
        return {
          success: !!commit,
          commit,
          paths: [],
          snapshotRepoPath: repoPath,
        };
      }
    },
  }),
};
