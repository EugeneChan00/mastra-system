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

type WorkspaceFile = {
  path: string;
  type: "file" | "directory";
};

type ListFilesInput = z.input<typeof listFilesQuerySchema>;
type ReadFileInput = z.input<typeof readFileQuerySchema>;
type WriteFileInput = z.input<typeof writeFileQuerySchema>;
type ReplaceInFileInput = z.input<typeof replaceInFileQuerySchema>;

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
  const filePath = resolveWorkspaceInputPath(query.filePath);
  const overwrite = query.overwrite ?? false;
  const existed = await fileExists(filePath);

  if (existed && !overwrite) {
    throw new Error("File already exists. Set overwrite=true to replace it.");
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, query.content, "utf8");

  return {
    path: toWorkspacePath(filePath),
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

  return {
    path: toWorkspacePath(filePath),
    replacements: query.replaceAll ? matches : 1,
  };
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
    description: `Create or overwrite a UTF-8 text file under the configured workspace root. Relative paths resolve under ${workspaceRoot}; absolute paths are allowed under: ${allowedWorkspaceRootsDescription()}.`,
    inputSchema: writeFileQuerySchema,
    outputSchema: writeFileResultSchema,
    execute: executeWriteFile,
  }),
  replaceInFile: createTool({
    id: "workspace.replace-in-file",
    description: `Replace exact text in a UTF-8 file under the configured workspace root. Relative paths resolve under ${workspaceRoot}; absolute paths are allowed under: ${allowedWorkspaceRootsDescription()}.`,
    inputSchema: replaceInFileQuerySchema,
    outputSchema: replaceInFileResultSchema,
    execute: executeReplaceInFile,
  }),
};
