import { createHash } from "node:crypto";
import { PI_RESOURCE_PREFIX, PI_THREAD_PREFIX } from "../const.js";

export function defaultResourceId(cwd = process.cwd()): string {
	return `${PI_RESOURCE_PREFIX}:${shortHash(cwd)}`;
}

export function defaultThreadId(agentId: string, cwd = process.cwd()): string {
	return `${PI_THREAD_PREFIX}:${shortHash(`${cwd}:${process.pid}`)}:${agentId}`;
}

export function defaultPiSessionThreadId(params: {
	piSessionId: string;
	jobName: string;
	agentName: string;
	resourceId: string;
}): string {
	return [
		PI_THREAD_PREFIX,
		params.piSessionId,
		params.jobName,
		params.agentName,
		params.resourceId,
	].map(safeIdPart).join("-");
}

export function defaultPiSessionRunId(params: {
	piSessionId: string;
	jobName: string;
	agentName: string;
	resourceId: string;
	jobId: string;
}): string {
	return [
		PI_RESOURCE_PREFIX,
		params.piSessionId,
		params.jobName,
		params.agentName,
		params.resourceId,
		params.jobId,
	].map(safeIdPart).join("-");
}

export function safeIdPart(value: string): string {
	const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	return normalized || "unknown";
}

function shortHash(input: string): string {
	return createHash("sha256").update(input).digest("hex").slice(0, 12);
}
