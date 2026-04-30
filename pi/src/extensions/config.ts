import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { ThemeColor } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MASTRA_AGENT_WIDGET_COLORS, type MastraAgentWidgetColors, type MastraAgentsViewMode, type MastraAgentsWidgetOptions } from "../tui/index.js";

export const MASTRA_AGENT_EXTENSION_CONFIG_KEY = "mastra-agent-extension";
export const DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS: Required<Pick<MastraAgentsWidgetOptions, "maxCards" | "maxLines" | "listMaxAgents" | "colors">> = {
	maxCards: 4,
	maxLines: 60,
	listMaxAgents: 5,
	colors: { ...DEFAULT_MASTRA_AGENT_WIDGET_COLORS },
};
export const DEFAULT_MASTRA_AGENT_VIEW_MODE: MastraAgentsViewMode = "list";
export const DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS: MastraAgentExtensionShortcuts = {
	viewMode: "alt+h",
	nextAgent: "ctrl+down",
	previousAgent: "ctrl+up",
	detailScrollDown: "alt+j",
	detailScrollUp: "alt+k",
	detailStreamOnly: "alt+s",
};

export interface MastraAgentExtensionShortcuts {
	viewMode: string;
	nextAgent: string;
	previousAgent: string;
	detailScrollDown: string;
	detailScrollUp: string;
	detailStreamOnly: string;
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
	const listMaxAgents = readPositiveInteger(section.listMaxAgents, "listMaxAgents", warnings);
	const reservedRows = readNonNegativeInteger(section.reservedRows, "reservedRows", warnings);
	const debug = readBoolean(section.debug, "debug", warnings);
	const debugPiRedraw = readBoolean(section.debugPiRedraw, "debugPiRedraw", warnings);
	const debugLogPath = readString(section.debugLogPath, "debugLogPath", warnings);
	const colors = readWidgetColors(section.colors, "colors", warnings);
	const defaultViewMode = readViewMode(section.defaultViewMode, "defaultViewMode", warnings);
	const viewModeShortcut = readString(section.viewModeShortcut, "viewModeShortcut", warnings);
	const nextAgentShortcut = readString(section.nextAgentShortcut, "nextAgentShortcut", warnings);
	const previousAgentShortcut = readString(section.previousAgentShortcut, "previousAgentShortcut", warnings);
	const detailScrollDownShortcut = readString(section.detailScrollDownShortcut, "detailScrollDownShortcut", warnings);
	const detailScrollUpShortcut = readString(section.detailScrollUpShortcut, "detailScrollUpShortcut", warnings);
	const detailStreamOnlyShortcut = readString(section.detailStreamOnlyShortcut, "detailStreamOnlyShortcut", warnings);
	return {
		options: {
			maxCards: maxCards ?? DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.maxCards,
			maxLines: maxLines ?? DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.maxLines,
			listMaxAgents: listMaxAgents ?? DEFAULT_MASTRA_AGENT_WIDGET_OPTIONS.listMaxAgents,
			colors: { ...DEFAULT_MASTRA_AGENT_WIDGET_COLORS, ...(colors ?? {}) },
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
			detailScrollDown: detailScrollDownShortcut ?? DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS.detailScrollDown,
			detailScrollUp: detailScrollUpShortcut ?? DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS.detailScrollUp,
			detailStreamOnly: detailStreamOnlyShortcut ?? DEFAULT_MASTRA_AGENT_EXTENSION_SHORTCUTS.detailStreamOnly,
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

function readWidgetColors(value: unknown, name: string, warnings: string[]): MastraAgentWidgetColors | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		warnings.push(name);
		return undefined;
	}
	const colors: MastraAgentWidgetColors = {};
	const prompt = readThemeColor(value.prompt, `${name}.prompt`, warnings);
	const tool = readThemeColor(value.tool, `${name}.tool`, warnings);
	const reasoning = readThemeColor(value.reasoning, `${name}.reasoning`, warnings);
	if (prompt !== undefined) colors.prompt = prompt;
	if (tool !== undefined) colors.tool = tool;
	if (reasoning !== undefined) colors.reasoning = reasoning;
	return colors;
}

function readThemeColor(value: unknown, name: string, warnings: string[]): ThemeColor | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && isThemeColor(value)) return value;
	warnings.push(name);
	return undefined;
}

function readViewMode(value: unknown, name: string, warnings: string[]): MastraAgentsViewMode | undefined {
	if (value === undefined) return undefined;
	if (value === "list" || value === "cards" || value === "detail") return value;
	warnings.push(name);
	return undefined;
}

const VALID_THEME_COLORS: readonly ThemeColor[] = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"bashMode",
];

function isThemeColor(value: string): value is ThemeColor {
	return (VALID_THEME_COLORS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
