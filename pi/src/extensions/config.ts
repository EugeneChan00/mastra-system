import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { MastraAgentsViewMode, MastraAgentsWidgetOptions } from "../tui/index.js";

export const MASTRA_AGENT_EXTENSION_CONFIG_KEY = "mastra-agent-extension";
export const DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS: Required<Pick<MastraAgentsWidgetOptions, "maxCards" | "maxLines">> = {
	maxCards: 4,
	maxLines: 60,
};
export const DEFAULT_MASTRA_AGENT_VIEW_MODE: MastraAgentsViewMode = "list";
export const DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS: MastraAgentExtensionShortcuts = {
	viewMode: "ctrl+h",
	nextAgent: "ctrl+down",
	previousAgent: "ctrl+up",
};

export interface MastraAgentExtensionShortcuts {
	viewMode: string;
	nextAgent: string;
	previousAgent: string;
}

export interface MastraAgentExtensionConfigResult {
	options: MastraAgentsWidgetOptions;
	debugPiRedraw: boolean;
	defaultViewMode: MastraAgentsViewMode;
	shortcuts: MastraAgentExtensionShortcuts;
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
			return defaultConfigResult(path, false);
		}
		return {
			...defaultConfigResult(path, false),
			path,
			warning: `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	return parseMastraAgentExtensionConfig(raw, path);
}

export function loadMastraAgentExtensionConfigSync(cwd: string): MastraAgentExtensionConfigResult {
	const path = join(cwd, "config.yaml");
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return defaultConfigResult(path, false);
		}
		return {
			...defaultConfigResult(path, false),
			warning: `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	return parseMastraAgentExtensionConfig(raw, path);
}

function parseMastraAgentExtensionConfig(raw: string, path: string): MastraAgentExtensionConfigResult {
	let parsed: unknown;
	try {
		parsed = parse(raw);
	} catch (error) {
		return {
			...defaultConfigResult(path, true),
			warning: `Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const section = isRecord(parsed) ? parsed[MASTRA_AGENT_EXTENSION_CONFIG_KEY] : undefined;
	if (section === undefined) return defaultConfigResult(path, true);
	if (!isRecord(section)) {
		return {
			...defaultConfigResult(path, true),
			warning: `${MASTRA_AGENT_EXTENSION_CONFIG_KEY} in ${path} must be a mapping`,
		};
	}

	const warnings: string[] = [];
	const maxCards = readPositiveInteger(section.maxCards, "maxCards", warnings);
	const maxLines = readPositiveInteger(section.maxLines, "maxLines", warnings);
	const listMaxLines = readPositiveInteger(section.listMaxLines, "listMaxLines", warnings);
	const reservedRows = readNonNegativeInteger(section.reservedRows, "reservedRows", warnings);
	const debug = readBoolean(section.debug, "debug", warnings);
	const debugPiRedraw = readBoolean(section.debugPiRedraw, "debugPiRedraw", warnings);
	const debugLogPath = readString(section.debugLogPath, "debugLogPath", warnings);
	const defaultViewMode = readViewMode(section.defaultViewMode, "defaultViewMode", warnings);
	const viewModeShortcut = readString(section.viewModeShortcut, "viewModeShortcut", warnings);
	const nextAgentShortcut = readString(section.nextAgentShortcut, "nextAgentShortcut", warnings);
	const previousAgentShortcut = readString(section.previousAgentShortcut, "previousAgentShortcut", warnings);
	return {
		options: {
			maxCards: maxCards ?? DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.maxCards,
			maxLines: maxLines ?? DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.maxLines,
			...(listMaxLines !== undefined ? { listMaxLines } : {}),
			...(reservedRows !== undefined ? { reservedRows } : {}),
			...(debug !== undefined ? { debug } : {}),
			...(debugLogPath !== undefined ? { debugLogPath } : {}),
		},
		debugPiRedraw: debugPiRedraw ?? debug ?? false,
		defaultViewMode: defaultViewMode ?? DEFAULT_MASTRA_AGENT_VIEW_MODE,
		shortcuts: {
			viewMode: viewModeShortcut ?? DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS.viewMode,
			nextAgent: nextAgentShortcut ?? DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS.nextAgent,
			previousAgent: previousAgentShortcut ?? DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS.previousAgent,
		},
		path,
		found: true,
		warning: warnings.length > 0 ? `Ignoring invalid ${MASTRA_AGENT_EXTENSION_CONFIG_KEY} values in ${path}: ${warnings.join(", ")}` : undefined,
	};
}

function defaultConfigResult(path: string, found: boolean): MastraAgentExtensionConfigResult {
	return {
		options: { ...DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS },
		debugPiRedraw: false,
		defaultViewMode: DEFAULT_MASTRA_AGENT_VIEW_MODE,
		shortcuts: { ...DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS },
		path,
		found,
	};
}

function readPositiveInteger(value: unknown, name: string, warnings: string[]): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
	warnings.push(name);
	return undefined;
}

function readNonNegativeInteger(value: unknown, name: string, warnings: string[]): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
	warnings.push(name);
	return undefined;
}

function readBoolean(value: unknown, name: string, warnings: string[]): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "boolean") return value;
	warnings.push(name);
	return undefined;
}

function readString(value: unknown, name: string, warnings: string[]): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && value.trim().length > 0) return value;
	warnings.push(name);
	return undefined;
}

function readViewMode(value: unknown, name: string, warnings: string[]): MastraAgentsViewMode | undefined {
	if (value === undefined) return undefined;
	if (value === "list" || value === "cards" || value === "detail") return value;
	warnings.push(name);
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
