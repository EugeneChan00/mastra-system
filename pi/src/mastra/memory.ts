import { createHash } from "node:crypto";
import { PI_RESOURCE_PREFIX, PI_THREAD_PREFIX } from "../const.js";

export function defaultResourceId(cwd = process.cwd()): string {
	return `${PI_RESOURCE_PREFIX}:${shortHash(cwd)}`;
}

export function defaultThreadId(agentId: string, cwd = process.cwd()): string {
	return `${PI_THREAD_PREFIX}:${shortHash(`${cwd}:${process.pid}`)}:${agentId}`;
}

function shortHash(input: string): string {
	return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

