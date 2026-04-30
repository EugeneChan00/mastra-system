import { DEFAULT_DETAILS_TEXT_LIMIT, DEFAULT_TOOL_EVENT_LIMIT } from "../const.js";
import type {
	MastraAgentCallDetails,
	MastraToolEvent,
	MastraUsage,
	NormalizedMastraEvent,
	TruncatedText,
} from "./types.js";

const TOOL_INPUT_START = "tool-call-input-streaming-start";
const TOOL_INPUT_DELTA = "tool-call-delta";
const TOOL_INPUT_END = "tool-call-input-streaming-end";

export function normalizeMastraChunk(chunk: unknown): NormalizedMastraEvent {
	if (!isRecord(chunk)) return { kind: "unknown", raw: chunk };

	const type = stringValue(chunk.type);
	switch (type) {
		case "text-delta":
			return { kind: "text-delta", text: textFrom(chunk, "text", "delta", "textDelta"), raw: chunk };
		case "reasoning-delta":
		case "reasoning":
			return { kind: "reasoning-delta", text: textFrom(chunk, "text", "delta", "textDelta", "reasoning"), raw: chunk };
		case "tool-call":
			return { kind: "tool", event: makeToolEvent("call", chunk) };
		case "tool-result":
			return { kind: "tool", event: makeToolEvent("result", chunk) };
		case "tool-error":
			return { kind: "tool", event: makeToolEvent("error", chunk) };
		case TOOL_INPUT_START:
			return { kind: "tool", event: makeToolEvent("input-start", chunk) };
		case TOOL_INPUT_DELTA:
			return { kind: "tool", event: makeToolEvent("input-delta", chunk) };
		case TOOL_INPUT_END:
			return { kind: "tool", event: makeToolEvent("input-end", chunk) };
		case "finish":
			return { kind: "finish", usage: usageFrom(chunk), raw: chunk };
		case "error":
			return { kind: "error", message: textFrom(chunk, "message", "error", "text") || "Mastra stream error", raw: chunk };
		default:
			return { kind: "unknown", raw: chunk };
	}
}

export function applyNormalizedEvent(details: MastraAgentCallDetails, event: NormalizedMastraEvent): void {
	details.rawChunkCount += 1;
	details.updatedAt = Date.now();

	if (event.kind === "text-delta") {
		details.text = boundedAppend(details.text, event.text, DEFAULT_DETAILS_TEXT_LIMIT);
		return;
	}

	if (event.kind === "reasoning-delta") {
		details.reasoning = boundedAppend(details.reasoning ?? "", event.text, DEFAULT_DETAILS_TEXT_LIMIT);
		return;
	}

	if (event.kind === "tool") {
		if (event.event.type === "result" || event.event.type === "error") {
			pushBounded(details.toolResults, event.event, DEFAULT_TOOL_EVENT_LIMIT);
		} else {
			pushBounded(details.toolCalls, event.event, DEFAULT_TOOL_EVENT_LIMIT);
		}
		return;
	}

	if (event.kind === "finish") {
		details.status = "done";
		details.completedAt = details.updatedAt;
		details.terminalReason = "finish";
		details.incomplete = false;
		if (event.usage) details.usage = event.usage;
		return;
	}

	if (event.kind === "error") {
		details.status = "error";
		details.completedAt = details.updatedAt;
		details.terminalReason = "error";
		details.incomplete = false;
		details.errors.push(event.message);
	}
}

export function truncateText(text: string, limit: number): TruncatedText {
	if (text.length <= limit) {
		return { text, truncated: false, originalLength: text.length };
	}
	const marker = `\n\n[truncated ${text.length - limit} chars]`;
	const sliceLength = Math.max(0, limit - marker.length);
	return {
		text: `${text.slice(0, sliceLength)}${marker}`,
		truncated: true,
		originalLength: text.length,
	};
}

function makeToolEvent(type: MastraToolEvent["type"], chunk: Record<string, unknown>): MastraToolEvent {
	const source = isRecord(chunk.payload) ? chunk.payload : chunk;
	return {
		id: stringValue(source.toolCallId) ?? stringValue(source.id),
		name: stringValue(source.toolName) ?? stringValue(source.toolNameId) ?? stringValue(source.name),
		type,
		args: source.args ?? source.input ?? source.arguments ?? source.argsTextDelta,
		result: source.result ?? source.output,
		error: source.error,
		timestamp: Date.now(),
		raw: chunk,
	};
}

function usageFrom(chunk: Record<string, unknown>): MastraUsage | undefined {
	const usage = chunk.usage ?? (isRecord(chunk.payload) ? chunk.payload.usage : undefined);
	return isRecord(usage) ? (usage as MastraUsage) : undefined;
}

function textFrom(chunk: Record<string, unknown>, ...keys: string[]): string {
	for (const key of keys) {
		const value = chunk[key];
		if (typeof value === "string") return value;
		if (isRecord(value)) {
			if (typeof value.text === "string") return value.text;
			if (typeof value.delta === "string") return value.delta;
			if (typeof value.textDelta === "string") return value.textDelta;
		}
	}
	if (isRecord(chunk.payload)) {
		return textFrom(chunk.payload, ...keys);
	}
	return "";
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedAppend(current: string, next: string, limit: number): string {
	const combined = current + next;
	if (combined.length <= limit) return combined;
	return combined.slice(combined.length - limit);
}

function pushBounded<T>(array: T[], value: T, limit: number): void {
	array.push(value);
	if (array.length > limit) array.splice(0, array.length - limit);
}
