import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { MASTRA_STATUS_KEY } from "../const.js";
import { MastraHttpClient, createMastraTools } from "../mastra/index.js";
import type { MastraAgentInfo, MastraWorkflowInfo, MastraWorkflowRun } from "../mastra/index.js";

export default function mastraPiExtension(pi: ExtensionAPI) {
	const client = new MastraHttpClient();

	for (const tool of createMastraTools(client)) {
		pi.registerTool(tool as any);
	}

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
		try {
			const [agents, workflows] = await Promise.all([client.listAgents(), client.listWorkflows()]);
			ctx.ui.setStatus(MASTRA_STATUS_KEY, `mastra: ${Object.keys(agents).length} agents, ${Object.keys(workflows).length} workflows`);
		} catch {
			ctx.ui.setStatus(MASTRA_STATUS_KEY, "mastra: offline");
		}
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
