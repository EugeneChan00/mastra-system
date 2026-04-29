import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { resolveWorkspacePath } from "../workspace";

const inputArgsSchema = z.record(z.string()).optional();

const piAgentJobInputSchema = z.object({
  jobId: z.string(),
  jobName: z.string(),
  piSessionId: z.string().optional(),
  runId: z.string().optional(),
  agentRunId: z.string().optional(),
  agentId: z.string(),
  message: z.string(),
  threadId: z.string(),
  resourceId: z.string(),
  requestContext: z.record(z.unknown()).optional(),
  includeToolResults: z.boolean().optional(),
  includeReasoning: z.boolean().optional(),
  input_args: inputArgsSchema,
  timeoutMs: z.number().optional(),
});

const piAgentJobOutputSchema = z.object({
  jobId: z.string(),
  jobName: z.string(),
  piSessionId: z.string().optional(),
  runId: z.string().optional(),
  agentRunId: z.string().optional(),
  agentId: z.string(),
  threadId: z.string(),
  resourceId: z.string(),
  status: z.enum(["done", "error"]),
  text: z.string(),
  artifactPath: z.string(),
  eventsPath: z.string(),
  errors: z.array(z.string()),
});

export const runPiAgentJobStep = createStep({
  id: "run-pi-agent-job",
  inputSchema: piAgentJobInputSchema,
  outputSchema: piAgentJobOutputSchema,
  execute: async ({ inputData, mastra, writer, abortSignal }) => {
    const artifactDir = resolveWorkspacePath(
      process.env.MASTRA_PI_AGENT_JOB_DIR ??
        path.join(
          "apps/mastra-control/.mastra/pi-agent-jobs",
          safePathPart(inputData.piSessionId ?? "local-session"),
          safePathPart(inputData.jobId),
        ),
    );
    await mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, "output.txt");
    const eventsPath = path.join(artifactDir, "events.jsonl");
    const errors: string[] = [];
    let text = "";

    try {
      const agent = resolveAgent(mastra, inputData.agentId);
      const requestContext = {
        ...(inputData.requestContext ?? {}),
        ...(inputData.input_args && Object.keys(inputData.input_args).length > 0 ? { input_args: inputData.input_args } : {}),
      };
      const streamResult = await agent.stream(formatPrompt(inputData.message, inputData.input_args), {
        runId: inputData.agentRunId ?? inputData.runId ?? inputData.jobId,
        memory: {
          thread: inputData.threadId,
          resource: inputData.resourceId,
        },
        requestContext,
        abortSignal,
      });

      for await (const chunk of streamResult.fullStream as AsyncIterable<unknown>) {
        await writer.write(chunk);
        await appendJsonLine(eventsPath, { timestamp: Date.now(), chunk });
        const delta = textDelta(chunk);
        if (delta) {
          text += delta;
          await appendFile(artifactPath, delta, "utf8");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      const chunk = { type: "error", payload: { message }, message };
      await writer.write(chunk);
      await appendJsonLine(eventsPath, { timestamp: Date.now(), chunk });
      await appendFile(artifactPath, `\n[agent job error: ${message}]\n`, "utf8");
      return {
        jobId: inputData.jobId,
        jobName: inputData.jobName,
        piSessionId: inputData.piSessionId,
        runId: inputData.runId,
        agentRunId: inputData.agentRunId,
        agentId: inputData.agentId,
        threadId: inputData.threadId,
        resourceId: inputData.resourceId,
        status: "error" as const,
        text,
        artifactPath,
        eventsPath,
        errors,
      };
    }

    return {
      jobId: inputData.jobId,
      jobName: inputData.jobName,
      piSessionId: inputData.piSessionId,
      runId: inputData.runId,
      agentRunId: inputData.agentRunId,
      agentId: inputData.agentId,
      threadId: inputData.threadId,
      resourceId: inputData.resourceId,
      status: "done" as const,
      text,
      artifactPath,
      eventsPath,
      errors,
    };
  },
});

const piAgentJobWorkflow = createWorkflow({
  id: "pi.agent-job",
  description: "Durable Pi session background Mastra agent job runner.",
  inputSchema: piAgentJobInputSchema,
  outputSchema: piAgentJobOutputSchema,
})
  .then(runPiAgentJobStep)
  .commit();

export const piAgentJobWorkflows = {
  piAgentJob: piAgentJobWorkflow,
};

function resolveAgent(mastra: any, agentId: string): any {
  if (typeof mastra.getAgentById === "function") {
    try {
      return mastra.getAgentById(agentId);
    } catch {
      // Fall through to getAgent, which supports registry keys.
    }
  }
  return mastra.getAgent(agentId);
}

function formatPrompt(message: string, inputArgs: Record<string, string> | undefined): string {
  if (!inputArgs || Object.keys(inputArgs).length === 0) return message;
  const keys = Object.keys(inputArgs).sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
  const lines = keys.map((key) => `- ${key}: ${inputArgs[key]}`);
  return `${message}\n\nInput arguments:\n${lines.join("\n")}\n\nWhen the prompt references placeholders like $1, $2, etc., use the corresponding input argument above.`;
}

function textDelta(chunk: unknown): string {
  if (!isRecord(chunk)) return "";
  if (typeof chunk.text === "string") return chunk.text;
  if (typeof chunk.delta === "string") return chunk.delta;
  if (isRecord(chunk.payload) && typeof chunk.payload.text === "string") return chunk.payload.text;
  return "";
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8").catch(() => undefined);
}

function safePathPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
