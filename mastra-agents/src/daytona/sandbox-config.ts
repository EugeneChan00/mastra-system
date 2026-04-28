import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export type DaytonaVolumeMount = {
  volumeId: string;
  mountPath: string;
  subpath?: string;
};

const sandboxRuntimeEnv = {
  SERENA_PROJECT: "/workspace",
  SERENA_CONTEXT: "codex",
  SERENA_MCP_PORT: "8084",
  CODE_REVIEW_GRAPH_REPO: "/workspace",
  CODE_REVIEW_GRAPH_MCP_PORT: "8085",
  AGENT_SERVICES_AUTOSTART: "false",
  LOCAL_MCP_AUTOSTART: "false",
  JUPYTER_AUTOSTART: "false",
  JUPYTER_HOST: "127.0.0.1",
  JUPYTER_PORT: "8888",
  JUPYTER_WORKDIR: "/workspace",
  PASEO_AUTOSTART: "false",
  PASEO_HOME: "/home/daytona/.paseo",
  PASEO_LISTEN: "0.0.0.0:16767",
  PASEO_HOST: "127.0.0.1:16767",
  PASEO_HOSTNAMES: "localhost,127.0.0.1,.localhost,.proxy.localhost",
  PASEO_RELAY_ENABLED: "true",
  PASEO_MCP_ENABLED: "true",
  PASEO_INJECT_MCP_ENABLED: "true",
} as const;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value !== "");
}

function dropEmptyValues(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry) => entry[1] !== ""));
}

function createVolumeMount(volumeId: string | undefined, mountPath: string): DaytonaVolumeMount[] {
  if (volumeId === undefined || volumeId === "") {
    return [];
  }

  return [{ volumeId, mountPath }];
}

function assertUniqueMountPaths(mounts: DaytonaVolumeMount[]): DaytonaVolumeMount[] {
  const seenMountPaths = new Set<string>();

  for (const mount of mounts) {
    if (seenMountPaths.has(mount.mountPath)) {
      throw new Error(`Duplicate Daytona volume mount path configured: ${mount.mountPath}`);
    }

    seenMountPaths.add(mount.mountPath);
  }

  return mounts;
}

function findUp(fileName: string, startDir: string): string | undefined {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

function resolveSandboxEnvFile(): string | undefined {
  const configuredFile = readEnv("DAYTONA_SANDBOX_ENV_FILE");
  const searchStart =
    readEnv("DAYTONA_SANDBOX_ENV_SEARCH_ROOT") ??
    readEnv("MASTRA_WORKSPACE_ROOT") ??
    process.cwd();

  if (configuredFile !== undefined) {
    const resolvedFile = path.isAbsolute(configuredFile)
      ? configuredFile
      : path.resolve(searchStart, configuredFile);
    if (!existsSync(resolvedFile)) {
      throw new Error(`DAYTONA_SANDBOX_ENV_FILE is configured but does not exist: ${resolvedFile}`);
    }

    return resolvedFile;
  }

  return findUp(".env.sandbox", searchStart);
}

function readSandboxEnvFile(): Record<string, string> {
  const envFile = resolveSandboxEnvFile();
  if (envFile === undefined) {
    return {};
  }

  return dropEmptyValues(Object.fromEntries(
    Object.entries(parseEnv(readFileSync(envFile, "utf8"))).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ));
}

function mirrorGitHubToken(env: Record<string, string>) {
  const githubToken = firstNonEmpty(env.GH_TOKEN, env.GITHUB_TOKEN, env.GITHUB_PERSONAL_ACCESS_TOKEN);
  if (githubToken !== undefined) {
    env.GH_TOKEN ??= githubToken;
    env.GITHUB_TOKEN ??= githubToken;
    env.GITHUB_PERSONAL_ACCESS_TOKEN ??= githubToken;
  }

  const githubHost = firstNonEmpty(env.GH_HOST, env.GITHUB_HOST);
  if (githubHost !== undefined) {
    env.GH_HOST ??= githubHost;
    env.GITHUB_HOST ??= githubHost;
  }
}

export function resolveDaytonaVolumeMounts(): DaytonaVolumeMount[] {
  // Daytona owns volume attachment at sandbox creation time. Per Daytona's
  // Volumes and Sandboxes docs, Mastra only passes volume IDs and desired
  // in-sandbox mount paths to the sandbox create call; Daytona maps each volume
  // to its MinIO/S3 backend storage and exposes the mounted path inside the
  // sandbox. Do not install or invoke mount-s3/libfuse from this app layer.
  return assertUniqueMountPaths([
    ...createVolumeMount(readEnv("DAYTONA_WORKSPACE_VOLUME_ID"), "/workspace"),
    ...createVolumeMount(
      firstNonEmpty(readEnv("DAYTONA_QUANT_VOLUME_ID"), readEnv("DAYTONA_QUANT_DATA_VOLUME_ID")),
      "/shared/volume/quant",
    ),
    ...createVolumeMount(readEnv("DAYTONA_REFERENCES_VOLUME_ID"), "/shared/volume/references"),
    ...createVolumeMount(readEnv("DAYTONA_COMMON_VOLUME_ID"), "/shared/volume/common"),
    ...createVolumeMount(readEnv("DAYTONA_WIKI_VOLUME_ID"), "/shared/volume/wiki"),
  ]);
}

export function resolveSandboxRuntimeEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [name, fallback] of Object.entries(sandboxRuntimeEnv)) {
    env[name] = readEnv(name) ?? fallback;
  }

  return env;
}

export function resolveSandboxCreationEnv(): Record<string, string> {
  const env = {
    ...resolveSandboxRuntimeEnv(),
    ...readSandboxEnvFile(),
  };

  mirrorGitHubToken(env);

  return env;
}
