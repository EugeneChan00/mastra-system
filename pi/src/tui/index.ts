import { getMarkdownTheme, type Theme, type ThemeColor } from "@mariozechner/pi-coding-agent";
import type { Component, TUI as PiTUI } from "@mariozechner/pi-tui";
import { Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import type { MastraAgentCallDetails, MastraAgentCallInput, MastraToolEvent, MastraUsage } from "../mastra/types.js";

const DEFAULT_WIDGET_MAX_LINES = 10;
const COLLAPSED_CARD_BODY_LINES = 18;
const EXPANDED_CARD_BODY_LINES = 60;
const DEFAULT_ACTIVITY_LINGER_MS = 12_000;
const ERROR_ACTIVITY_LINGER_MS = 30_000;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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
	lastEvent?: string;
	toolCalls: number;
	toolResults: number;
	usage?: MastraUsage;
	errors: string[];
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

	start(toolCallId: string, _params: MastraAgentCallInput, details: MastraAgentCallDetails): void {
		this.activities.set(toolCallId, activityFromDetails(toolCallId, details));
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
	maxLines?: number;
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

		const maxLines = Math.max(3, this.options.maxLines ?? DEFAULT_WIDGET_MAX_LINES);
		const running = activities.filter((activity) => activity.status === "running").length;
		const th = this.theme;
		const lines: string[] = [];
		const titleIcon = running > 0 ? th.fg("accent", "●") : th.fg("success", "✓");
		const title = `${titleIcon} ${th.bold("Mastra Agents")} ${th.fg("dim", `${running} running · ${activities.length} visible`)}`;
		lines.push(truncateToWidth(title, width));

		const visibleActivities = activities.slice(0, Math.max(0, maxLines - 2));
		for (let i = 0; i < visibleActivities.length; i++) {
			const activity = visibleActivities[i];
			const isLast = i === visibleActivities.length - 1 && activities.length <= visibleActivities.length;
			const branch = isLast ? "└─" : "├─";
			lines.push(truncateToWidth(`${th.fg("dim", branch)} ${formatActivityHeadline(activity, th)}`, width));
			const tail = activity.errors[0] ? `error: ${activity.errors[activity.errors.length - 1]}` : activity.lastEvent || textTail(activity.text, 90) || "thinking…";
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

		const bodyLimit = this.options.expanded ? EXPANDED_CARD_BODY_LINES : COLLAPSED_CARD_BODY_LINES;
		const scrolledBody = tailLines(bodyLines, bodyLimit, th);
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
		lastEvent,
		toolCalls: details.toolCalls.length,
		toolResults: details.toolResults.length,
		usage: details.usage,
		errors: [...details.errors],
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
	const name = theme.fg("accent", event.name ?? event.id ?? "tool");
	const detail = toolEventDetail(event);
	const preview = detail === undefined ? "" : ` ${theme.fg("dim", previewValue(detail, previewWidth))}`;
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
	const name = theme.fg("accent", event.name ?? event.id ?? "tool");
	const prefix = `${icon} ${name}`;
	const detail = toolEventDetail(event);
	if (detail === undefined) return [truncateToWidth(prefix, width)];

	if (!expanded) {
		const remaining = Math.max(20, width - visibleWidth(prefix) - 1);
		return wrapTextWithAnsi(`${prefix} ${theme.fg("dim", previewValue(detail, remaining))}`, width);
	}

	const pretty = prettyValue(detail, 2_000);
	if (!pretty.includes("\n")) {
		return wrapTextWithAnsi(`${prefix} ${theme.fg("dim", pretty)}`, width);
	}

	const lines = [truncateToWidth(prefix, width)];
	for (const line of pretty.split("\n").slice(0, 24)) {
		lines.push(truncateToWidth(theme.fg("dim", `  ${line}`), width));
	}
	return lines;
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
			text = JSON.stringify(value, null, 2);
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
