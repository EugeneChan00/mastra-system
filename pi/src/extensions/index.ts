import { CustomEditor, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type KeybindingsManager, type ThemeColor } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, type EditorTheme, type KeyId, type TUI as PiTUI } from "@mariozechner/pi-tui";
import { MASTRA_AGENT_RESULT_MESSAGE_TYPE, MASTRA_STATUS_KEY } from "../const.js";
import { createHarnessModeMessage, createHarnessModeState, formatHarnessModeStatus, getHarnessModeDefinition, isHarnessMode, type HarnessMode } from "../harness/mode.js";
import { MastraAsyncAgentManager, MastraHttpClient, createMastraTools } from "../mastra/index.js";
import { createPiAgentStartupContextMessage } from "../prompts/index.js";
import { MastraAgentActivityStore, MastraAgentsWidget, MastraAgentsWidgetViewController, type MastraAgentsViewMode } from "../tui/index.js";
import type { MastraAgentAsyncJobSummary, MastraAgentInfo, MastraWorkflowInfo, MastraWorkflowRun } from "../mastra/index.js";
import { loadMastraAgentExtensionConfig, type MastraAgentExtensionShortcuts } from "./config.js";

const MASTRA_AGENT_WIDGET_ID = "mastra-agents";
const LEGACY_MASTRA_AGENT_WIDGET_IDS = [MASTRA_AGENT_WIDGET_ID, "mastra-agents-list", "mastra-agents-region"] as const;
const HARNESS_MODE_STATUS_KEY = "harness-mode";
const PI_HARNESS_MODE_STATE_ENTRY_TYPE = "pi-harness-mode-state";

