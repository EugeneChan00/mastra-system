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
	input_args?: MastraAgentInputArgs;
}

/** Key-value pairs for prompt placeholder substitution. Keys must match ^\$[1-9][0-9]*$ */
export type MastraAgentInputArgs = Record<string, string>;

export interface MastraAgentStatusInput {
	agentId: string;
}

export interface MastraAgentInspectInput {
	agentId?: string;
	agentIds?: string[];
	agents?: string;
	includeInstructions?: boolean;
}

export interface MastraAgentToolSchema {
	id: string;
	name?: string;
	description?: string;
	inputSchema?: unknown;
	outputSchema?: unknown;
	parameters?: unknown;
	raw?: unknown;
}

export interface MastraAgentInspection {
	id: string;
	name?: string;
	description?: string;
	instructions?: string;
	tools: MastraAgentToolSchema[];
	modes: unknown[];
	modesSource: "agent" | "not_exposed";
	workspace?: unknown;
	workspaceId?: string;
	workspaceTools?: unknown;
	memory?: unknown;
	raw: MastraAgentInfo;
}

export interface MastraAgentInspectDetails {
	agents: MastraAgentInspection[];
	count: number;
	errors: Array<{ agentId: string; error: string }>;
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
	input_args?: MastraAgentInputArgs;
}

export interface MastraWorkflowStepInfo {
	id: string;
	description?: string;
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface MastraWorkflowInfo {
	name?: string;
	description?: string;
	steps?: Record<string, MastraWorkflowStepInfo>;
	allSteps?: Record<string, MastraWorkflowStepInfo>;
	stepGraph?: Array<Record<string, unknown>>;
	inputSchema?: string;
	outputSchema?: string;
	stateSchema?: string;
	[key: string]: unknown;
}

export type MastraWorkflowsResponse = Record<string, MastraWorkflowInfo>;

export interface MastraWorkflowCallInput {
	workflowId: string;
	runId: string;
	inputData?: unknown;
	initialState?: unknown;
	resourceId?: string;
	requestContext?: Record<string, unknown>;
	perStep?: boolean;
	closeOnSuspend?: boolean;
	timeoutMs?: number;
}

export interface MastraWorkflowStreamRequest {
	inputData?: unknown;
	initialState?: unknown;
	resourceId?: string;
	requestContext?: Record<string, unknown>;
	perStep?: boolean;
	closeOnSuspend?: boolean;
}

export interface MastraWorkflowStatusInput {
	workflowId: string;
	runId: string;
	fields?: string[];
	withNestedWorkflows?: boolean;
}

export type MastraWorkflowRunStatus =
	| "running"
	| "waiting"
	| "suspended"
	| "success"
	| "failed"
	| "canceled"
	| "pending"
	| "bailed"
	| "tripwire"
	| "paused"
	| string;

export interface MastraWorkflowRun {
	runId: string;
	workflowName: string;
	resourceId?: string;
	createdAt?: string;
	updatedAt?: string;
	status: MastraWorkflowRunStatus;
	initialState?: unknown;
	result?: unknown;
	error?: unknown;
	payload?: unknown;
	steps?: Record<string, unknown>;
	activeStepsPath?: Record<string, number[]>;
	serializedStepGraph?: Array<Record<string, unknown>>;
	[key: string]: unknown;
}

export interface MastraWorkflowCallDetails {
	workflowId: string;
	runId: string;
	resourceId?: string;
	status: MastraStreamStatus;
	workflowStatus?: MastraWorkflowRunStatus;
	events: unknown[];
	finalEvent?: unknown;
	result?: unknown;
	error?: unknown;
	rawChunkCount: number;
	chunksTruncated: boolean;
	errors: string[];
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
	prompt?: string;
	threadId: string;
	resourceId: string;
	status: MastraStreamStatus;
	startedAt?: number;
	updatedAt?: number;
	completedAt?: number;
	text: string;
	reasoning?: string;
	toolCalls: MastraToolEvent[];
	toolResults: MastraToolEvent[];
	usage?: MastraUsage;
	chunksTruncated: boolean;
	errors: string[];
	rawChunkCount: number;
}

export interface MastraAgentStartInput extends MastraAgentCallInput {
	jobId?: string;
	finalMessage?: boolean;
}

export interface MastraAgentQueryInput {
	agentId: string;
	message: string;
	synchronous?: boolean;
	threadId?: string;
	resourceId?: string;
	requestContext?: Record<string, unknown>;
	includeToolResults?: boolean;
	includeReasoning?: boolean;
	timeoutMs?: number;
	input_args?: MastraAgentInputArgs;
}

export interface MastraAgentAsyncStatusInput {
	jobId?: string;
}

export interface MastraAgentReadInput {
	jobId: string;
	mode?: "summary" | "tail" | "full" | string;
	maxChars?: number;
}

export interface MastraAgentCancelInput {
	jobId: string;
	reason?: string;
}

export interface MastraAgentAsyncJobSummary {
	jobId: string;
	agentId: string;
	modeId?: string;
	threadId: string;
	resourceId: string;
	status: MastraStreamStatus;
	startedAt?: number;
	updatedAt?: number;
	completedAt?: number;
	elapsedMs?: number;
	prompt?: string;
	textPreview: string;
	reasoningPreview?: string;
	toolCalls: number;
	toolResults: number;
	usage?: MastraUsage;
	rawChunkCount: number;
	chunksTruncated: boolean;
	errors: string[];
	artifactPath?: string;
	eventsPath?: string;
}

export interface MastraAgentAsyncJobDetails extends MastraAgentAsyncJobSummary {
	details: MastraAgentCallDetails;
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
