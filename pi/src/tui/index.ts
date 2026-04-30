import { getMarkdownTheme, type Theme, type ThemeColor } from "@mariozechner/pi-coding-agent";
import type { Component, DefaultTextStyle, MarkdownTheme, TUI as PiTUI } from "@mariozechner/pi-tui";
import { Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MastraAgentCallDetails, MastraAgentCallInput, MastraAgentLifecycleStatus, MastraToolEvent, MastraUsage } from "../mastra/types.js";

const DEFAULT_WIDGET_MAX_LINES = 60;
const DEFAULT_WIDGET_MAX_CARDS = 4;
const DEFAULT_WIDGET_LIST_MAX_LINES = 18;
const DEFAULT_WIDGET_LIST_MAX_AGENTS = 5;
const DEFAULT_WIDGET_RESERVED_ROWS = 10;
const MIN_WIDGET_LINES = 1;
const ABOVE_EDITOR_WIDGET_SPACER_LINES = 1;
const COLLAPSED_CARD_BODY_LINES = 18;
const EXPANDED_CARD_BODY_LINES = 48; // 50 total lines including top/bottom borders.
const COLLAPSED_PROMPT_LINES = 3;
const EXPANDED_PROMPT_LINES = 8;
const DETAIL_SCROLL_STEP_ROWS = 5;
const MAX_DETAIL_SCROLL_OFFSET_ROWS = 5_000;
const DEFAULT_ACTIVITY_LINGER_MS = 12_000;
const ERROR_ACTIVITY_LINGER_MS = 30_000;
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
const FALLBACK_MARKDOWN_THEME: MarkdownTheme = {
	heading: (text) => text,
	link: (text) => text,
	linkUrl: (text) => text,
	code: (text) => text,
	codeBlock: (text) => text,
	codeBlockBorder: (text) => text,
	quote: (text) => text,
	quoteBorder: (text) => text,
	hr: (text) => text,
	listBullet: (text) => text,
	bold: (text) => text,
	italic: (text) => text,
	strikethrough: (text) => text,
	underline: (text) => text,
};

// Patterns matched against TUI-displayed text to suppress internal prompt
// scaffolding that is not useful to users in the rendered card output.
// These phrases appear in agent instructions/system-prompt but must not
// surface as visible card content.
const FILTER_PROMPT_SCAFFOLDING_PATTERNS: RegExp[] = [
	// Strip label + whitespace before the value word on the same line.
	// The value word is preserved; only the internal scaffolding label is removed.
	/Expected return status[:\s]*/gi,
	/Expected return format[:\s]*/gi,
	/expected return (?:status|format|value)[:\s]*/gi,
	/worker[- ]?brief[:\s]*/gi,
	/internal instruction[:\s]*/gi,
	/do not show[:\s]*/gi,
];

/**
 * Remove internal prompt-scaffolding phrases from text before TUI display.
 * Filters out patterns like "Expected return status", "Expected return format",
 * and similar worker-brief metadata that provides no runtime value to the user.
 */
export function filterPromptScaffolding(text: string): string {
	if (!text || typeof text !== "string") return text ?? "";
	let filtered = text;
	for (const pattern of FILTER_PROMPT_SCAFFOLDING_PATTERNS) {
		filtered = filtered.replace(pattern, "");
	}
	return filtered.trim().replace(/\s{2,}/g, " ");
}

export interface MastraAgentActivity {
	toolCallId: string;
	agentId: string;
	modeId?: string;
	threadId: string;
	resourceId: string;
	status: MastraAgentCallDetails["status"];
	lifecycleStatus: Exclude<MastraAgentLifecycleStatus, "available">;
	order: number;
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
	 * renderer used by synchronous `agent_query` results.
	 */
	details: MastraAgentCallDetails;
}

export interface MastraAgentActivitySink {
	start(toolCallId: string, params: MastraAgentCallInput, details: MastraAgentCallDetails): void;
	update(toolCallId: string, details: MastraAgentCallDetails): void;
	finish(toolCallId: string, details: MastraAgentCallDetails): void;
	end?(toolCallId: string): void;
	reset?(): void;
}

export class MastraAgentActivityStore implements MastraAgentActivitySink {
	private readonly activities = new Map<string, MastraAgentActivity>();
	private readonly endedToolCallIds = new Set<string>();
	private readonly listeners = new Set<() => void>();
	private nextOrder = 0;

	constructor(private readonly lingerMs = DEFAULT_ACTIVITY_LINGER_MS) {}

	start(toolCallId: string, params: MastraAgentCallInput, details: MastraAgentCallDetails): void {
		this.endedToolCallIds.delete(toolCallId);
		this.activities.set(toolCallId, activityFromDetails(toolCallId, details, undefined, params.message, "working", this.nextOrder++));
		this.notify();
	}

	update(toolCallId: string, details: MastraAgentCallDetails): void {
		if (this.endedToolCallIds.has(toolCallId)) return;
		this.activities.set(toolCallId, activityFromDetails(toolCallId, details, this.activities.get(toolCallId)));
		this.notify();
	}

	finish(toolCallId: string, details: MastraAgentCallDetails): void {
		if (this.endedToolCallIds.has(toolCallId)) return;
		this.activities.set(toolCallId, activityFromDetails(toolCallId, details, this.activities.get(toolCallId), undefined, "agent_response_queued"));
		this.notify();
	}

