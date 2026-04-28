import { Daytona, type DaytonaSandboxOptions } from "@daytona/sdk";
import { Logger } from "@mastra/core/logger";

import {
  resolveDaytonaVolumeMounts,
  resolveSandboxCreationEnv,
  resolveSandboxRuntimeEnv,
} from "./sandbox-config.js";

function waitForStableStateAndStart(daytona: Daytona, sandbox: { id: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Sandbox ${sandbox.id} did not reach stable state in time`)),
      300_000,
    );

    const check = async () => {
      try {
        const s = await daytona.get(sandbox.id);
        const state = s.state;

        if (state === "started") {
          clearTimeout(timeout);
          resolve();
        } else if (["stopped", "error", "failed"].includes(state ?? "")) {
          clearTimeout(timeout);
          reject(new Error(`Sandbox ${sandbox.id} entered unexpected state: ${state}`));
        } else {
          setTimeout(check, 2000);
        }
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    };

    setTimeout(check, 2000);
  });
}

function sandboxState(sandbox: { state?: string | null }): string {
  return sandbox.state ?? "unknown";
}

const deadStates = new Set(["stopped", "failed", "error", "unknown"]);

export class DaytonaAgentsDaytonaSandbox {
  private _daytona: Daytona;
  private _options: DaytonaSandboxOptions;
  private logger: Logger;

  constructor(options: DaytonaSandboxOptions) {
    this._options = options;
    this.logger = new Logger({ name: "mastrasystem-daytona-sandbox" });

    if (!options.apiKey) {
      this.logger.warn("DAYTONA_API_KEY not set — Daytona sandbox operations will fail");
    }

    this._daytona = new Daytona({
      apiKey: options.apiKey ?? "",
      apiUrl: options.apiUrl ?? "http://daytona-api:3000/api",
    });
  }

  get id() {
    return this._options.id;
  }

  get started() {
    return this._daytona;
  }

  async getOrCreateSandbox(): Promise<{ id: string }> {
    const id = this._options.id;
    const snapshot = this._options.snapshot;
    const language = this._options.language;
    const apiKey = this._options.apiKey ?? process.env.DAYTONA_API_KEY;

    if (!apiKey) {
      throw new Error("DAYTONA_API_KEY is required to get or create a Daytona sandbox.");
    }

    const daytona = this._daytona;

    let sandbox: { id: string; state?: string | null };

    try {
      sandbox = await daytona.get(id);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("not found") || message.includes("404")) {
        this.logger.debug(`Sandbox ${id} not found, creating from snapshot ${snapshot}`);
        const volumes = resolveDaytonaVolumeMounts();
        sandbox = await daytona.create({
          snapshot,
          language,
          envVars: resolveSandboxCreationEnv(),
          autoStopInterval: this._options.autoStopInterval,
          ephemeral: this._options.ephemeral,
          volumes: volumes.length > 0 ? volumes : undefined,
          labels: this._options.labels,
        });
      } else {
        throw error;
      }
    }

    const state = sandboxState(sandbox);
    if (deadStates.has(state)) {
      this.logger.debug(`Existing sandbox ${sandbox.id} is dead (${state}), deleting and creating fresh`);
      try {
        await daytona.delete(sandbox);
      } catch {
        // Ignore cleanup errors.
      }

      const volumes = resolveDaytonaVolumeMounts();
      sandbox = await daytona.create({
        snapshot,
        language,
        envVars: resolveSandboxCreationEnv(),
        autoStopInterval: this._options.autoStopInterval,
        ephemeral: this._options.ephemeral,
        volumes: volumes.length > 0 ? volumes : undefined,
        labels: this._options.labels,
      });
    }

    if (state !== "started") {
      this.logger.debug(`Restarting sandbox ${sandbox.id} (state: ${state})`);
      await waitForStableStateAndStart(daytona, sandbox);
    }

    return sandbox;
  }
}

export type { DaytonaSandboxOptions };
