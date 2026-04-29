import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { MASTRA_AGENT_RESULT_MESSAGE_TYPE, MASTRA_STATUS_KEY } from "../const.js";
import { MastraAsyncAgentManager, MastraHttpClient, createMastraTools } from "../mastra/index.js";
import { MastraAgentActivityStore, MastraAgentsWidget } from "../tui/index.js";
import type { MastraAgentAsyncJobSummary, MastraAgentInfo, MastraWorkflowInfo, MastraWorkflowRun } from "../mastra/index.js";

export default function mastraPiExtension(pi: ExtensionAPI) {
	const client = new MastraHttpClient();
	const activityStore = new MastraAgentActivityStore();
	const asyncAgentManager = new MastraAsyncAgentManager(client, {
		activitySink: activityStore,
		onComplete: (summary) => {
			// Live deltas stay in MastraAgentsWidget; only the final summary becomes a
			// transcript message. triggerTurn wakes the parent agent if the async job
			// finishes after the original Pi turn has gone idle.
			pi.sendMessage(
				{
					customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE,
					content: formatAsyncAgentCompletion(summary),
					display: true,
					details: summary,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		},
	});
	let unsubscribeActivityStatus: (() => void) | undefined;
	let statusLabel = "offline";

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
		unsubscribeActivityStatus?.();
		if (ctx.hasUI) {
			ctx.ui.setWidget("mastra-agents", (tui, theme) => new MastraAgentsWidget(tui, theme, activityStore), { placement: "aboveEditor" });
		}
		unsubscribeActivityStatus = activityStore.subscribe(() => {
			const running = activityStore.snapshot({ includeFinished: false }).length;
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
	});

	pi.on("session_shutdown", async () => {
		asyncAgentManager.cancelAll("Pi session shutdown", { suppressCompletionMessage: true });
		unsubscribeActivityStatus?.();
		unsubscribeActivityStatus = undefined;
	});
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

function formatAsyncAgentCompletion(summary: MastraAgentAsyncJobSummary): string {
	const header = [`jobId: ${summary.jobId}`, `status: ${summary.status}`];
	if (summary.elapsedMs !== undefined) header.push(`elapsed: ${formatDuration(summary.elapsedMs)}`);
	if (summary.toolCalls + summary.toolResults > 0) header.push(`tools: ${summary.toolCalls + summary.toolResults}`);
	const body = summary.textPreview || (summary.errors.length > 0 ? summary.errors.join("\n") : "(no text output)");
	const artifact = summary.artifactPath ? `\n\nFull output artifact: ${summary.artifactPath}` : "";
	return `${header.join(" · ")}\n\n${body}${artifact}`;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
