export interface MastraAgentInfo {
	id: string;
	name?: string;
	description?: string;
	[key: string]: unknown;
}

export type MastraAgentsResponse = Record<string, MastraAgentInfo>;

export interface MastraAgentCallInput {
	agentId: string;
	message: string;
	modeId?: string;
	threadId?: string;
	resourceId?: string;
	maxSteps?: number;
	activeTools?: string[];
	requestContext?: Record<string, unknown>;
	includeToolResults?: boolean;
	includeReasoning?: boolean;
	timeoutMs?: number;
}

export interface MastraStreamRequest {
	messages: Array<{
		role: "user";
		content: string;
	}>;
	memory: {
		thread: string;
		resource: string;
	};
	maxSteps?: number;
	activeTools?: string[];
	requestContext?: Record<string, unknown>;
}

export type MastraStreamStatus = "running" | "done" | "error" | "aborted";

export interface MastraToolEvent {
	id?: string;
	name?: string;
	type: "input-start" | "input-delta" | "input-end" | "call" | "result" | "error";
	args?: unknown;
	result?: unknown;
	error?: unknown;
	timestamp: number;
	raw: unknown;
}

export interface MastraUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	[key: string]: unknown;
}

export interface MastraAgentCallDetails {
	agentId: string;
	modeId?: string;
	threadId: string;
	resourceId: string;
	status: MastraStreamStatus;
	text: string;
	reasoning?: string;
	toolCalls: MastraToolEvent[];
	toolResults: MastraToolEvent[];
	usage?: MastraUsage;
	chunksTruncated: boolean;
	errors: string[];
	rawChunkCount: number;
}

export type NormalizedMastraEvent =
	| { kind: "text-delta"; text: string; raw: unknown }
	| { kind: "reasoning-delta"; text: string; raw: unknown }
	| { kind: "tool"; event: MastraToolEvent }
	| { kind: "finish"; usage?: MastraUsage; raw: unknown }
	| { kind: "error"; message: string; raw: unknown }
	| { kind: "unknown"; raw: unknown };

export interface TruncatedText {
	text: string;
	truncated: boolean;
	originalLength: number;
}

