import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import path from "node:path";

import { DaytonaAgentsDaytonaSandbox } from "../daytona/mastra-sandbox";
import {
  resolveDaytonaVolumeMounts,
  resolveSandboxRuntimeEnv,
} from "../daytona/sandbox-config";

export const workspaceRoot = path.resolve(
  process.env.MASTRA_WORKSPACE_ROOT ?? path.resolve(process.cwd(), "../.."),
);

const defaultSnapshot =
  process.env.MASTRA_DEFAULT_SNAPSHOT ??
  "daytona-agents/snapshot-coding-base:local";
const allowedLanguages = ["typescript", "javascript", "python"] as const;

type DaytonaWorkspaceLanguage = (typeof allowedLanguages)[number];

function resolveBooleanEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function resolveNumberEnv(value: string | undefined) {
  if (value === undefined || value === "") {
    return undefined;
  }

  const resolvedValue = Number(value);
  return Number.isFinite(resolvedValue) ? resolvedValue : undefined;
}

function resolveWorkspaceLanguage(value: string | undefined): DaytonaWorkspaceLanguage {
  if (allowedLanguages.includes(value as DaytonaWorkspaceLanguage)) {
    return value as DaytonaWorkspaceLanguage;
  }

  return "typescript";
}

export function resolveWorkspacePath(filePath: string) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(workspaceRoot, filePath);
}

export const codingSandbox = new DaytonaAgentsDaytonaSandbox({
  id: process.env.DAYTONA_WORKSPACE_SANDBOX_ID ?? "daytona-agents-global-coding",
  name: process.env.DAYTONA_WORKSPACE_SANDBOX_NAME ?? "daytona-agents-global-coding",
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL ?? "http://daytona-api:3000/api",
  snapshot: process.env.DAYTONA_WORKSPACE_SNAPSHOT ?? defaultSnapshot,
  language: resolveWorkspaceLanguage(process.env.DAYTONA_WORKSPACE_LANGUAGE),
  ephemeral: resolveBooleanEnv(process.env.DAYTONA_WORKSPACE_EPHEMERAL, false),
  autoStopInterval: resolveNumberEnv(process.env.DAYTONA_WORKSPACE_AUTO_STOP_INTERVAL),
  autoArchiveInterval: resolveNumberEnv(process.env.DAYTONA_WORKSPACE_AUTO_ARCHIVE_INTERVAL),
  autoDeleteInterval: resolveNumberEnv(process.env.DAYTONA_WORKSPACE_AUTO_DELETE_INTERVAL),
  resources: {
    cpu: resolveNumberEnv(process.env.DAYTONA_WORKSPACE_CPU) ?? 4,
    memory: resolveNumberEnv(process.env.DAYTONA_WORKSPACE_MEMORY_GB) ?? 8,
    disk: resolveNumberEnv(process.env.DAYTONA_WORKSPACE_DISK_GB) ?? 50,
  },
  // Daytona creates sandboxes with volume mounts declared up front. The mount
  // paths below are the paths agents should use inside the Daytona sandbox;
  // Daytona handles the backend MinIO/S3 volume plumbing outside Mastra.
  volumes: resolveDaytonaVolumeMounts(),
  env: resolveSandboxRuntimeEnv(),
  labels: {
    app: "daytona-agents",
    role: "mastra-workspace",
    managedBy: "mastra-control",
  },
});

export const workspace = new Workspace({
  id: "daytona-agents",
  name: "Daytona Agents Daytona Workspace",
  sandbox: codingSandbox,
  mounts: {
    "/daytona-agents": new LocalFilesystem({
      basePath: workspaceRoot,
    }),
  },
  onMount: ({ filesystem }) => {
    if (filesystem.provider === "local") {
      return false;
    }

    return undefined;
  },
});
