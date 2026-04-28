import { Daytona } from "@daytona/sdk";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  resolveDaytonaVolumeMounts,
  resolveSandboxCreationEnv,
} from "../../daytona/sandbox-config.js";

const defaultSnapshot =
  process.env.MASTRA_DEFAULT_SNAPSHOT ??
  "daytona-agents/snapshot-coding-base:local";

const defaultTarget = process.env.DAYTONA_TARGET ?? "us";
const defaultApiUrl = process.env.DAYTONA_API_URL ?? "http://daytona-api:3000/api";

function getDaytonaClient() {
  const apiKey = process.env.DAYTONA_API_KEY;

  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY is required for Daytona control-plane tools.");
  }

  return new Daytona({
    apiKey,
    apiUrl: defaultApiUrl,
    target: defaultTarget,
  });
}

const checkApiQuerySchema = z.object({
  path: z.string().default("/health"),
  includeBody: z.boolean().default(true),
});

const checkApiResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().nullable(),
  url: z.string(),
  target: z.string(),
  body: z.string().optional(),
});

const createCodingSandboxQuerySchema = z.object({
  snapshot: z.string().default(defaultSnapshot),
  language: z.enum(["typescript", "javascript", "python"]).default("typescript"),
  autoStopInterval: z.number().int().min(0).max(1440).default(30),
  ephemeral: z.boolean().default(false),
});

const createCodingSandboxResultSchema = z.object({
  id: z.string(),
  snapshot: z.string(),
  language: z.string(),
  target: z.string().nullable(),
  ephemeral: z.boolean(),
  volumes: z.array(
    z.object({
      volumeId: z.string(),
      mountPath: z.string(),
    }),
  ),
});

const listSandboxesQuerySchema = z.object({
  labels: z.record(z.string(), z.string()).default({}),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

const listSandboxesResultSchema = z.object({
  count: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  sandboxes: z.array(
    z.object({
      id: z.string(),
      state: z.string().nullable(),
      snapshot: z.string().nullable(),
    }),
  ),
});

export const daytonaSchemas = {
  checkApiQuery: checkApiQuerySchema,
  checkApiResult: checkApiResultSchema,
  createCodingSandboxQuery: createCodingSandboxQuerySchema,
  createCodingSandboxResult: createCodingSandboxResultSchema,
  listSandboxesQuery: listSandboxesQuerySchema,
  listSandboxesResult: listSandboxesResultSchema,
};

export const daytonaTools = {
  checkApi: createTool({
    id: "daytona.check-api",
    description:
      "Query reachability of the Daytona control-plane API through a specific API path.",
    inputSchema: checkApiQuerySchema,
    outputSchema: checkApiResultSchema,
    execute: async (query) => {
      const path = query.path ?? "/health";
      const includeBody = query.includeBody ?? true;
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const url = `${defaultApiUrl.replace(/\/$/, "")}${normalizedPath}`;

      try {
        const response = await fetch(url, {
          headers: {
            ...(process.env.DAYTONA_API_KEY
              ? { Authorization: `Bearer ${process.env.DAYTONA_API_KEY}` }
              : {}),
          },
        });

        const body = includeBody ? await response.text() : undefined;

        return {
          ok: response.ok,
          status: response.status,
          url,
          target: defaultTarget,
          body,
        };
      } catch (error) {
        return {
          ok: false,
          status: null,
          url,
          target: defaultTarget,
          body: error instanceof Error ? error.message : String(error),
        };
      }
    },
  }),

  createCodingSandbox: createTool({
    id: "daytona.create-coding-sandbox",
    description:
      "Create a Daytona coding sandbox from the configured snapshot using a typed sandbox query.",
    inputSchema: createCodingSandboxQuerySchema,
    outputSchema: createCodingSandboxResultSchema,
    execute: async (query) => {
      const snapshot = query.snapshot ?? defaultSnapshot;
      const language = query.language ?? "typescript";
      const autoStopInterval = query.autoStopInterval ?? 30;
      const ephemeral = query.ephemeral ?? false;
      const volumes = resolveDaytonaVolumeMounts();
      const daytona = getDaytonaClient();
      const sandbox = await daytona.create({
        snapshot,
        language,
        envVars: resolveSandboxCreationEnv(),
        autoStopInterval,
        ephemeral,
        volumes: volumes.length > 0 ? volumes : undefined,
      });

      return {
        id: sandbox.id,
        snapshot,
        language,
        target: process.env.DAYTONA_TARGET ?? null,
        ephemeral,
        volumes,
      };
    },
  }),

  listSandboxes: createTool({
    id: "daytona.list-sandboxes",
    description:
      "List Daytona sandboxes using a typed query for labels and pagination.",
    inputSchema: listSandboxesQuerySchema,
    outputSchema: listSandboxesResultSchema,
    execute: async (query) => {
      const labelsQuery = query.labels ?? {};
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const daytona = getDaytonaClient();
      const labels = Object.keys(labelsQuery).length > 0 ? labelsQuery : undefined;
      const sandboxes = await daytona.list(labels, page, limit);

      return {
        count: sandboxes.items.length,
        page,
        limit,
        sandboxes: sandboxes.items.map((sandbox) => ({
          id: sandbox.id,
          state: "state" in sandbox ? String(sandbox.state ?? "") : null,
          snapshot: "snapshot" in sandbox ? String(sandbox.snapshot ?? "") : null,
        })),
      };
    },
  }),
};