export default function mastraPiExtension(pi: ExtensionAPI) {
	const client = new MastraHttpClient();
	const activityStore = new MastraAgentActivityStore();
	const viewController = new MastraAgentsWidgetViewController();
	const harnessMode = createHarnessModeState();
	const startupPromptState = createStartupPromptState();
	const harnessModePromptMonitor = createHarnessModePromptMonitor();
	const asyncAgentManager = new MastraAsyncAgentManager(client, {
		activitySink: activityStore,
		useWorkflowJobs: true,
		onComplete: (summary) => {
			// Live deltas stay in MastraAgentsWidget; only the final summary becomes a
			// transcript reminder. "steer" queues it as a system reminder as soon as
			// Pi can accept context between tool calls; message_end is the ack that
			// collapses the card.
			pi.sendMessage(
				{
					customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE,
					content: formatAsyncAgentCompletion(summary),
					display: true,
					details: summary,
				},
				{ deliverAs: "steer", triggerTurn: true },
			);
		},
	});
	let unsubscribeActivityStatus: (() => void) | undefined;
	let unmountMastraWidget: (() => void) | undefined;
	let uninstallMastraWidgetShortcuts: (() => void) | undefined;
	let statusLabel = "offline";

	pi.on("before_agent_start", async () => {
		const message = startupPromptState.nextMessage();
		return message ? { message } : undefined;
	});

	pi.on("before_agent_start", async () => {
		const mode = harnessMode.get();
		const message = harnessModePromptMonitor.nextMessage(mode);
		if (message) persistHarnessModeSessionState(pi, mode, mode);
		return message ? { message } : undefined;
	});

	for (const tool of createMastraTools(client, { agentActivitySink: activityStore, asyncAgentManager })) {
		pi.registerTool(tool as any);
	}

	pi.registerMessageRenderer(MASTRA_AGENT_RESULT_MESSAGE_TYPE, (message, { expanded }, theme) => {
		const summary = message.details as Partial<MastraAgentAsyncJobSummary> | undefined;
		const status = String(summary?.status ?? "done");
		const color = status === "error" || status === "aborted" ? "error" : "success";
		let text = `${theme.fg(color, status === "done" ? "✓" : status === "running" ? "●" : "✗")} ${theme.fg("accent", summary?.agentId ?? "Mastra agent")}`;
		if (summary?.jobId) text += ` ${theme.fg("dim", `job=${summary.jobId}`)}`;
		text += `\n${message.content}`;
		if (expanded && summary) {
			const details = [
				summary.threadId ? `threadId: ${summary.threadId}` : undefined,
				summary.resourceId ? `resourceId: ${summary.resourceId}` : undefined,
				summary.artifactPath ? `artifactPath: ${summary.artifactPath}` : undefined,
				summary.eventsPath ? `eventsPath: ${summary.eventsPath}` : undefined,
			]
				.filter(Boolean)
				.join("\n");
			if (details) text += `\n${theme.fg("dim", details)}`;
		}
		return new Text(text, 0, 0);
	});

	pi.registerCommand("mastra", {
		description: "Mastra bridge status and agent discovery",
		getArgumentCompletions(prefix) {
			return ["status", "agents", "agent", "workflows", "workflow", "run"]
				.filter((value) => value.startsWith(prefix.trim()))
				.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const [subcommand = "status", first, second] = args.trim().split(/\s+/).filter(Boolean);
			if (subcommand === "agents") {
				await showAgents(client, ctx);
				return;
			}
			if (subcommand === "agent" && first) {
				await showAgent(client, first, ctx);
				return;
			}
			if (subcommand === "workflows") {
				await showWorkflows(client, ctx);
				return;
			}
			if (subcommand === "workflow" && first) {
				await showWorkflow(client, first, ctx);
				return;
			}
			if (subcommand === "run" && first && second) {
				await showWorkflowRun(client, first, second, ctx);
				return;
			}
			if (subcommand === "status") {
				await showStatus(client, ctx);
				return;
			}
			ctx.ui.notify("Usage: /mastra status | agents | agent <id> | workflows | workflow <id> | run <workflowId> <runId>", "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		startupPromptState.reset();
		const persistedHarnessMode = readHarnessModeSessionState(ctx.sessionManager.getEntries());
		if (persistedHarnessMode?.selectedMode) harnessMode.set(persistedHarnessMode.selectedMode);
		harnessModePromptMonitor.reset(persistedHarnessMode?.lastSubmittedMode);
		unsubscribeActivityStatus?.();
		uninstallMastraWidgetShortcuts?.();
		unmountMastraWidget?.();
		unmountMastraWidget = undefined;
		uninstallMastraWidgetShortcuts = undefined;
		const piSessionId = ctx.sessionManager.getSessionId();
		asyncAgentManager.configureSession({
			piSessionId,
			cwd: ctx.cwd,
			isCompletionAcknowledged: (jobId) => hasCompletionReminder(ctx.sessionManager.getEntries(), jobId),
		});
		let syncMastraWidget = () => undefined;
		if (ctx.hasUI) {
			const widgetConfig = await loadMastraAgentExtensionConfig(ctx.cwd);
			viewController.reset(widgetConfig.defaultViewMode);
			uninstallMastraWidgetShortcuts = installMastraWidgetTerminalShortcuts(ctx.ui, widgetConfig.shortcuts, viewController, activityStore);
			if (widgetConfig.warning) ctx.ui.notify(widgetConfig.warning, "warning");
			if (widgetConfig.debugPiRedraw && process.env.PI_DEBUG_REDRAW === undefined) process.env.PI_DEBUG_REDRAW = "1";
			syncHarnessModeStatus(ctx, harnessMode.get());
			ctx.ui.setEditorComponent((tui, theme, keybindings) => {
				return new HarnessModeEditor(tui, theme, keybindings, {
					getMode: () => harnessMode.get(),
					cycleMode: () => {
						const mode = harnessMode.cycle();
						persistHarnessModeSessionState(pi, mode, harnessModePromptMonitor.getLastSubmittedMode());
						syncHarnessModeStatus(ctx, mode);
						ctx.ui.notify(formatHarnessModeStatus(mode), "info");
						return mode;
					},
					colorizeMode: (mode, text) => ctx.ui.theme.fg(harnessModeThemeColor(mode), text),
				});
			});
			for (const widgetId of LEGACY_MASTRA_AGENT_WIDGET_IDS) ctx.ui.setWidget(widgetId, undefined);
			let widgetMounted = false;
			const mountWidget = () => {
				if (widgetMounted) return;
				ctx.ui.setWidget(
					MASTRA_AGENT_WIDGET_ID,
					(tui, theme) => new MastraAgentsWidget(tui, theme, activityStore, { ...widgetConfig.options, fixedRegion: true, viewController }),
					{ placement: "aboveEditor" },
				);
				widgetMounted = true;
			};
			const unmountWidget = () => {
				if (!widgetMounted) return;
				ctx.ui.setWidget(MASTRA_AGENT_WIDGET_ID, undefined);
				widgetMounted = false;
			};
			syncMastraWidget = () => {
				if (activityStore.hasVisibleActivity()) mountWidget();
				else unmountWidget();
			};
			unmountMastraWidget = unmountWidget;
			syncMastraWidget();
		}
		unsubscribeActivityStatus = activityStore.subscribe(() => {
			const runningActivities = activityStore.snapshot({ includeFinished: false });
			viewController.syncActivities(runningActivities);
			const running = runningActivities.length;
			syncMastraWidget();
			ctx.ui.setStatus(MASTRA_STATUS_KEY, running > 0 ? `mastra: ${running} running` : `mastra: ${statusLabel}`);
		});

		try {
			const [agents, workflows] = await Promise.all([client.listAgents(), client.listWorkflows()]);
			statusLabel = `${Object.keys(agents).length} agents, ${Object.keys(workflows).length} workflows`;
			if (activityStore.snapshot({ includeFinished: false }).length === 0) ctx.ui.setStatus(MASTRA_STATUS_KEY, `mastra: ${statusLabel}`);
		} catch {
			statusLabel = "offline";
			ctx.ui.setStatus(MASTRA_STATUS_KEY, "mastra: offline");
		}

		void asyncAgentManager.restoreSessionJobs().catch(() => undefined);
	});

	pi.on("message_end", async (event) => {
		const jobId = completionJobIdFromMessageEnd(event);
		if (jobId) asyncAgentManager.markEnded(jobId);
	});

	pi.on("session_shutdown", async () => {
		startupPromptState.reset();
		harnessModePromptMonitor.reset();
		asyncAgentManager.detachAll("Pi session shutdown");
		unmountMastraWidget?.();
		unmountMastraWidget = undefined;
		uninstallMastraWidgetShortcuts?.();
		uninstallMastraWidgetShortcuts = undefined;
		unsubscribeActivityStatus?.();
		unsubscribeActivityStatus = undefined;
	});
}

interface HarnessModeSessionState {
	version: 1;
	selectedMode: HarnessMode;
	lastSubmittedMode?: HarnessMode;
}

function persistHarnessModeSessionState(pi: Pick<ExtensionAPI, "appendEntry">, selectedMode: HarnessMode, lastSubmittedMode: HarnessMode | undefined): void {
	const state: HarnessModeSessionState = {
		version: 1,
		selectedMode,
		...(lastSubmittedMode ? { lastSubmittedMode } : {}),
	};
	pi.appendEntry(PI_HARNESS_MODE_STATE_ENTRY_TYPE, state);
}

function readHarnessModeSessionState(entries: readonly unknown[]): HarnessModeSessionState | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as { type?: unknown; customType?: unknown; data?: unknown } | undefined;
		if (entry?.type !== "custom" || entry.customType !== PI_HARNESS_MODE_STATE_ENTRY_TYPE) continue;
		const data = entry.data as Partial<HarnessModeSessionState> | undefined;
		if (!data || data.version !== 1 || !isHarnessMode(data.selectedMode)) continue;
		return {
			version: 1,
			selectedMode: data.selectedMode,
			...(isHarnessMode(data.lastSubmittedMode) ? { lastSubmittedMode: data.lastSubmittedMode } : {}),
		};
	}
	return undefined;
}