	end(toolCallId: string): void {
		this.endedToolCallIds.add(toolCallId);
		if (!this.activities.delete(toolCallId)) return;
		this.notify();
	}

	snapshot(options: { includeFinished?: boolean } = {}): MastraAgentActivity[] {
		this.cleanupExpired();
		const includeFinished = options.includeFinished ?? true;
		const values = Array.from(this.activities.values()).filter((activity) => includeFinished || activity.lifecycleStatus === "working");
		return values.sort((a, b) => {
			const aRunning = a.lifecycleStatus === "working" ? 0 : 1;
			const bRunning = b.lifecycleStatus === "working" ? 0 : 1;
			if (aRunning !== bRunning) return aRunning - bRunning;
			return a.order - b.order;
		});
	}

	hasVisibleActivity(): boolean {
		return this.snapshot({ includeFinished: false }).length > 0;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	reset(): void {
		this.activities.clear();
		this.endedToolCallIds.clear();
		this.nextOrder = 0;
		this.notify();
	}

	private cleanupExpired(now = Date.now()): void {
		let changed = false;
		for (const [id, activity] of this.activities) {
			if (activity.lifecycleStatus === "working" || activity.lifecycleStatus === "agent_response_queued") continue;
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
	/** Overall widget height budget for the full card/detail region. */
	maxLines?: number;
	/** Height budget for the compact list widget above the editor. */
	listMaxLines?: number;
	/** Maximum live async jobs rendered in compact list mode. */
	listMaxAgents?: number;
	/** Number of live/lingering async jobs rendered as full cards. */
	maxCards?: number;
	/** Optional fixed body height per card; otherwise derived from maxLines. */
	cardBodyLines?: number;
	/** Rows reserved for Pi chat/editor/status/footer chrome when adapting to terminal height. */
	reservedRows?: number;
	/** Deprecated: card/detail fixed sizing is derived from maxLines. */
	fixedRegion?: boolean;
	/** Shared view state for list/card/detail mode switching. */
	viewController?: MastraAgentsWidgetViewController;
	/** Emit Mastra widget viewport metrics. Can also be enabled with MASTRA_WIDGET_DEBUG=1. */
	debug?: boolean;
	/** Optional log path for widget metrics. Defaults to ~/.pi/agent/mastra-widget-debug.log. */
	debugLogPath?: string;
}

export type MastraAgentsViewMode = "list" | "cards" | "detail";

export class MastraAgentsWidgetViewController {
	private mode: MastraAgentsViewMode;
	private focusedToolCallId: string | undefined;
	private detailStreamOnly = false;
	private readonly detailScrollOffsets = new Map<string, number>();
	private readonly listeners = new Set<() => void>();

	constructor(initialMode: MastraAgentsViewMode = "list") {
		this.mode = initialMode;
	}

	getMode(): MastraAgentsViewMode {
		return this.mode;
	}

	isDetailStreamOnly(): boolean {
		return this.detailStreamOnly;
	}

	toggleDetailStreamOnly(): boolean {
		this.detailStreamOnly = !this.detailStreamOnly;
		this.notify();
		return this.detailStreamOnly;
	}

	reset(mode: MastraAgentsViewMode = "list"): void {
		const changed =
			this.mode !== mode ||
			this.focusedToolCallId !== undefined ||
			this.detailStreamOnly ||
			this.detailScrollOffsets.size > 0;
		this.mode = mode;
		this.focusedToolCallId = undefined;
		this.detailStreamOnly = false;
		this.detailScrollOffsets.clear();
		if (changed) this.notify();
	}

	setMode(mode: MastraAgentsViewMode): void {
		if (this.mode === mode) return;
		this.mode = mode;
		this.notify();
	}

	cycleMode(): MastraAgentsViewMode {
		const nextMode: MastraAgentsViewMode = this.mode === "list" ? "cards" : this.mode === "cards" ? "detail" : "list";
		this.setMode(nextMode);
		return nextMode;
	}

	focusNext(activities: MastraAgentActivity[], direction = 1): MastraAgentActivity | undefined {
		const focusable = visibleWidgetActivities(activities);
		if (focusable.length === 0) {
			if (this.focusedToolCallId !== undefined) {
				this.focusedToolCallId = undefined;
				this.notify();
			}
			return undefined;
		}

		const currentIndex = focusable.findIndex((activity) => activity.toolCallId === this.focusedToolCallId);
		const startIndex = currentIndex >= 0 ? currentIndex : direction >= 0 ? focusable.length - 1 : 0;
		const nextIndex = (startIndex + direction + focusable.length) % focusable.length;
		const nextActivity = focusable[nextIndex];
		if (this.focusedToolCallId !== nextActivity.toolCallId) {
			this.focusedToolCallId = nextActivity.toolCallId;
			this.notify();
		}
		return nextActivity;
	}

	scrollDetail(toolCallId: string | undefined, deltaRows: number): number {
		if (!toolCallId || deltaRows === 0) return toolCallId ? this.getDetailScrollOffset(toolCallId) : 0;
		const current = this.getDetailScrollOffset(toolCallId);
		const next = Math.min(MAX_DETAIL_SCROLL_OFFSET_ROWS, Math.max(0, current + Math.trunc(deltaRows)));
		if (next !== current) {
			if (next === 0) this.detailScrollOffsets.delete(toolCallId);
			else this.detailScrollOffsets.set(toolCallId, next);
			this.notify();
		}
		return next;
	}

	scrollDetailUp(toolCallId: string | undefined, rows = DETAIL_SCROLL_STEP_ROWS): number {
		return this.scrollDetail(toolCallId, Math.abs(rows));
	}

	scrollDetailDown(toolCallId: string | undefined, rows = DETAIL_SCROLL_STEP_ROWS): number {
		return this.scrollDetail(toolCallId, -Math.abs(rows));
	}

	getDetailScrollOffset(toolCallId: string | undefined): number {
		if (!toolCallId) return 0;
		return this.detailScrollOffsets.get(toolCallId) ?? 0;
	}

	resolveDetailScrollOffset(toolCallId: string | undefined, offsetRows: number): void {
		if (!toolCallId) return;
		const next = Math.max(0, Math.floor(offsetRows));
		if (next === 0) this.detailScrollOffsets.delete(toolCallId);
		else this.detailScrollOffsets.set(toolCallId, next);
	}

	getFocusedActivity(activities: MastraAgentActivity[]): MastraAgentActivity | undefined {
		const focusable = visibleWidgetActivities(activities);
		return focusable.find((activity) => activity.toolCallId === this.focusedToolCallId) ?? focusable.at(-1);
	}

	syncActivities(activities: MastraAgentActivity[]): void {
		const visibleIds = new Set(visibleWidgetActivities(activities).map((activity) => activity.toolCallId));
		let changed = false;
		if (this.focusedToolCallId !== undefined && !visibleIds.has(this.focusedToolCallId)) {
			this.focusedToolCallId = undefined;
			changed = true;
		}
		for (const toolCallId of this.detailScrollOffsets.keys()) {
			if (!visibleIds.has(toolCallId)) {
				this.detailScrollOffsets.delete(toolCallId);
				changed = true;
			}
		}
		if (changed) this.notify();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}

type MastraWidgetRenderReason = "external" | "store";
type MastraWidgetRenderMode = "empty" | "list" | "cards" | "detail" | "compact";
type MastraWidgetTUI = Pick<PiTUI, "requestRender"> & {
	terminal?: {
		rows?: number;
	};
};

interface MastraWidgetLineBudget {
	configuredMaxLines: number;
	effectiveMaxLines: number;
	terminalRows?: number;
	reservedRows: number;
	spacerRows: number;
	viewportBudget?: number;
}

interface MastraWidgetRenderMetrics {
	renderMode: MastraWidgetRenderMode;
	totalActivities: number;
	workingActivities: number;
	hiddenQueuedActivities: number;
	visibleCards: number;
	overflowCards: number;
}

interface MastraWidgetDebugEntry extends MastraWidgetLineBudget, MastraWidgetRenderMetrics {
	renderReason: MastraWidgetRenderReason;
	renderedLines: number;
	occupiedRows: number;
	clamped: boolean;
}

export class MastraAgentsWidget implements Component {
	private readonly unsubscribeStore: () => void;
	private readonly unsubscribeViewController: () => void;
	private visibleToolCallIds: string[] = [];
	private renderReason: MastraWidgetRenderReason = "external";

	constructor(
		private readonly tui: MastraWidgetTUI,
		private readonly theme: Theme,
		private readonly store: MastraAgentActivityStore,
		private readonly options: MastraAgentsWidgetOptions = {},
	) {
		this.unsubscribeStore = this.store.subscribe(() => this.requestRender("store"));
		this.unsubscribeViewController = this.options.viewController?.subscribe(() => this.requestRender("store")) ?? (() => undefined);
	}

	render(width: number): string[] {
		if (width < 12) return [];
		const activities = this.store.snapshot();
		const orderedActivities = visibleWidgetActivities(activities);
		const hiddenQueuedActivities = activities.filter((activity) => activity.lifecycleStatus === "agent_response_queued").length;
		const viewMode = this.options.viewController?.getMode() ?? "cards";
		if (viewMode === "list") {
			const listOptions = { ...this.options, maxLines: this.options.listMaxLines ?? DEFAULT_WIDGET_LIST_MAX_LINES };
			const lineBudget = resolveWidgetLineBudget(listOptions, this.tui.terminal?.rows);
			if (orderedActivities.length === 0) {
				this.visibleToolCallIds = [];
				return this.finishRender([], lineBudget, {
					renderMode: "empty",
					totalActivities: activities.length,
					workingActivities: 0,
					hiddenQueuedActivities,
					visibleCards: 0,
					overflowCards: 0,
				});
			}

			const result = renderCompactActivityList(orderedActivities, lineBudget.effectiveMaxLines, width, this.theme, resolveListMaxAgents(this.options));
			this.visibleToolCallIds = result.visibleCount > 0 ? orderedActivities.slice(-result.visibleCount).map((activity) => activity.toolCallId) : [];
			return this.finishRender(result.lines, lineBudget, {
				renderMode: "list",
				totalActivities: activities.length,
				workingActivities: orderedActivities.length,
				hiddenQueuedActivities,
				visibleCards: result.visibleCount,
				overflowCards: result.hiddenCount,
			});
		}
		const lineBudget = resolveWidgetLineBudget(this.options, this.tui.terminal?.rows);
		if (orderedActivities.length === 0) {
			this.visibleToolCallIds = [];
			return this.finishRender([], lineBudget, {
				renderMode: "empty",
				totalActivities: activities.length,
				workingActivities: 0,
				hiddenQueuedActivities,
				visibleCards: 0,
				overflowCards: 0,
			});
		}

		const maxLines = lineBudget.effectiveMaxLines;
		if (maxLines <= 0) {
			this.visibleToolCallIds = [];
			return this.finishRender([], lineBudget, {
				renderMode: "empty",
				totalActivities: activities.length,
				workingActivities: orderedActivities.length,
				hiddenQueuedActivities,
				visibleCards: 0,
				overflowCards: 0,
			});
		}
		const th = this.theme;

		if (viewMode === "detail") return this.renderDetail(orderedActivities, maxLines, width, lineBudget, activities.length, hiddenQueuedActivities);

		const running = orderedActivities.filter((activity) => activity.lifecycleStatus === "working");
		const maxCards = Math.max(1, Math.floor(this.options.maxCards ?? DEFAULT_WIDGET_MAX_CARDS));
		const visibleCards = this.selectVisibleCards(orderedActivities, maxCards, maxLines);
		if (visibleCards.length > 0 && maxLines >= 5) {
			const extra = Math.max(0, orderedActivities.length - visibleCards.length);
			const gapLines = Math.max(0, visibleCards.length - 1);
			const minimumCardLines = visibleCards.length * 5 + gapLines;
			const showOverflow = extra > 0 && minimumCardLines + 1 <= maxLines;
			const overflowLines = showOverflow ? 1 : 0;
			const availableForCards = Math.max(visibleCards.length * 5, maxLines - gapLines - overflowLines);
			const baseCardTotalLines = Math.max(5, Math.floor(availableForCards / visibleCards.length));
			const remainderLines = Math.max(0, availableForCards - baseCardTotalLines * visibleCards.length);
			const lines: string[] = [];

			if (showOverflow) lines.push(truncateToWidth(th.fg("dim", `+${extra} more`), width));

			for (let i = 0; i < visibleCards.length; i++) {
				const activity = visibleCards[i];
				const fixedTotalLines = baseCardTotalLines + (i >= visibleCards.length - remainderLines ? 1 : 0);
				const bodyLines = Math.max(0, fixedTotalLines - 2);
				const maxBodyLines = Math.max(0, Math.min(this.options.cardBodyLines ?? bodyLines, bodyLines));
				const cardLines = new MastraAgentCard(
					activity.details,
					{ isPartial: activity.lifecycleStatus === "working" && activity.status === "running", expanded: false, fixedTotalLines, maxBodyLines },
					th,
				).render(width);
				if (cardLines.length === 0) continue;
				if (lines.length > 0 && !(showOverflow && i === 0)) lines.push("");
				lines.push(...cardLines);
			}

			if (lines.length > 0) {
				return this.finishRender(lines.slice(0, maxLines), lineBudget, {
					renderMode: "cards",
					totalActivities: activities.length,
					workingActivities: orderedActivities.length,
					hiddenQueuedActivities,
					visibleCards: visibleCards.length,
					overflowCards: extra,
				});
			}
		}

		// Fallback: compact list.
		const allActivities = orderedActivities;
		const lines: string[] = [];
		const titleIcon = running.length > 0 ? th.fg("accent", "●") : th.fg("success", "✓");
		const title = `${titleIcon} ${th.bold("Mastra Agents")} ${th.fg("dim", `${running.length} running · ${orderedActivities.length} visible`)}`;
		lines.push(truncateToWidth(title, width));

		const visibleActivities = allActivities.slice(0, Math.max(0, maxLines - 2));
		for (let i = 0; i < visibleActivities.length; i++) {
			const activity = visibleActivities[i];
			const isLast = i === visibleActivities.length - 1 && orderedActivities.length <= visibleActivities.length;
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

		if (orderedActivities.length > visibleActivities.length) {
			lines.unshift(truncateToWidth(th.fg("dim", `+${orderedActivities.length - visibleActivities.length} more`), width));
		}

		return this.finishRender(lines.slice(0, maxLines), lineBudget, {
			renderMode: "compact",
			totalActivities: activities.length,
			workingActivities: orderedActivities.length,
			hiddenQueuedActivities,
			visibleCards: 0,
			overflowCards: Math.max(0, orderedActivities.length - visibleActivities.length),
		});
	}

	invalidate(): void {
		// No cached rendering state.
	}

	dispose(): void {
		this.unsubscribeStore();
		this.unsubscribeViewController();
	}

	private selectVisibleCards(orderedActivities: MastraAgentActivity[], maxCards: number, maxLines: number): MastraAgentActivity[] {
		const minCardLines = 5;
		let visibleCount = Math.min(maxCards, orderedActivities.length);
		while (visibleCount > 1) {
			const hiddenCount = orderedActivities.length - visibleCount;
			const overflowLines = hiddenCount > 0 ? 1 : 0;
			const gapLines = visibleCount - 1;
			if (visibleCount * minCardLines + gapLines + overflowLines <= maxLines) break;
			visibleCount -= 1;
		}
		const visibleCards = orderedActivities.slice(-visibleCount);
		this.visibleToolCallIds = visibleCards.map((activity) => activity.toolCallId);
		return visibleCards;
	}

	private renderDetail(
		orderedActivities: MastraAgentActivity[],
		maxLines: number,
		width: number,
		lineBudget: MastraWidgetLineBudget,
		totalActivities: number,
		hiddenQueuedActivities: number,
	): string[] {
		const th = this.theme;
		const activity = this.options.viewController?.getFocusedActivity(orderedActivities) ?? orderedActivities.at(-1);
		if (!activity) {
			this.visibleToolCallIds = [];
			return this.finishRender([], lineBudget, {
				renderMode: "empty",
				totalActivities,
				workingActivities: 0,
				hiddenQueuedActivities,
				visibleCards: 0,
				overflowCards: 0,
			});
		}

		this.visibleToolCallIds = [activity.toolCallId];
		const position = Math.max(0, orderedActivities.findIndex((candidate) => candidate.toolCallId === activity.toolCallId)) + 1;
		const streamOnly = this.options.viewController?.isDetailStreamOnly() ?? false;
		const scrollOffset = this.options.viewController?.getDetailScrollOffset(activity.toolCallId) ?? 0;
		const renderHeader = (effectiveScrollOffset: number) => {
			const headerParts = [
				`${position}/${orderedActivities.length}`,
				formatActivityStatusLabel(activity),
				activity.modeId ? `mode=${activity.modeId}` : undefined,
				streamOnly ? "stream-only" : undefined,
				effectiveScrollOffset > 0 ? `scroll +${effectiveScrollOffset}` : undefined,
			].filter(Boolean);
			return truncateToWidth(
				`${activityIcon(activity, th)} ${th.bold("Mastra Agent")} ${th.fg("accent", activity.agentId)} ${th.fg("dim", headerParts.join(" · "))}`,
				width,
			);
		};
		const header = renderHeader(0);
		if (maxLines <= 1) {
			return this.finishRender([header].slice(0, maxLines), lineBudget, {
				renderMode: "detail",
				totalActivities,
				workingActivities: orderedActivities.length,
				hiddenQueuedActivities,
				visibleCards: 1,
				overflowCards: Math.max(0, orderedActivities.length - 1),
			});
		}
		if (maxLines <= 3) {
			const compactLine = truncateToWidth(th.fg("muted", activity.lastEvent || textTail(activity.text, 120) || formatActivityStatusLabel(activity)), width);
			return this.finishRender([header, compactLine].slice(0, maxLines), lineBudget, {
				renderMode: "detail",
				totalActivities,
				workingActivities: orderedActivities.length,
				hiddenQueuedActivities,
				visibleCards: 1,
				overflowCards: Math.max(0, orderedActivities.length - 1),
			});
		}
		const fixedTotalLines = Math.max(2, maxLines - 1);
		const maxBodyLines = Math.max(0, fixedTotalLines - 2);
		let resolvedScrollOffset = 0;
		const cardLines = new MastraAgentCard(
			activity.details,
			{
				isPartial: activity.lifecycleStatus === "working" && activity.status === "running",
				expanded: true,
				fixedTotalLines,
				maxBodyLines,
				streamOnly,
				scrollOffset,
				onScrollOffsetResolved: (offset) => {
					resolvedScrollOffset = offset;
					this.options.viewController?.resolveDetailScrollOffset(activity.toolCallId, offset);
				},
			},
			th,
		).render(width);
		return this.finishRender([renderHeader(resolvedScrollOffset), ...cardLines].slice(0, maxLines), lineBudget, {
			renderMode: "detail",
			totalActivities,
			workingActivities: orderedActivities.length,
			hiddenQueuedActivities,
			visibleCards: 1,
			overflowCards: Math.max(0, orderedActivities.length - 1),
		});
	}

	private requestRender(reason: MastraWidgetRenderReason): void {
		this.renderReason = reason;
		this.tui.requestRender();
	}

	private finishRender(lines: string[], lineBudget: MastraWidgetLineBudget, metrics: MastraWidgetRenderMetrics): string[] {
		logWidgetDebug(
			{
				...lineBudget,
				...metrics,
				renderReason: this.renderReason,
				renderedLines: lines.length,
				occupiedRows: lines.length + lineBudget.spacerRows,
				clamped: lineBudget.viewportBudget !== undefined && lineBudget.viewportBudget < lineBudget.configuredMaxLines,
			},
			this.options,
		);
		this.renderReason = "external";
		return lines;
	}
}

export class MastraAgentsListWidget implements Component {
	private readonly unsubscribeStore: () => void;
	private readonly unsubscribeViewController: () => void;
	private renderReason: MastraWidgetRenderReason = "external";

	constructor(
		private readonly tui: MastraWidgetTUI,
		private readonly theme: Theme,
		private readonly store: MastraAgentActivityStore,
		private readonly options: MastraAgentsWidgetOptions = {},
	) {
		this.unsubscribeStore = this.store.subscribe(() => this.requestRender("store"));
		this.unsubscribeViewController = this.options.viewController?.subscribe(() => this.requestRender("store")) ?? (() => undefined);
	}

	render(width: number): string[] {
		if (width < 12) return [];
		const listOptions = { ...this.options, maxLines: this.options.listMaxLines ?? DEFAULT_WIDGET_LIST_MAX_LINES };
		const lineBudget = resolveWidgetLineBudget(listOptions, this.tui.terminal?.rows);
		const viewMode = this.options.viewController?.getMode() ?? "list";
		const allActivities = this.store.snapshot();
		const activities = visibleWidgetActivities(allActivities);
		const hiddenQueuedActivities = allActivities.filter((activity) => activity.lifecycleStatus === "agent_response_queued").length;
		if (viewMode !== "list" || activities.length === 0) {
			return this.finishRender([], lineBudget, {
				renderMode: "empty",
				totalActivities: allActivities.length,
				workingActivities: activities.length,
				hiddenQueuedActivities,
				visibleCards: 0,
				overflowCards: 0,
			});
		}

		const result = renderCompactActivityList(activities, lineBudget.effectiveMaxLines, width, this.theme, resolveListMaxAgents(this.options));
		return this.finishRender(result.lines, lineBudget, {
			renderMode: "list",
			totalActivities: allActivities.length,
			workingActivities: activities.length,
			hiddenQueuedActivities,
			visibleCards: result.visibleCount,
			overflowCards: result.hiddenCount,
		});
	}

	invalidate(): void {
		// No cached rendering state.
	}

	dispose(): void {
		this.unsubscribeStore();
		this.unsubscribeViewController();
	}

	private requestRender(reason: MastraWidgetRenderReason): void {
		this.renderReason = reason;
		this.tui.requestRender();
	}

	private finishRender(lines: string[], lineBudget: MastraWidgetLineBudget, metrics: MastraWidgetRenderMetrics): string[] {
		logWidgetDebug(
			{
				...lineBudget,
				...metrics,
				renderReason: this.renderReason,
				renderedLines: lines.length,
				occupiedRows: lines.length + lineBudget.spacerRows,
				clamped: lineBudget.viewportBudget !== undefined && lineBudget.viewportBudget < lineBudget.configuredMaxLines,
			},
			this.options,
		);
		this.renderReason = "external";
		return lines;
	}
}

function resolveWidgetLineBudget(options: MastraAgentsWidgetOptions, terminalRows?: number): MastraWidgetLineBudget {
	const configuredMaxLines = Math.max(MIN_WIDGET_LINES, positiveInteger(options.maxLines) ?? DEFAULT_WIDGET_MAX_LINES);
	const reservedRows = Math.max(0, nonNegativeInteger(options.reservedRows) ?? DEFAULT_WIDGET_RESERVED_ROWS);
	const rows = positiveInteger(terminalRows);
	const contentLinesForTotal = (totalLines: number) => Math.max(0, totalLines - ABOVE_EDITOR_WIDGET_SPACER_LINES);
	if (rows === undefined) {
		return {
			configuredMaxLines,
			effectiveMaxLines: contentLinesForTotal(configuredMaxLines),
			reservedRows,
			spacerRows: ABOVE_EDITOR_WIDGET_SPACER_LINES,
		};
	}

	const viewportBudget = Math.max(MIN_WIDGET_LINES, rows - reservedRows);
	const totalBudget = Math.min(configuredMaxLines, viewportBudget);
	return {
		configuredMaxLines,
		effectiveMaxLines: contentLinesForTotal(totalBudget),
		terminalRows: rows,
		reservedRows,
		spacerRows: ABOVE_EDITOR_WIDGET_SPACER_LINES,
		viewportBudget,
	};
}

function visibleWidgetActivities(activities: MastraAgentActivity[]): MastraAgentActivity[] {
	return activities
		.filter((activity) => activity.lifecycleStatus === "working")
		.sort((a, b) => a.order - b.order);
}

function renderCompactActivityList(
	activities: MastraAgentActivity[],
	maxLines: number,
	width: number,
	theme: Theme,
	maxAgents = DEFAULT_WIDGET_LIST_MAX_AGENTS,
): { lines: string[]; visibleCount: number; hiddenCount: number } {
	const running = activities.filter((activity) => activity.lifecycleStatus === "working");
	const titleIcon = running.length > 0 ? theme.fg("accent", "●") : theme.fg("success", "✓");
	const titleMeta = running.length > 0 ? `${running.length} working` : `${activities.length} visible`;
	const lines = [truncateToWidth(`${titleIcon} ${theme.bold("Mastra Agents")} ${theme.fg("dim", titleMeta || `${activities.length} visible`)}`, width)];
	if (maxLines <= 1) return { lines: lines.slice(0, maxLines), visibleCount: 0, hiddenCount: activities.length };

	let visibleCount = Math.min(activities.length, Math.max(1, Math.floor(maxAgents)));
	let hiddenCount = activities.length - visibleCount;
	while (visibleCount > 0) {
		hiddenCount = activities.length - visibleCount;
		const requiredLines = 1 + (hiddenCount > 0 ? 1 : 0) + visibleCount * 3;
		if (requiredLines <= maxLines) break;
		visibleCount -= 1;
	}
	hiddenCount = activities.length - visibleCount;
	if (hiddenCount > 0) lines.push(truncateToWidth(theme.fg("dim", `├─ +${hiddenCount} more`), width));

	const visibleActivities = visibleCount > 0 ? activities.slice(-visibleCount) : [];
	for (let i = 0; i < visibleActivities.length; i++) {
		const activity = visibleActivities[i];
		const isLast = i === visibleActivities.length - 1;
		const branch = isLast ? "└─" : "├─";
		const child = isLast ? "   " : "│  ";
		lines.push(truncateToWidth(`${theme.fg("dim", branch)} ${formatActivityHeadline(activity, theme)}`, width));
		lines.push(truncateToWidth(`${theme.fg("dim", child + "├ tools ")}${theme.fg("muted", formatActivityToolStream(activity, theme, width))}`, width));
		const output = activity.errors[0]
			? `error: ${activity.errors[activity.errors.length - 1]}`
			: textTail(activity.text, 110) || (activity.prompt ? `prompt: ${textHead(activity.prompt, 90)}` : formatActivityStatusLabel(activity));
		lines.push(truncateToWidth(`${theme.fg("dim", child + "└ now ")}${theme.fg(activity.errors.length > 0 ? "error" : "muted", output)}`, width));
	}

	return { lines, visibleCount, hiddenCount };
}

function resolveListMaxAgents(options: MastraAgentsWidgetOptions): number {
	return Math.max(1, positiveInteger(options.listMaxAgents) ?? DEFAULT_WIDGET_LIST_MAX_AGENTS);
}

function formatActivityToolStream(activity: MastraAgentActivity, theme: Theme, width: number): string {
	const events = compactToolEvents(recentToolEvents(activity.details, 3));
	if (events.length === 0) return activity.lastEvent || "waiting for tool events";
	const previewWidth = Math.max(24, Math.floor(width / 2));
	return events.map((event) => formatToolEvent(event, theme, previewWidth)).join(theme.fg("dim", " · "));
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function logWidgetDebug(entry: MastraWidgetDebugEntry, options: MastraAgentsWidgetOptions): void {
	const enabled = options.debug === true || process.env.MASTRA_WIDGET_DEBUG === "1" || process.env.MASTRA_WIDGET_DEBUG === "true";
	if (!enabled) return;
	const logPath = options.debugLogPath ?? process.env.MASTRA_WIDGET_DEBUG_PATH ?? join(homedir(), ".pi", "agent", "mastra-widget-debug.log");
	const fields = [
		`ts=${new Date().toISOString()}`,
		`reason=${entry.renderReason}`,
		`mode=${entry.renderMode}`,
		`terminalRows=${entry.terminalRows ?? "unknown"}`,
		`reservedRows=${entry.reservedRows}`,
		`configuredMaxLines=${entry.configuredMaxLines}`,
		`effectiveMaxLines=${entry.effectiveMaxLines}`,
		`spacerRows=${entry.spacerRows}`,
		`viewportBudget=${entry.viewportBudget ?? "unknown"}`,
		`renderedLines=${entry.renderedLines}`,
		`occupiedRows=${entry.occupiedRows}`,
		`totalActivities=${entry.totalActivities}`,
		`workingActivities=${entry.workingActivities}`,
		`hiddenQueuedActivities=${entry.hiddenQueuedActivities}`,
		`visibleCards=${entry.visibleCards}`,
		`overflowCards=${entry.overflowCards}`,
		`clamped=${entry.clamped}`,
	];

	try {
		mkdirSync(dirname(logPath), { recursive: true });
		appendFileSync(logPath, `${fields.join(" ")}\n`, "utf8");
	} catch {
		// Debug logging must not break the interactive terminal.
	}
}

export interface MastraAgentCardOptions {
	expanded?: boolean;
	isPartial?: boolean;
	/** In expanded detail mode, hide prompt and reasoning so only live stream content remains. */
	streamOnly?: boolean;
	/** Number of rows to move upward from the live tail in expanded detail mode. */
	scrollOffset?: number;
	/** Receives the content-clamped scroll offset used by the rendered card body. */
	onScrollOffsetResolved?: (offsetRows: number) => void;
	/** Optional body budget used by the async widget to stack multiple cards. */
	maxBodyLines?: number;
	/** Optional total card height. Short content is padded inside the card frame. */
	fixedTotalLines?: number;
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
		const elapsed = this.details.completedAt ? formatElapsed(this.details.startedAt, this.details.completedAt) : undefined;
		const meta = [
			this.options.isPartial ? "running" : this.details.status,
			elapsed,
			`${this.details.toolCalls.length + this.details.toolResults.length} tools`,
			formatUsage(this.details.usage),
		]
			.filter(Boolean)
			.join(" ─ ");
		lines.push(renderTopBorder(width, topLabel, meta, border));

		const pinnedBodyLines: string[] = [];
		const prompt = this.details.prompt?.trim();
		if (prompt && !this.options.streamOnly) {
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

		const text = filterPromptScaffolding(this.details.text.trim()) || (this.options.isPartial ? "streaming…" : "(no text output)");
		const textLimit = this.options.expanded ? 8_000 : 1_500;
		if (bodyLines.length > 0) bodyLines.push("");
		bodyLines.push(th.fg("muted", "Output"));
		bodyLines.push(...renderMarkdownLines(markdownTail(text, textLimit), innerWidth));

		if (this.details.reasoning && this.options.expanded && !this.options.streamOnly) {
			bodyLines.push("");
			bodyLines.push(th.fg("muted", "Reasoning"));
			bodyLines.push(...renderMarkdownLines(markdownTail(this.details.reasoning, 4_000), innerWidth, { color: (value) => th.fg("dim", value), italic: true }));
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
			this.details.terminalReason ? `terminal ${this.details.terminalReason}` : undefined,
			this.details.incomplete ? "incomplete" : undefined,
			this.details.chunksTruncated ? "truncated" : undefined,
		].filter(Boolean);
		if (footerParts.length > 0) {
			bodyLines.push(th.fg("dim", footerParts.join(" · ")));
		}

		if (pinnedBodyLines.length > 0 && bodyLines.length > 0) pinnedBodyLines.push("");
		const fixedTotalLines = positiveInteger(this.options.fixedTotalLines);
		const fixedBodyLines = fixedTotalLines !== undefined ? Math.max(0, fixedTotalLines - 2) : undefined;
		const bodyLimit = fixedBodyLines ?? this.options.maxBodyLines ?? (this.options.expanded ? EXPANDED_CARD_BODY_LINES : COLLAPSED_CARD_BODY_LINES);
		const remainingBodyLimit = Math.max(0, bodyLimit - pinnedBodyLines.length);
		const scrollOffset = this.options.expanded ? nonNegativeInteger(this.options.scrollOffset) ?? 0 : 0;
		const viewport =
			remainingBodyLimit > 0
				? sliceViewportLines(bodyLines, remainingBodyLimit, scrollOffset, th)
				: sliceViewportLines(pinnedBodyLines, bodyLimit, scrollOffset, th);
		this.options.onScrollOffsetResolved?.(viewport.offset);
		const scrolledBody = remainingBodyLimit > 0 ? [...pinnedBodyLines, ...viewport.lines] : viewport.lines;
		const framedBody =
			fixedBodyLines !== undefined && scrolledBody.length < fixedBodyLines
				? [...scrolledBody, ...Array.from({ length: fixedBodyLines - scrolledBody.length }, () => "")]
				: scrolledBody;
		for (const bodyLine of framedBody) {
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
	lifecycleStatus?: Exclude<MastraAgentLifecycleStatus, "available">,
	orderOverride?: number,
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
		lifecycleStatus: lifecycleStatus ?? previous?.lifecycleStatus ?? (details.status === "running" ? "working" : "agent_response_queued"),
		order: previous?.order ?? orderOverride ?? now,
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
	const elapsed = activity.completedAt ? formatElapsed(activity.startedAt, activity.completedAt) : undefined;
	const meta = [
		activity.status,
		elapsed,
		activity.toolCalls + activity.toolResults > 0 ? `${activity.toolCalls + activity.toolResults} tools` : undefined,
		formatUsage(activity.usage),
		activity.modeId ? `mode=${activity.modeId}` : undefined,
	]
		.filter(Boolean)
		.join(" · ");
	return `${icon} ${theme.fg("accent", activity.agentId)} ${theme.fg("dim", meta)}`;
}

function formatActivityStatusLabel(activity: MastraAgentActivity): string {
	if (activity.lifecycleStatus === "agent_response_queued") return "agent_response_queued";
	if (activity.status === "running") return "working";
	return activity.status;
}

function activityIcon(activity: MastraAgentActivity, theme: Theme): string {
	if (activity.status === "running") return theme.fg("accent", "●");
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
	const renderedOutput = renderMarkdownLines(markdownTail(output, 3_000), Math.max(1, width - 4));
	for (const line of renderedOutput.slice(0, 12)) {
		lines.push(truncateToWidth(`${theme.fg("dim", "  ⎿ ")}${line}`, width));
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

function renderMarkdownLines(markdown: string, width: number, defaultTextStyle?: DefaultTextStyle): string[] {
	try {
		return new Markdown(markdown, 0, 0, getMarkdownTheme(), defaultTextStyle).render(width);
	} catch {
		try {
			return new Markdown(markdown, 0, 0, FALLBACK_MARKDOWN_THEME, defaultTextStyle).render(width);
		} catch {
			return wrapTextWithAnsi(markdown, width);
		}
	}
}

function sliceViewportLines(lines: string[], limit: number, scrollOffset: number, theme: Theme): { lines: string[]; offset: number } {
	if (limit <= 0) return { lines: [], offset: 0 };
	if (lines.length <= limit) return { lines, offset: 0 };
	const maxOffset = Math.max(0, lines.length - limit);
	const offset = Math.min(Math.max(0, Math.floor(scrollOffset)), maxOffset);
	const end = Math.max(limit, lines.length - offset);
	const start = Math.max(0, end - limit);
	const visible = lines.slice(start, end);
	const hiddenBefore = start;
	const hiddenAfter = Math.max(0, lines.length - end);
	if (hiddenBefore > 0 && visible.length > 0) {
		visible[0] = theme.fg("dim", `… ${hiddenBefore} earlier lines`);
	}
	if (hiddenAfter > 0 && visible.length > 0) {
		visible[visible.length - 1] = theme.fg("dim", `… ${hiddenAfter} later lines`);
	}
	return { lines: visible, offset };
}

function headLines(lines: string[], limit: number, theme: Theme): string[] {
	if (lines.length <= limit) return lines;
	const kept = Math.max(1, limit - 1);
	return [...lines.slice(0, kept), theme.fg("dim", `… ${lines.length - kept} more prompt lines`)];
}

function renderPromptLines(prompt: string, width: number, expanded: boolean, theme: Theme): string[] {
	const maxChars = expanded ? 2_000 : 500;
	const maxLines = expanded ? EXPANDED_PROMPT_LINES : COLLAPSED_PROMPT_LINES;
	const trimmed = filterPromptScaffolding(prompt).trim();
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
	const filtered = filterPromptScaffolding(text);
	return filtered.length <= maxChars ? filtered : `${filtered.slice(0, Math.max(0, maxChars - 1))}…`;
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
