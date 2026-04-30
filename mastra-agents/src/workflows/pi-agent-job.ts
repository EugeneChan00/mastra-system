import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from "@mastra/core/request-context";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  createMastraAgentHarness,
  REQUEST_CONTEXT_HARDNESS_MODE_KEY,
  resolveMastraAgentHarnessModeId,
} from "../agents/harness.js";
import { resolveWorkspacePath } from "../workspace.js";

const inputArgsSchema = z.record(z.string()).optional();

const piAgentJobInputSchema = z.object({
  jobId: z.string(),
  jobName: z.string(),
  piSessionId: z.string().optional(),
  runId: z.string().optional(),
  agentRunId: z.string().optional(),
  agentId: z.string(),
  hardnessMode: z.string().optional(),
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
  hardnessMode: z.string().optional(),
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
    let resolvedHardnessMode = inputData.hardnessMode;

    try {
      const harness = resolveHarness(mastra);
      const hardnessMode = resolveMastraAgentHarnessModeId({
        agentId: inputData.agentId,
        hardnessMode: inputData.hardnessMode,
      });
      resolvedHardnessMode = hardnessMode;
      const requestContext = {
        ...(inputData.requestContext ?? {}),
        [REQUEST_CONTEXT_HARDNESS_MODE_KEY]: hardnessMode,
        ...(inputData.input_args && Object.keys(inputData.input_args).length > 0 ? { input_args: inputData.input_args } : {}),
      };
      text = await streamHarnessMessage({
        harness,
        writer,
        artifactPath,
        eventsPath,
        message: formatPrompt(inputData.message, inputData.input_args),
        threadId: inputData.threadId,
        resourceId: inputData.resourceId,
        hardnessMode,
        requestContext,
        abortSignal,
      });
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
        hardnessMode: resolvedHardnessMode,
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
      hardnessMode: resolvedHardnessMode,
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

function formatPrompt(message: string, inputArgs: Record<string, string> | undefined): string {
  if (!inputArgs || Object.keys(inputArgs).length === 0) return message;
  const keys = Object.keys(inputArgs).sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
  const lines = keys.map((key) => `- ${key}: ${inputArgs[key]}`);
  return `${message}\n\nInput arguments:\n${lines.join("\n")}\n\nWhen the prompt references placeholders like $1, $2, etc., use the corresponding input argument above.`;
}

function resolveHarness(mastra: any): ReturnType<typeof createMastraAgentHarness> {
  if (typeof mastra?.getHarness === "function") {
    return mastra.getHarness();
  }
  if (mastra?.mastraAgentHarness) {
    return mastra.mastraAgentHarness;
  }
  return createMastraAgentHarness();
}

async function streamHarnessMessage({
  harness,
  writer,
  artifactPath,
  eventsPath,
  message,
  threadId,
  resourceId,
  hardnessMode,
  requestContext,
  abortSignal,
}: {
  harness: ReturnType<typeof createMastraAgentHarness>;
  writer: { write(chunk: unknown): Promise<void> };
  artifactPath: string;
  eventsPath: string;
  message: string;
  threadId: string;
  resourceId: string;
  hardnessMode: string;
  requestContext: Record<string, unknown>;
  abortSignal?: AbortSignal;
}): Promise<string> {
  let text = "";
  let lastMessageText = "";
  let lastReasoningText = "";
  let writeQueue = Promise.resolve();

  const emitChunk = (chunk: unknown) => {
    writeQueue = writeQueue.then(async () => {
      await writer.write(chunk);
      await appendJsonLine(eventsPath, { timestamp: Date.now(), chunk });
      const delta = textDelta(chunk);
      if (delta) {
        text += delta;
        await appendFile(artifactPath, delta, "utf8");
      }
    });
  };

  const unsubscribe = harness.subscribe((event: any) => {
    if (event.type === "message_update" || event.type === "message_end") {
      const nextText = harnessTextContent(event.message, "text");
      const textDeltaValue = incrementalDelta(lastMessageText, nextText);
      lastMessageText = nextText;
      if (textDeltaValue) emitChunk({ type: "text-delta", text: textDeltaValue });

      const nextReasoning = harnessTextContent(event.message, "thinking");
      const reasoningDelta = incrementalDelta(lastReasoningText, nextReasoning);
      lastReasoningText = nextReasoning;
      if (reasoningDelta) emitChunk({ type: "reasoning-delta", text: reasoningDelta });
      return;
    }

    if (event.type === "tool_input_start") {
      emitChunk({
        type: "tool-call-input-streaming-start",
        payload: { toolCallId: event.toolCallId, toolName: event.toolName },
      });
      return;
    }

    if (event.type === "tool_input_delta") {
      emitChunk({
        type: "tool-call-delta",
        payload: { toolCallId: event.toolCallId, toolName: event.toolName, argsTextDelta: event.argsTextDelta },
      });
      return;
    }

    if (event.type === "tool_input_end") {
      emitChunk({
        type: "tool-call-input-streaming-end",
        payload: { toolCallId: event.toolCallId },
      });
      return;
    }

    if (event.type === "tool_start") {
      emitChunk({
        type: "tool-call",
        payload: { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args },
      });
      return;
    }

    if (event.type === "tool_end") {
      emitChunk({
        type: event.isError ? "tool-error" : "tool-result",
        payload: { toolCallId: event.toolCallId, result: event.result, error: event.isError ? event.result : undefined },
      });
      return;
    }

    if (event.type === "error") {
      emitChunk({
        type: "error",
        message: event.error instanceof Error ? event.error.message : String(event.error ?? "Harness error"),
      });
    }
  });

  const onAbort = () => harness.abort();
  abortSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    await harness.init();
    harness.setResourceId({ resourceId });
    await harness.switchThread({ threadId });
    if (harness.getCurrentModeId() !== hardnessMode) {
      await harness.switchMode({ modeId: hardnessMode });
    }
    await harness.setState({ hardnessMode });
    const mastraRequestContext = requestContextFromRecord(requestContext, threadId, resourceId);
    await harness.sendMessage({
      content: message,
      requestContext: mastraRequestContext,
    });
    emitChunk({ type: "finish", payload: { hardnessMode } });
    await writeQueue;
    return text;
  } finally {
    await writeQueue;
    abortSignal?.removeEventListener("abort", onAbort);
    unsubscribe();
  }
}

function requestContextFromRecord(
  values: Record<string, unknown>,
  threadId: string,
  resourceId: string,
): RequestContext {
  const context = new RequestContext<unknown>();
  for (const [key, value] of Object.entries(values)) {
    context.set(key, value);
  }
  context.set(MASTRA_THREAD_ID_KEY, threadId);
  context.set(MASTRA_RESOURCE_ID_KEY, resourceId);
  return context;
}

function harnessTextContent(message: unknown, kind: "text" | "thinking"): string {
  if (!isRecord(message) || !Array.isArray(message.content)) return "";
  return message.content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (kind === "text" && part.type === "text" && typeof part.text === "string") return part.text;
      if (kind === "thinking" && part.type === "thinking" && typeof part.thinking === "string") return part.thinking;
      return "";
    })
    .join("");
}

function incrementalDelta(previous: string, next: string): string {
  if (!next) return "";
  return next.startsWith(previous) ? next.slice(previous.length) : next;
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