function createStartupPromptState(): {
	reset(): void;
	nextMessage(): ReturnType<typeof createPiAgentStartupContextMessage> | undefined;
} {
	let emitted = false;
	return {
		reset() {
			emitted = false;
		},
		nextMessage() {
			if (emitted) return undefined;
			emitted = true;
			return createPiAgentStartupContextMessage();
		},
	};
}

function createHarnessModePromptMonitor(): {
	reset(lastSubmittedMode?: HarnessMode): void;
	getLastSubmittedMode(): HarnessMode | undefined;
	nextMessage(mode: HarnessMode): ReturnType<typeof createHarnessModeMessage> | undefined;
} {
	// This is checked at user prompt submission boundaries via before_agent_start.
	// UI mode changes while an agent is already running are observed on the next
	// submitted prompt, not as live tool-call-time prompt injections.
	let previousSubmittedMode: HarnessMode | undefined;
	return {
		reset(lastSubmittedMode) {
			previousSubmittedMode = lastSubmittedMode;
		},
		getLastSubmittedMode() {
			return previousSubmittedMode;
		},
		nextMessage(mode) {
			if (previousSubmittedMode === mode) return undefined;
			previousSubmittedMode = mode;
			return createHarnessModeMessage(mode);
		},
	};
}

interface HarnessModeEditorOptions {
	getMode(): HarnessMode;
	cycleMode(): HarnessMode;
	colorizeMode(mode: HarnessMode, text: string): string;
}

