import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { MastraAgentsWidgetOptions } from "../tui/index.js";

export const MASTRA_AGENT_EXTENSION_CONFIG_KEY = "mastra-agent-extension";
export const DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS: Required<Pick<MastraAgentsWidgetOptions, "maxCards" | "maxLines">> = {
	maxCards: 4,
	maxLines: 60,
};

export interface MastraAgentExtensionConfigResult {
	options: MastraAgentsWidgetOptions;
	warning?: string;
	path: string;
	found: boolean;
}

export async function loadMastraAgentExtensionConfig(cwd: string): Promise<MastraAgentExtensionConfigResult> {
	const path = join(cwd, "config.yaml");
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return { options: { ...DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS }, path, found: false };
		}
		return {
			options: { ...DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS },
			path,
			found: false,
			warning: `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	let parsed: unknown;
	try {
		parsed = parse(raw);
	} catch (error) {
		return {
			options: { ...DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS },
			path,
			found: true,
			warning: `Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const section = isRecord(parsed) ? parsed[MASTRA_AGENT_EXTENSION_CONFIG_KEY] : undefined;
	if (section === undefined) return { options: { ...DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS }, path, found: true };
	if (!isRecord(section)) {
		return {
			options: { ...DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS },
			path,
			found: true,
			warning: `${MASTRA_AGENT_EXTENSION_CONFIG_KEY} in ${path} must be a mapping`,
		};
	}

	const warnings: string[] = [];
	const maxCards = readPositiveInteger(section.maxCards, "maxCards", warnings);
	const maxLines = readPositiveInteger(section.maxLines, "maxLines", warnings);
	return {
		options: {
			maxCards: maxCards ?? DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.maxCards,
			maxLines: maxLines ?? DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.maxLines,
		},
		path,
		found: true,
		warning: warnings.length > 0 ? `Ignoring invalid ${MASTRA_AGENT_EXTENSION_CONFIG_KEY} values in ${path}: ${warnings.join(", ")}` : undefined,
	};
}

function readPositiveInteger(value: unknown, name: string, warnings: string[]): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
	warnings.push(name);
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
