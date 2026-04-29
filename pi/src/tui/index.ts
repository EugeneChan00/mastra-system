import { getMarkdownTheme, type Theme, type ThemeColor } from "@mariozechner/pi-coding-agent";
import type { Component, TUI as PiTUI } from "@mariozechner/pi-tui";
import { Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import type { MastraAgentCallDetails, MastraAgentCallInput, MastraToolEvent, MastraUsage } from "../mastra/types.js";

// Pi only gives extensions above/below-editor widget slots. The Mastra
// activity surface uses the above-editor slot, so this line budget keeps live
// async cards visible without pushing the prompt editor off screen.
const DEFAULT_WIDGET_MAX_LINES = 28;
// Show the two most relevant jobs directly. Extra jobs stay discoverable via
// the overflow row and status/read tools instead of rendering partial cards.
const DEFAULT_WIDGET_MAX_CARDS = 2;
const COLLAPSED_CARD_BODY_LINES = 18;
const EXPANDED_CARD_BODY_LINES = 48; // 50 total lines including top/bottom borders.
const COLLAPSED_PROMPT_LINES = 3;
const EXPANDED_PROMPT_LINES = 8;
const DEFAULT_ACTIVITY_LINGER_MS = 12_000;
const ERROR_ACTIVITY_LINGER_MS = 30_000;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TOOL_NAME_ALIASES: Record<string, string> = {
	mastra_workspace_list_files: "list_files",
	mastra_workspace_read_file: "read_file",
	mastra_workspace_write_file: "write_file",
	mastra_workspace_edit_file: "edit_file",
	mastra_workspace_grep: "grep",
	mastra_workspace_execute_command: "bash",
	workspaceListFiles: "list_files",
	workspaceReadFile: "read_file",
	workspaceWriteFile: "write_file",
	workspaceReplaceInFile: "edit_file",
};

export interface MastraAgentActivity {
	toolCallId: string;
	agentId: string;
	modeId?: string;
	threadId: string;
	resourceId: string;
	status: MastraAgentCallDetails["status"];
	startedAt: number;
	updatedAt: number;
	completedAt?: number;
	text: string;
	prompt?: string;
	lastEvent?: string;
	toolCalls: number;
	toolResults: number;
	usage?: MastraUsage;
	errors: string[];
	/**
	 * Full details snapshot for MastraAgentCard rendering.
	 *
	 * The summary fields above keep status/footer rendering cheap, while this
	 * snapshot carries the text/tool arrays needed to reuse the same rich card
	 * renderer used by synchronous `mastra_agent_call` results.
	 */
	details: MastraAgentCallDetails;
}

export interface MastraAgentActivitySink {
	start(toolCallId: string, params: MastraAgentCallInput, details: MastraAgentCallDetails): void;
	update(toolCallId: string, details: MastraAgentCallDetails): void;
	finish(toolCallId: string, details: MastraAgentCallDetails): void;
}

export class MastraAgentActivityStore implements MastraAgentActivitySink {
	private readonly activities = new Map<string, MastraAgentActivity>();
	private readonly listeners = new Set<() => void>();

	constructor(private readonly lingerMs = DEFAULT_ACTIVITY_LINGER_MS) {}

	start(toolCallId: string, params: MastraAgentCallInput, details: MastraAgentCallDetails): void {
		this.activities.set(toolCallId, activityFromDetails(toolCallId, details, undefined, params.message));
		this.notify();
	}

	update(toolCallId: string, details: MastraAgentCallDetails): void {
		this.activities.set(toolCallId, activityFromDetails(toolCallId, details, this.activities.get(toolCallId)));
		this.notify();
	}

	finish(toolCallId: string, details: MastraAgentCallDetails): void {
		this.activities.set(toolCallId, activityFromDetails(toolCallId, details, this.activities.get(toolCallId)));
		this.notify();
	}

	snapshot(options: { includeFinished?: boolean } = {}): MastraAgentActivity[] {
		this.cleanupExpired();
		const includeFinished = options.includeFinished ?? true;
		const values = Array.from(this.activities.values()).filter((activity) => includeFinished || activity.status === "running");
		return values.sort((a, b) => {
			const aRunning = a.status === "running" ? 0 : 1;
			const bRunning = b.status === "running" ? 0 : 1;
			if (aRunning !== bRunning) return aRunning - bRunning;
			return a.startedAt - b.startedAt;
		});
	}

	hasVisibleActivity(): boolean {
		return this.snapshot().length > 0;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	reset(): void {
		this.activities.clear();
		this.notify();
	}

	private cleanupExpired(now = Date.now()): void {
		let changed = false;
		for (const [id, activity] of this.activities) {
			if (activity.status === "running") continue;
			const linger = activity.status === "error" || activity.status === "aborted" ? ERROR_ACTIVITY_LINGER_MS : this.lingerMs;
			const completedAt = activity.completedAt ?? activity.updatedAt;
			if (now - completedAt > linger) {
				this.activities.delete(id);
				changed = true;
			}
		}
		if (changed) this.notify();
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}

export interface MastraAgentsWidgetOptions {
	/** Overall widget height budget in Pi's above-editor slot. */
	maxLines?: number;
	/** Number of live/lingering async jobs rendered as full cards. */
	maxCards?: number;
	/** Card width before right-padding; controls the bottom-right visual anchor. */
	cardWidth?: number;
	/** Optional fixed body height per card; otherwise derived from maxLines. */
	cardBodyLines?: number;
}

export class MastraAgentsWidget implements Component {
	private readonly unsubscribe: () => void;
	private readonly timer: ReturnType<typeof setInterval>;

	constructor(
		private readonly tui: Pick<PiTUI, "requestRender">,
		private readonly theme: Theme,
		private readonly store: MastraAgentActivityStore,
		private readonly options: MastraAgentsWidgetOptions = {},
	) {
		this.unsubscribe = this.store.subscribe(() => this.tui.requestRender());
		this.timer = setInterval(() => {
			if (this.store.hasVisibleActivity()) this.tui.requestRender();
		}, 160);
	}

	render(width: number): string[] {
		if (width < 12) return [];
		const activities = this.store.snapshot();
		if (activities.length === 0) return [];

		const maxLines = Math.max(8, this.options.maxLines ?? DEFAULT_WIDGET_MAX_LINES);
		const running = activities.filter((activity) => activity.status === "running");
		const th = this.theme;

		// Running jobs are the actionable surface; completed jobs linger briefly as
		// confirmation. This order makes multiple concurrent async agents visible
		// instead of letting an older finished card hide an active stream.
		const orderedActivities = [...running, ...activities.filter((a) => a.status !== "running")];
		const maxCards = Math.max(1, Math.floor(this.options.maxCards ?? DEFAULT_WIDGET_MAX_CARDS));
		const visibleCards = orderedActivities.slice(0, maxCards);
		if (visibleCards.length > 0) {
			// Split the available widget height across cards so launching two async
			// agents yields two complete, bounded cards rather than half of one tall
			// card. MastraAgentCard receives maxBodyLines as its per-card scroll budget.
			const extra = Math.max(0, activities.length - visibleCards.length);
			const gapLines = Math.max(0, visibleCards.length - 1);
			const overflowLines = extra > 0 ? 1 : 0;
			const availableForCards = Math.max(5, maxLines - gapLines - overflowLines);
			const perCardTotalLines = Math.max(5, Math.floor(availableForCards / visibleCards.length));
			const maxBodyLines = Math.max(3, this.options.cardBodyLines ?? perCardTotalLines - 2);
			// Right-align by padding inside the widget. This is the supported way to
			// approximate a bottom-right card because Pi has no `bottomRight` widget
			// placement; valid placements are only `aboveEditor` and `belowEditor`.
			const cardWidth = Math.min(width, Math.max(12, this.options.cardWidth ?? 96));
			const pad = Math.max(0, width - cardWidth);
			const leftPad = " ".repeat(pad);
			const lines: string[] = [];

			for (let i = 0; i < visibleCards.length; i++) {
				const activity = visibleCards[i];
				const cardLines = new MastraAgentCard(
					activity.details,
					{ isPartial: activity.status === "running", expanded: false, maxBodyLines },
					th,
				).render(cardWidth);
				if (cardLines.length === 0) continue;
				if (lines.length > 0) lines.push("");
				lines.push(...cardLines.map((line) => leftPad + line));
			}

			if (lines.length > 0) {
				if (extra > 0) lines.push(truncateToWidth(`${leftPad}${th.fg("dim", `└─ +${extra} more`)}`, width));
				return lines;
			}
		}

		// Fallback: compact list.
		const allActivities = orderedActivities;
		const lines: string[] = [];
		const titleIcon = running.length > 0 ? th.fg("accent", "●") : th.fg("success", "✓");
		const title = `${titleIcon} ${th.bold("Mastra Agents")} ${th.fg("dim", `${running.length} running · ${activities.length} visible`)}`;
		lines.push(truncateToWidth(title, width));

		const visibleActivities = allActivities.slice(0, Math.max(0, maxLines - 2));
		for (let i = 0; i < visibleActivities.length; i++) {
			const activity = visibleActivities[i];
			const isLast = i === visibleActivities.length - 1 && activities.length <= visibleActivities.length;
			const branch = isLast ? "└─" : "├─";
			lines.push(truncateToWidth(`${th.fg("dim", branch)} ${formatActivityHeadline(activity, th)}`, width));
			const progress = activity.lastEvent || textTail(activity.text, 90);
			const prompt = activity.prompt ? `prompt: ${textHead(activity.prompt, 80)}` : undefined;
			const tail = activity.errors[0]
				? `error: ${activity.errors[activity.errors.length - 1]}`
				: compactParts([prompt, progress ? `now: ${progress}` : undefined]) || "thinking…";
			const child = isLast ? "   " : "│  ";
			lines.push(truncateToWidth(`${th.fg("dim", child + "⎿ ")}${th.fg(activity.errors.length > 0 ? "error" : "muted", tail)}`, width));
		}

		if (activities.length > visibleActivities.length) {
			lines.push(truncateToWidth(th.fg("dim", `└─ +${activities.length - visibleActivities.length} more`), width));
		}

		return lines.slice(0, maxLines);
	}

	invalidate(): void {
		// No cached rendering state.
	}

	dispose(): void {
		this.unsubscribe();
		clearInterval(this.timer);
	}
}

export interface MastraAgentCardOptions {
	expanded?: boolean;
	isPartial?: boolean;
	/** Optional body budget used by the async widget to stack multiple cards. */
	maxBodyLines?: number;
}

export class MastraAgentCard implements Component {
	constructor(
		private readonly details: MastraAgentCallDetails,
		private readonly options: MastraAgentCardOptions,
		private readonly theme: Theme,
	) {}

	render(width: number): string[] {
		if (width < 12) return [truncateToWidth(this.fallbackLine(), width)];
		const innerWidth = Math.max(1, width - 4);
		const borderColor = statusColor(this.options.isPartial ? "running" : this.details.status);
		const th = this.theme;
		const lines: string[] = [];
		const border = (s: string) => th.fg(borderColor, s);
		const topLabel = ` Mastra: ${this.details.agentId} `;
		const meta = [
			this.options.isPartial ? "running" : this.details.status,
			formatElapsed(this.details.startedAt, this.details.completedAt),
			`${this.details.toolCalls.length + this.details.toolResults.length} tools`,
			formatUsage(this.details.usage),
		]
			.filter(Boolean)
			.join(" ─ ");
		lines.push(renderTopBorder(width, topLabel, meta, border));

		const pinnedBodyLines: string[] = [];
		const prompt = this.details.prompt?.trim();
		if (prompt) {
			pinnedBodyLines.push(th.fg("muted", "Prompt"));
			pinnedBodyLines.push(...renderPromptLines(prompt, innerWidth, this.options.expanded === true, th));
		}

		const bodyLines: string[] = [];
		const toolEvents = compactToolEvents(recentToolEvents(this.details, this.options.expanded ? 24 : 10));
		if (toolEvents.length > 0) {
			bodyLines.push(th.fg("muted", "Tools"));
			for (const event of toolEvents) {
				bodyLines.push(...formatToolEventLines(event, th, innerWidth, this.options.expanded === true));
			}
		}

		const text = this.details.text.trim() || (this.options.isPartial ? "streaming…" : "(no text output)");
		const textLimit = this.options.expanded ? 8_000 : 1_500;
		if (bodyLines.length > 0) bodyLines.push("");
		bodyLines.push(th.fg("muted", "Output"));
		bodyLines.push(...renderMarkdownLines(markdownTail(text, textLimit), innerWidth));

		if (this.details.reasoning && this.options.expanded) {
			bodyLines.push("");
			bodyLines.push(th.fg("muted", "Reasoning"));
			for (const wrapped of wrapTextWithAnsi(th.fg("dim", textTail(this.details.reasoning, 1200)), innerWidth)) {
				bodyLines.push(wrapped);
			}
		}

		if (this.details.errors.length > 0) {
			bodyLines.push("");
			for (const error of this.details.errors.slice(this.options.expanded ? -8 : -3)) {
				bodyLines.push(th.fg("error", `Error: ${error}`));
			}
		}

		const footerParts = [
			this.details.threadId ? `thread ${shortId(this.details.threadId)}` : undefined,
			this.details.rawChunkCount ? `${this.details.rawChunkCount} chunks` : undefined,
			this.details.chunksTruncated ? "truncated" : undefined,
		].filter(Boolean);
		if (footerParts.length > 0) {
			bodyLines.push(th.fg("dim", footerParts.join(" · ")));
		}

		if (pinnedBodyLines.length > 0 && bodyLines.length > 0) pinnedBodyLines.push("");
		const bodyLimit = this.options.maxBodyLines ?? (this.options.expanded ? EXPANDED_CARD_BODY_LINES : COLLAPSED_CARD_BODY_LINES);
		const remainingBodyLimit = Math.max(0, bodyLimit - pinnedBodyLines.length);
		const scrolledBody = remainingBodyLimit > 0 ? [...pinnedBodyLines, ...tailLines(bodyLines, remainingBodyLimit, th)] : tailLines(pinnedBodyLines, bodyLimit, th);
		for (const bodyLine of scrolledBody) {
			lines.push(renderFrameRow(bodyLine, width, border));
		}
		lines.push(border(`╰${"─".repeat(Math.max(0, width - 2))}╯`));
		return lines;
	}

	invalidate(): void {
		// Stateless renderer.
	}

	private fallbackLine(): string {
		return `Mastra ${this.details.agentId}: ${this.details.status}`;
	}
}

export function formatElapsed(startedAt?: number, completedAt?: number): string {
	if (!startedAt) return "0:00";
	const elapsedMs = Math.max(0, (completedAt ?? Date.now()) - startedAt);
	const totalSeconds = Math.floor(elapsedMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatUsage(usage?: MastraUsage): string | undefined {
	const total = usage?.totalTokens ?? usage?.total ?? usage?.tokens;
	if (typeof total === "number" && Number.isFinite(total) && total > 0) return `${formatCount(total)} tok`;
	const input = usage?.inputTokens ?? usage?.promptTokens ?? usage?.input;
	const output = usage?.outputTokens ?? usage?.completionTokens ?? usage?.output;
	const parts: string[] = [];
	if (typeof input === "number" && input > 0) parts.push(`↑${formatCount(input)}`);
	if (typeof output === "number" && output > 0) parts.push(`↓${formatCount(output)}`);
	return parts.length > 0 ? `${parts.join(" ")} tok` : undefined;
}

export function formatCount(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 10_000) return `${Math.round(count / 1000)}k`;
	if (count >= 1_000) return `${(count / 1000).toFixed(1)}k`;
	return String(count);
}

function activityFromDetails(
	toolCallId: string,
	details: MastraAgentCallDetails,
	previous?: MastraAgentActivity,
	promptOverride?: string,
): MastraAgentActivity {
	const now = Date.now();
	const mostRecentTool = recentToolEvents(details, 1)[0];
	const lastEvent = mostRecentTool ? plainToolEvent(mostRecentTool) : textTail(details.text, 90);
	const startedAt = details.startedAt ?? previous?.startedAt ?? now;
	const updatedAt = details.updatedAt ?? now;
	const completedAt = details.completedAt ?? (details.status === "running" ? previous?.completedAt : updatedAt);
	return {
		toolCallId,
		agentId: details.agentId,
		modeId: details.modeId,
		threadId: details.threadId,
		resourceId: details.resourceId,
		status: details.status,
		startedAt,
		updatedAt,
		completedAt,
		text: details.text,
		prompt: details.prompt ?? promptOverride ?? previous?.prompt,
		lastEvent,
		toolCalls: details.toolCalls.length,
		toolResults: details.toolResults.length,
		usage: details.usage,
		errors: [...details.errors],
		details: {
			...details,
			toolCalls: [...details.toolCalls],
			toolResults: [...details.toolResults],
			errors: [...details.errors],
		},
	};
}

function formatActivityHeadline(activity: MastraAgentActivity, theme: Theme): string {
	const icon = activityIcon(activity, theme);
	const meta = [
		activity.status,
		formatElapsed(activity.startedAt, activity.completedAt),
		activity.toolCalls + activity.toolResults > 0 ? `${activity.toolCalls + activity.toolResults} tools` : undefined,
		formatUsage(activity.usage),
		activity.modeId ? `mode=${activity.modeId}` : undefined,
	]
		.filter(Boolean)
		.join(" · ");
	return `${icon} ${theme.fg("accent", activity.agentId)} ${theme.fg("dim", meta)}`;
}

function activityIcon(activity: MastraAgentActivity, theme: Theme): string {
	if (activity.status === "running") {
		const frame = SPINNER_FRAMES[Math.floor(Date.now() / 160) % SPINNER_FRAMES.length];
		return theme.fg("accent", frame);
	}
	if (activity.status === "done") return theme.fg("success", "✓");
	if (activity.status === "error" || activity.status === "aborted") return theme.fg("error", "✗");
	return theme.fg("dim", "○");
}

function recentToolEvents(details: MastraAgentCallDetails, limit: number): MastraToolEvent[] {
	return [...details.toolCalls, ...details.toolResults]
		.sort((a, b) => a.timestamp - b.timestamp)
		.slice(-limit);
}

function formatToolEvent(event: MastraToolEvent, theme: Theme, previewWidth: number): string {
	const icon = toolEventIcon(event, theme);
	const rawName = event.name ?? event.id ?? "tool";
	const name = theme.fg("accent", displayToolName(rawName));
	const detail = event.type === "result" ? formatToolResultSummary(rawName, event.args, event.result, previewWidth) : formatToolArgs(rawName, event.args, previewWidth);
	const preview = detail ? ` ${theme.fg("dim", detail)}` : "";
	return `${icon} ${name}${preview}`;
}

function compactToolEvents(events: MastraToolEvent[]): MastraToolEvent[] {
	const idsWithFinalCall = new Set(events.filter((event) => event.type === "call" && event.id).map((event) => event.id as string));
	return events.filter((event) => {
		if (event.type === "input-start" || event.type === "input-end") return false;
		if (event.type === "input-delta" && event.id && idsWithFinalCall.has(event.id)) return false;
		return true;
	});
}

function formatToolEventLines(event: MastraToolEvent, theme: Theme, width: number, expanded: boolean): string[] {
	const icon = toolEventIcon(event, theme);
	const rawName = event.name ?? event.id ?? "tool";
	const name = theme.fg("accent", displayToolName(rawName));
	const prefix = `${icon} ${name}`;
	const detail = event.type === "result"
		? formatToolResultSummary(rawName, event.args, event.result, width)
		: formatToolArgs(rawName, event.args, width);
	if (!detail) return [truncateToWidth(prefix, width)];

	if (!expanded || event.type !== "result") {
		return wrapTextWithAnsi(`${prefix} ${theme.fg("dim", detail)}`, width);
	}

	const lines = wrapTextWithAnsi(`${prefix} ${theme.fg("dim", detail)}`, width);
	const output = toolResultText(event.result);
	if (!output || isShortSummary(detail, output)) return lines;
	for (const line of output.split("\n").slice(0, 10)) {
		lines.push(truncateToWidth(theme.fg("dim", `  ⎿ ${line}`), width));
	}
	return lines;
}

function displayToolName(name: string): string {
	return TOOL_NAME_ALIASES[name] ?? name;
}

function formatToolArgs(rawName: string, args: unknown, maxChars: number): string {
	const name = displayToolName(rawName);
	const input = parseToolObject(args);
	if (!input) return typeof args === "string" ? previewValue(args, maxChars) : "";

	const value = (...keys: string[]) => firstDefined(input, keys);
	const pathValue = value("path", "filePath", "directory");

	switch (name) {
		case "list_files":
			return compactParts([
				pathValue === undefined ? undefined : `path=${formatScalar(pathValue)}`,
				value("maxDepth") === undefined ? undefined : `depth=${formatScalar(value("maxDepth"))}`,
				value("pattern") === undefined ? undefined : `pattern=${formatScalar(value("pattern"))}`,
				value("showHidden") === undefined ? undefined : `hidden=${formatScalar(value("showHidden"))}`,
				value("dirsOnly") === true ? "dirs_only" : undefined,
			]);
		case "read_file":
			return compactParts([
				pathValue === undefined ? undefined : `path=${formatScalar(pathValue)}`,
				value("offset") === undefined ? undefined : `offset=${formatScalar(value("offset"))}`,
				value("limit") === undefined ? undefined : `limit=${formatScalar(value("limit"))}`,
			]);
		case "write_file":
			return compactParts([
				pathValue === undefined ? undefined : `path=${formatScalar(pathValue)}`,
				input.content === undefined ? undefined : `${countLines(String(input.content))} lines`,
				value("overwrite") === true ? "overwrite" : undefined,
			]);
		case "edit_file":
			return compactParts([
				pathValue === undefined ? undefined : `path=${formatScalar(pathValue)}`,
				input.oldText === undefined ? undefined : `old=${String(input.oldText).length} chars`,
				input.newText === undefined ? undefined : `new=${String(input.newText).length} chars`,
				value("replaceAll") === true ? "replace_all" : undefined,
			]);
		case "grep":
			return compactParts([
				value("pattern", "query") === undefined ? undefined : `pattern=${formatScalar(value("pattern", "query"))}`,
				pathValue === undefined ? undefined : `path=${formatScalar(pathValue)}`,
			]);
		case "bash":
			return value("command") === undefined ? compactKeyValues(input, maxChars) : previewValue(String(value("command")), maxChars);
		default:
			return compactKeyValues(input, maxChars);
	}
}

function formatToolResultSummary(rawName: string, args: unknown, result: unknown, maxChars: number): string {
	const name = displayToolName(rawName);
	const input = parseToolObject(args);
	const output = toolResultText(result);
	const pathValue = input ? firstDefined(input, ["path", "filePath", "directory"]) : undefined;

	switch (name) {
		case "list_files": {
			const counts = output.match(/(\d+) director(?:y|ies), (\d+) files?/i);
			return counts ? `${counts[1]} dirs, ${counts[2]} files` : previewValue(output, maxChars);
		}
		case "read_file":
			return compactParts([
				pathValue === undefined ? undefined : `path=${formatScalar(pathValue)}`,
				`${countLines(output)} lines`,
				`${output.length} chars`,
			]);
		case "write_file":
			return previewValue(output || "written", maxChars);
		case "edit_file":
			return previewValue(output || "edited", maxChars);
		case "grep":
			return previewValue(output || "no matches", maxChars);
		case "bash":
			return previewValue(output || "done", maxChars);
		default:
			return previewValue(output, maxChars);
	}
}

function parseToolObject(value: unknown): Record<string, unknown> | undefined {
	if (isPlainRecord(value)) return value;
	if (typeof value !== "string") return undefined;
	try {
		const parsed = JSON.parse(value);
		return isPlainRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function toolResultText(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (isPlainRecord(value)) {
		if (typeof value.value === "string") return value.value;
		if (typeof value.output === "string") return value.output;
		if (isPlainRecord(value.output) && typeof value.output.value === "string") return value.output.value;
		if (typeof value.content === "string") return value.content;
	}
	return prettyValue(value, 2_000);
}

function isShortSummary(summary: string, output: string): boolean {
	return output.length < 120 && summary.includes(output.trim());
}

function compactKeyValues(record: Record<string, unknown>, maxChars: number): string {
	return previewValue(compactParts(Object.entries(record).map(([key, value]) => `${key}=${formatScalar(value)}`)), maxChars);
}

function compactParts(parts: Array<string | undefined | false>): string {
	return parts.filter((part): part is string => Boolean(part)).join("  ");
}

function formatScalar(value: unknown): string {
	if (typeof value === "string") {
		const normalized = value.replace(/\s+/g, " ").trim();
		return /[\s]/.test(normalized) ? JSON.stringify(normalized.length > 60 ? `${normalized.slice(0, 59)}…` : normalized) : normalized;
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === null) return "null";
	return previewValue(value, 60);
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
	for (const key of keys) {
		if (record[key] !== undefined) return record[key];
	}
	return undefined;
}

function countLines(text: string): number {
	return text.length === 0 ? 0 : text.split("\n").length;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolEventIcon(event: MastraToolEvent, theme: Theme): string {
	if (event.type === "result") return theme.fg("success", "✓");
	if (event.type === "error") return theme.fg("error", "✗");
	if (event.type === "call") return theme.fg("accent", "→");
	return theme.fg("muted", "…");
}

function toolEventDetail(event: MastraToolEvent): unknown {
	if (event.type === "error") return event.error;
	if (event.type === "result") return event.result;
	return event.args;
}

function renderMarkdownLines(markdown: string, width: number): string[] {
	try {
		return new Markdown(markdown, 0, 0, getMarkdownTheme()).render(width);
	} catch {
		return wrapTextWithAnsi(markdown, width);
	}
}

function tailLines(lines: string[], limit: number, theme: Theme): string[] {
	if (lines.length <= limit) return lines;
	const kept = Math.max(1, limit - 1);
	return [theme.fg("dim", `… ${lines.length - kept} earlier lines`), ...lines.slice(-kept)];
}

function headLines(lines: string[], limit: number, theme: Theme): string[] {
	if (lines.length <= limit) return lines;
	const kept = Math.max(1, limit - 1);
	return [...lines.slice(0, kept), theme.fg("dim", `… ${lines.length - kept} more prompt lines`)];
}

function renderPromptLines(prompt: string, width: number, expanded: boolean, theme: Theme): string[] {
	const maxChars = expanded ? 2_000 : 500;
	const maxLines = expanded ? EXPANDED_PROMPT_LINES : COLLAPSED_PROMPT_LINES;
	const trimmed = prompt.trim();
	const clipped = trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, Math.max(0, maxChars - 1))}…`;
	const lines = clipped.split("\n").flatMap((line) => (line.length === 0 ? [""] : wrapTextWithAnsi(theme.fg("dim", line), width)));
	return headLines(lines, maxLines, theme);
}

function plainToolEvent(event: MastraToolEvent): string {
	const name = event.name ?? event.id ?? "tool";
	if (event.type === "result") return `${name} done`;
	if (event.type === "error") return `${name} error`;
	if (event.type === "call") return `${name} running`;
	if (event.type === "input-delta") return `${name} input…`;
	return name;
}

function previewValue(value: unknown, maxChars: number): string {
	const text = prettyValue(value, maxChars).replace(/\s+/g, " ").trim();
	return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function prettyValue(value: unknown, maxChars: number): string {
	let text: string;
	if (typeof value === "string") text = value;
	else {
		try {
			const json = JSON.stringify(value, null, 2);
			text = typeof json === "string" ? json : String(value);
		} catch {
			text = String(value);
		}
	}
	return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function textTail(text: string, maxChars: number): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxChars) return normalized;
	return `…${normalized.slice(normalized.length - maxChars + 1)}`;
}

function textHead(text: string, maxChars: number): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function markdownTail(text: string, maxChars: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxChars) return trimmed;
	return `…\n\n${trimmed.slice(trimmed.length - maxChars + 3)}`;
}

function statusColor(status: MastraAgentCallDetails["status"]): ThemeColor {
	if (status === "error" || status === "aborted") return "error";
	if (status === "running") return "accent";
	return "success";
}

function renderTopBorder(width: number, label: string, meta: string, border: (s: string) => string): string {
	const contentWidth = Math.max(0, width - 2);
	const raw = `─${label}─ ${meta} `;
	const truncated = truncateToWidth(raw, contentWidth, "");
	const fill = "─".repeat(Math.max(0, contentWidth - visibleWidth(truncated)));
	return border(`╭${truncated}${fill}╮`);
}

function renderFrameRow(content: string, width: number, border: (s: string) => string): string {
	const innerWidth = Math.max(0, width - 4);
	const truncated = truncateToWidth(content, innerWidth, "…");
	const padded = truncated + " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
	return `${border("│")} ${padded} ${border("│")}`;
}

function shortId(id: string): string {
	if (id.length <= 18) return id;
	return `${id.slice(0, 8)}…${id.slice(-6)}`;
}