class HarnessModeEditor extends CustomEditor {
	constructor(
		tui: PiTUI,
		theme: EditorTheme,
		private readonly harnessKeybindings: KeybindingsManager,
		private readonly options: HarnessModeEditorOptions,
	) {
		super(tui, theme, harnessKeybindings);
	}

	handleInput(data: string): void {
		if (this.harnessKeybindings.matches(data, "app.thinking.cycle")) {
			this.options.cycleMode();
			this.tui.requestRender();
			return;
		}
		super.handleInput(data);
	}

	render(width: number): string[] {
		const previousBorderColor = this.borderColor;
		const mode = this.options.getMode();
		const color = (text: string) => this.options.colorizeMode(mode, text);
		this.borderColor = color;
		try {
			const lines = super.render(width);
			if (lines.length > 0) lines[0] = renderHarnessModeBorder(formatHarnessModeStatus(mode), width, color);
			return lines;
		} finally {
			this.borderColor = previousBorderColor;
		}
	}
}

function renderHarnessModeBorder(label: string, width: number, color: (text: string) => string): string {
	if (width <= 0) return "";
	if (width === 1) return color("─");
	const framedLabel = ` ${label} `;
	const visibleLabel = framedLabel.length > width - 2 ? framedLabel.slice(0, Math.max(0, width - 2)) : framedLabel;
	const remaining = Math.max(0, width - 1 - visibleLabel.length);
	return color(`─${visibleLabel}${"─".repeat(remaining)}`);
}

function syncHarnessModeStatus(ctx: Pick<ExtensionContext, "ui">, mode: HarnessMode): void {
	ctx.ui.setStatus(HARNESS_MODE_STATUS_KEY, ctx.ui.theme.fg(harnessModeThemeColor(mode), formatHarnessModeStatus(mode)));
}

function harnessModeThemeColor(mode: HarnessMode): ThemeColor {
	const highlight = getHarnessModeDefinition(mode).highlightColor;
	if (highlight === "yellow") return "warning";
	if (highlight === "magenta") return "customMessageLabel";
	if (highlight === "cyan") return "accent";
	return "borderAccent";
}

function installMastraWidgetTerminalShortcuts(
	ui: ExtensionCommandContext["ui"],
	shortcuts: MastraAgentExtensionShortcuts,
	viewController: MastraAgentsWidgetViewController,
	activityStore: MastraAgentActivityStore,
): () => void {
	const workingActivities = () => activityStore.snapshot({ includeFinished: false });
	return ui.onTerminalInput((data) => {
		if (matchesMastraWidgetShortcut(data, shortcuts.viewMode)) {
			const activities = workingActivities();
			if (activities.length === 0) return undefined;
			const mode = viewController.cycleMode();
			if (mode === "detail") viewController.focusNext(activities, 0);
			ui.notify(`Mastra agents: ${formatViewMode(mode)}`, "info");
			return { consume: true };
		}

		if (matchesMastraWidgetShortcut(data, shortcuts.nextAgent)) {
			const activities = workingActivities();
			if (activities.length === 0) return undefined;
			viewController.setMode("detail");
			const activity = viewController.focusNext(activities, 1);
			ui.notify(activity ? `Mastra detail: ${activity.agentId}` : "No Mastra agent jobs", "info");
			return { consume: true };
		}

		if (matchesMastraWidgetShortcut(data, shortcuts.previousAgent)) {
			const activities = workingActivities();
			if (activities.length === 0) return undefined;
			viewController.setMode("detail");
			const activity = viewController.focusNext(activities, -1);
			ui.notify(activity ? `Mastra detail: ${activity.agentId}` : "No Mastra agent jobs", "info");
			return { consume: true };
		}

		if (matchesMastraWidgetShortcut(data, shortcuts.detailScrollDown)) {
			const activities = workingActivities();
			if (viewController.getMode() !== "detail" || activities.length === 0) return undefined;
			const activity = viewController.getFocusedActivity(activities);
			const offset = viewController.scrollDetailDown(activity?.toolCallId);
			ui.notify(activity ? `Mastra detail scroll: ${offset === 0 ? "live" : `+${offset}`}` : "No Mastra agent jobs", "info");
			return { consume: true };
		}

		if (matchesMastraWidgetShortcut(data, shortcuts.detailScrollUp)) {
			const activities = workingActivities();
			if (viewController.getMode() !== "detail" || activities.length === 0) return undefined;
			const activity = viewController.getFocusedActivity(activities);
			const offset = viewController.scrollDetailUp(activity?.toolCallId);
			ui.notify(activity ? `Mastra detail scroll: +${offset}` : "No Mastra agent jobs", "info");
			return { consume: true };
		}

		if (matchesMastraWidgetShortcut(data, shortcuts.detailStreamOnly)) {
			const activities = workingActivities();
			if (activities.length === 0) return undefined;
			viewController.setMode("detail");
			viewController.focusNext(activities, 0);
			const enabled = viewController.toggleDetailStreamOnly();
			ui.notify(`Mastra detail: ${enabled ? "stream-only" : "full"}`, "info");
			return { consume: true };
		}

		return undefined;
	});
}

