import { Daytona, type Resources, type VolumeMount } from "@daytona/sdk";
import { DaytonaSandbox, type DaytonaSandboxOptions } from "@mastra/daytona";

import { resolveSandboxCreationEnv } from "./sandbox-config.js";

type DaytonaClient = Daytona;
type DaytonaSandboxInstance = Awaited<ReturnType<DaytonaClient["create"]>>;
type DaytonaCreateParams = NonNullable<Parameters<DaytonaClient["create"]>[0]>;

type DaytonaSandboxInternals = {
  id: string;
  logger: {
    debug: (...args: unknown[]) => void;
  };
  mounts: {
    entries: Map<string, unknown>;
  };
  _daytona: DaytonaClient | null;
  _sandbox: DaytonaSandboxInstance | null;
  _createdAt: Date | null;
  _workingDir: string | null;
  _daytonaSandboxId?: string;
  language: "typescript" | "javascript" | "python";
  labels: Record<string, string>;
  snapshotId?: string;
  image?: string;
  resources?: Resources;
  ephemeral: boolean;
  autoStopInterval?: number;
  autoArchiveInterval?: number;
  autoDeleteInterval?: number;
  volumeConfigs: VolumeMount[];
  sandboxName?: string;
  sandboxUser?: string;
  sandboxPublic?: boolean;
  networkBlockAll?: boolean;
  networkAllowList?: string;
  connectionOpts: ConstructorParameters<typeof Daytona>[0];
  detectWorkingDir(): Promise<void>;
  reconcileMounts(expectedMountPaths: string[]): Promise<void>;
};

const deadStates = new Set(["destroyed", "destroying", "error", "build_failed"]);
const transitionalStates = new Set([
  "starting",
  "stopping",
  "creating",
  "restoring",
  "archiving",
  "resizing",
  "pulling_snapshot",
  "building_snapshot",
]);

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function isNotFoundError(error: unknown) {
  if (error instanceof Error) {
    return /not found/i.test(error.message);
  }

  return /not found/i.test(String(error));
}

function sandboxState(sandbox: { state?: unknown }) {
  return String(sandbox.state ?? "").toLowerCase();
}

async function waitForStableStateAndStart(client: DaytonaClient, sandbox: DaytonaSandboxInstance) {
  const maxWaitMs = 120_000;
  const pollIntervalMs = 2_000;
  const deadline = Date.now() + maxWaitMs;
  let current = sandbox;

  while (transitionalStates.has(sandboxState(current)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    current = await client.get(current.id);
  }

  if (sandboxState(current) === "started") {
    Object.assign(sandbox, current);
    return;
  }

  while (Date.now() < deadline) {
    try {
      await client.start(current);
      Object.assign(sandbox, await client.get(current.id));
      return;
    } catch (error) {
      if (!String(error).includes("State change in progress")) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      current = await client.get(current.id);
      if (sandboxState(current) === "started") {
        Object.assign(sandbox, current);
        return;
      }
    }
  }

  await client.start(current);
  Object.assign(sandbox, await client.get(current.id));
}

export class DaytonaAgentsDaytonaSandbox extends DaytonaSandbox {
  async start() {
    const self = this as unknown as DaytonaSandboxInternals;

    if (self._sandbox) {
      return;
    }

    if (!self._daytona) {
      self._daytona = new Daytona(self.connectionOpts);
    }

    const existing = await this.findExistingSandboxWithCreationEnv(self);
    if (existing) {
      self._sandbox = existing;
      self._daytonaSandboxId = existing.id;
      self._createdAt = existing.createdAt ? new Date(existing.createdAt) : new Date();
      self.logger.debug(`[@mastra/daytona] Reconnected to existing sandbox ${existing.id} for: ${self.id}`);
      await self.reconcileMounts(Array.from(self.mounts.entries.keys()));
      await self.detectWorkingDir();
      return;
    }

    self.logger.debug(`[@mastra/daytona] Creating sandbox for: ${self.id}`);
    const baseParams = compact({
      language: self.language,
      labels: { ...self.labels, "mastra-sandbox-id": self.id },
      envVars: resolveSandboxCreationEnv(),
      ephemeral: self.ephemeral,
      autoStopInterval: self.autoStopInterval,
      autoArchiveInterval: self.autoArchiveInterval,
      autoDeleteInterval: self.autoDeleteInterval,
      volumes: self.volumeConfigs.length > 0 ? self.volumeConfigs : undefined,
      name: self.sandboxName,
      user: self.sandboxUser,
      public: self.sandboxPublic,
      networkBlockAll: self.networkBlockAll,
      networkAllowList: self.networkAllowList,
    });
    const createParams = self.image && !self.snapshotId
      ? compact({
        ...baseParams,
        image: self.image,
        resources: self.resources,
      })
      : compact({
        ...baseParams,
        snapshot: self.snapshotId,
      });

    self._sandbox = await self._daytona.create(createParams as DaytonaCreateParams);
    self._daytonaSandboxId = self._sandbox.id;
    self.logger.debug(`[@mastra/daytona] Created sandbox ${self._sandbox.id} for logical ID: ${self.id}`);
    self._createdAt = new Date();
    await self.detectWorkingDir();
  }

  private async findExistingSandboxWithCreationEnv(self: DaytonaSandboxInternals) {
    const lookupKey = self._daytonaSandboxId ?? self.sandboxName;
    if (!lookupKey || !self._daytona) {
      return null;
    }

    let sandbox: DaytonaSandboxInstance;
    try {
      sandbox = await self._daytona.get(lookupKey);
    } catch (error) {
      if (isNotFoundError(error)) {
        self._daytonaSandboxId = undefined;
        return null;
      }

      throw error;
    }

    const state = sandboxState(sandbox);
    if (deadStates.has(state)) {
      self.logger.debug(`[@mastra/daytona] Existing sandbox ${sandbox.id} is dead (${state}), deleting and creating fresh`);
      try {
        await self._daytona.delete(sandbox);
      } catch {
        // Ignore cleanup errors and let the next create attempt surface any real issue.
      }

      return null;
    }

    if (state !== "started") {
      self.logger.debug(`[@mastra/daytona] Restarting sandbox ${sandbox.id} (state: ${state})`);
      await waitForStableStateAndStart(self._daytona, sandbox);
    }

    return sandbox;
  }
}

export type { DaytonaSandboxOptions };
