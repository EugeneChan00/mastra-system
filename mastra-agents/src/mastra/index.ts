import { Mastra } from "@mastra/core/mastra";
import { SpanType } from "@mastra/core/observability";
import { FilesystemStore, MastraCompositeStore } from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { MastraEditor } from "@mastra/editor";
import {
  DefaultExporter,
  Observability,
  SensitiveDataFilter,
} from "@mastra/observability";
import { PostgresStore } from "@mastra/pg";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { mastraAgents } from "../agents/agent";
import { controlAgentScorers } from "../scorers/control-agent";
import { daytonaWorkflows } from "../workflows/daytona";
import { workspaceWorkflows } from "../workflows/workspace";
import { resolveWorkspacePath, workspace } from "../workspace";

const postgresStorage = new PostgresStore({
  id: "mastra-control-storage",
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://mastra:mastra@mastra-postgres:5432/mastra",
});
const observabilityDuckDBPath = resolveWorkspacePath(
  process.env.MASTRA_OBSERVABILITY_DUCKDB_PATH ??
    "apps/mastra-control/.mastra/observability.duckdb",
);
const editorStoragePath = resolveWorkspacePath(
  process.env.MASTRA_EDITOR_STORAGE_DIR ?? "apps/mastra-control/.mastra/editor",
);
mkdirSync(path.dirname(observabilityDuckDBPath), { recursive: true });
mkdirSync(editorStoragePath, { recursive: true });
const observabilityStorage = new DuckDBStore({
  id: "mastra-observability-storage",
  path: observabilityDuckDBPath,
});
const editorStorage = new FilesystemStore({
  dir: editorStoragePath,
});
const storage = new MastraCompositeStore({
  id: "mastra-control-composite-storage",
  default: postgresStorage,
  editor: editorStorage,
  domains: {
    observability: observabilityStorage.observability,
  },
});
const editor = new MastraEditor();

const serverPort = Number(process.env.PORT ?? "4111");
const studioPort = Number(
  process.env.MASTRA_SERVER_STUDIO_PORT ?? process.env.PORT ?? "4111",
);
const studioProtocol =
  process.env.MASTRA_SERVER_STUDIO_PROTOCOL === "https" ? "https" : "http";

export const mastra = new Mastra({
  agents: mastraAgents,
  workflows: {
    ...daytonaWorkflows,
    ...workspaceWorkflows,
  },
  scorers: controlAgentScorers,
  storage,
  editor,
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra-control",
        exporters: [new DefaultExporter({ strategy: "auto" })],
        logging: {
          enabled: true,
          level: "debug",
        },
        spanOutputProcessors: [
          new SensitiveDataFilter({
            sensitiveFields: [
              "password",
              "token",
              "secret",
              "key",
              "apikey",
              "authorization",
              "bearer",
              "credential",
              "clientsecret",
              "privatekey",
              "refresh",
              "ssn",
              "OPENAI_API_KEY",
              "ANTHROPIC_API_KEY",
              "ANTHROPIC_AUTH_TOKEN",
              "MINIMAX_API_KEY",
              "GOOGLE_GENERATIVE_AI_API_KEY",
              "GOOGLE_API_KEY",
              "GEMINI_API_KEY",
              "DEEPSEEK_API_KEY",
              "CEREBRAS_API_KEY",
              "TAVILY_API_KEY",
              "MASTRA_OPENAI_API_KEY",
              "MASTRA_ANTHROPIC_API_KEY",
              "MASTRA_MINIMAX_API_KEY",
              "CLI_PROXY_API_KEY",
              "CLI_PROXY_STACK_API_KEY",
              "GH_TOKEN",
              "GITHUB_TOKEN",
              "GITHUB_PERSONAL_ACCESS_TOKEN",
              "DAYTONA_API_KEY",
              "DAYTONA_PROXY_API_KEY",
              "DAYTONA_SSH_GATEWAY_API_KEY",
            ],
          }),
        ],
        excludeSpanTypes: [SpanType.MODEL_CHUNK],
      },
    },
  }),
  workspace,
  server: {
    host: process.env.MASTRA_SERVER_HOST ?? "0.0.0.0",
    port: serverPort,
    studioHost: process.env.MASTRA_SERVER_STUDIO_HOST ?? "localhost",
    studioProtocol,
    studioPort,
    cors: {
      origin: [
        `http://localhost:${process.env.MASTRA_STUDIO_PORT ?? "4112"}`,
        `http://127.0.0.1:${process.env.MASTRA_STUDIO_PORT ?? "4112"}`,
      ],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "x-mastra-client-type",
        "x-mastra-dev-playground",
      ],
      exposeHeaders: ["Content-Length", "X-Requested-With"],
      credentials: true,
    },
  },
});