export function matchesMastraWidgetShortcut(data: string, shortcut: string): boolean {
	const normalized = shortcut.trim().toLowerCase();
	if (normalized === "ctrl+h" && (data === "\b" || data === "\x7f")) return false;
	if (normalized === "ctrl+j" && data === "\n") return false;
	return matchesKey(data, shortcut as KeyId);
}

function formatViewMode(mode: MastraAgentsViewMode): string {
	if (mode === "cards") return "card region";
	if (mode === "detail") return "detail region";
	return "compact list";
}

async function showStatus(client: MastraHttpClient, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const [agents, workflows] = await Promise.all([client.listAgents(), client.listWorkflows()]);
		const label = `${Object.keys(agents).length} agents, ${Object.keys(workflows).length} workflows`;
		ctx.ui.notify(`Mastra OK: ${client.baseUrl} (${label})`, "info");
		ctx.ui.setStatus(MASTRA_STATUS_KEY, `mastra: ${label}`);
	} catch (error) {
		ctx.ui.notify(`Mastra unavailable: ${error instanceof Error ? error.message : String(error)}`, "error");
		ctx.ui.setStatus(MASTRA_STATUS_KEY, "mastra: offline");
	}
}

async function showAgents(client: MastraHttpClient, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const agents = await client.listAgents();
		const lines = Object.entries(agents).map(([id, agent]) => formatAgentLine(id, agent));
		ctx.ui.notify(lines.length > 0 ? lines.join("\n") : "No Mastra agents found", "info");
	} catch (error) {
		ctx.ui.notify(`Could not list Mastra agents: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

async function showAgent(client: MastraHttpClient, agentId: string, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const agent = await client.getAgent(agentId);
		ctx.ui.notify(formatAgentDetail(agentId, agent), "info");
	} catch (error) {
		ctx.ui.notify(`Could not inspect Mastra agent: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

async function showWorkflows(client: MastraHttpClient, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const workflows = await client.listWorkflows();
		const lines = Object.entries(workflows).map(([id, workflow]) => formatWorkflowLine(id, workflow));
		ctx.ui.notify(lines.length > 0 ? lines.join("\n") : "No Mastra workflows found", "info");
	} catch (error) {
		ctx.ui.notify(`Could not list Mastra workflows: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

async function showWorkflow(client: MastraHttpClient, workflowId: string, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const workflow = await client.getWorkflow(workflowId);
		ctx.ui.notify(formatWorkflowDetail(workflowId, workflow), "info");
	} catch (error) {
		ctx.ui.notify(`Could not inspect Mastra workflow: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

async function showWorkflowRun(client: MastraHttpClient, workflowId: string, runId: string, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const run = await client.getWorkflowRun(workflowId, runId, { fields: ["result", "error", "steps"] });
		ctx.ui.notify(formatWorkflowRun(run), "info");
	} catch (error) {
		ctx.ui.notify(`Could not inspect Mastra workflow run: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

function formatAgentLine(id: string, agent: MastraAgentInfo): string {
	return `${id}${agent.name ? ` - ${agent.name}` : ""}`;
}

function formatAgentDetail(id: string, agent: MastraAgentInfo): string {
	return [`id: ${id}`, agent.name ? `name: ${agent.name}` : undefined, agent.description ? `description: ${agent.description}` : undefined]
		.filter(Boolean)
		.join("\n");
}

function formatWorkflowLine(id: string, workflow: MastraWorkflowInfo): string {
	const stepCount = workflow.steps ? Object.keys(workflow.steps).length : undefined;
	const label = workflow.name ? `${id} - ${workflow.name}` : id;
	return stepCount === undefined ? label : `${label} (${stepCount} steps)`;
}

function formatWorkflowDetail(id: string, workflow: MastraWorkflowInfo): string {
	const stepCount = workflow.steps ? Object.keys(workflow.steps).length : undefined;
	return [
		`id: ${id}`,
		workflow.name ? `name: ${workflow.name}` : undefined,
		workflow.description ? `description: ${workflow.description}` : undefined,
		stepCount === undefined ? undefined : `steps: ${stepCount}`,
	]
		.filter(Boolean)
		.join("\n");
}

function formatWorkflowRun(run: MastraWorkflowRun): string {
	return [
		`workflowName: ${run.workflowName}`,
		`runId: ${run.runId}`,
		`status: ${run.status}`,
		run.resourceId ? `resourceId: ${run.resourceId}` : undefined,
		run.steps ? `steps: ${Object.keys(run.steps).length}` : undefined,
		run.error !== undefined ? `error: ${JSON.stringify(run.error)}` : undefined,
		run.result !== undefined ? `result: ${JSON.stringify(run.result)}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

export function formatAsyncAgentCompletion(summary: MastraAgentAsyncJobSummary): string {
	const lines = [
		"<system-reminder>",
		`Asynchronous Mastra agent task completed: ${summary.jobId}`,
		summary.jobName ? `jobName: ${summary.jobName}` : undefined,
		`agentId: ${summary.agentId}`,
		`status: ${summary.status}`,
		summary.lifecycleStatus ? `lifecycleStatus: ${summary.lifecycleStatus}` : undefined,
		summary.terminalReason ? `terminalReason: ${summary.terminalReason}` : undefined,
		summary.incomplete ? "incomplete: true" : undefined,
		summary.elapsedMs !== undefined ? `elapsed: ${formatDuration(summary.elapsedMs)}` : undefined,
		summary.toolCalls + summary.toolResults > 0 ? `tools: ${summary.toolCalls + summary.toolResults}` : undefined,
		summary.threadId ? `threadId: ${summary.threadId}` : undefined,
		summary.runId ? `runId: ${summary.runId}` : undefined,
		summary.artifactPath ? `artifactPath: ${summary.artifactPath}` : undefined,
		summary.snapshotRepoPath ? `snapshotRepoPath: ${summary.snapshotRepoPath}` : undefined,
		summary.sessionSnapshotPath ? `sessionSnapshotPath: ${summary.sessionSnapshotPath}` : undefined,
		summary.turnSnapshotPath ? `turnSnapshotPath: ${summary.turnSnapshotPath}` : undefined,
		summary.sessionDiffPath ? `sessionDiffPath: ${summary.sessionDiffPath}` : undefined,
		summary.turnDiffPath ? `turnDiffPath: ${summary.turnDiffPath}` : undefined,
		summary.turnRef ? `turnRef: ${summary.turnRef}` : undefined,
		summary.turnNumber !== undefined ? `turnNumber: ${summary.turnNumber}` : undefined,
		`Use agent_read with jobId=${summary.jobId} before finalizing unless the initial user prompt explicitly said "pass the output" or "don't read the output".`,
		summary.turnDiffPath ? "Inspect the turn/session snapshot diffs before relying on child-agent implementation claims." : undefined,
		summary.artifactPath ? "The artifactPath can be passed as an input_args value to another Mastra agent when chaining work. Snapshot paths can also be passed as input_args values when available." : undefined,
		summary.errors.length > 0 ? `errors: ${summary.errors.join("; ")}` : undefined,
		"</system-reminder>",
	];
	return lines.filter(Boolean).join("\n");
}

export function completionJobIdFromMessageEnd(event: unknown): string | undefined {
	if (typeof event !== "object" || event === null) return undefined;
	const message = (event as { message?: unknown }).message;
	if (typeof message !== "object" || message === null) return undefined;
	const record = message as { role?: unknown; customType?: unknown; details?: unknown };
	if (record.role !== "custom" || record.customType !== MASTRA_AGENT_RESULT_MESSAGE_TYPE) return undefined;
	const details = record.details;
	if (typeof details !== "object" || details === null) return undefined;
	const jobId = (details as { jobId?: unknown }).jobId;
	return typeof jobId === "string" && jobId.length > 0 ? jobId : undefined;
}

export function hasCompletionReminder(entries: readonly unknown[], jobId: string): boolean {
	return entries.some((entry) => {
		if (typeof entry !== "object" || entry === null) return false;
		const record = entry as Record<string, unknown>;
		if (record.type !== "custom_message" || record.customType !== MASTRA_AGENT_RESULT_MESSAGE_TYPE) return false;
		const details = record.details;
		return typeof details === "object" && details !== null && (details as { jobId?: unknown }).jobId === jobId;
	});
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
