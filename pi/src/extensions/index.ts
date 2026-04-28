import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { MASTRA_STATUS_KEY } from "../const.js";
import { MastraHttpClient, createMastraAgentTool } from "../mastra/index.js";

export default function mastraPiExtension(pi: ExtensionAPI) {
	const client = new MastraHttpClient();

	pi.registerTool(createMastraAgentTool(client));

	pi.registerCommand("mastra", {
		description: "Mastra bridge status and agent discovery",
		getArgumentCompletions(prefix) {
			return ["status", "agents"]
				.filter((value) => value.startsWith(prefix.trim()))
				.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const subcommand = args.trim() || "status";
			if (subcommand === "agents") {
				await showAgents(client, ctx);
				return;
			}
			if (subcommand === "status") {
				await showStatus(client, ctx);
				return;
			}
			ctx.ui.notify("Usage: /mastra status | /mastra agents", "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			const agents = await client.listAgents();
			ctx.ui.setStatus(MASTRA_STATUS_KEY, `mastra: ${Object.keys(agents).length} agents`);
		} catch {
			ctx.ui.setStatus(MASTRA_STATUS_KEY, "mastra: offline");
		}
	});
}

async function showStatus(client: MastraHttpClient, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const agents = await client.listAgents();
		ctx.ui.notify(`Mastra OK: ${client.baseUrl} (${Object.keys(agents).length} agents)`, "info");
		ctx.ui.setStatus(MASTRA_STATUS_KEY, `mastra: ${Object.keys(agents).length} agents`);
	} catch (error) {
		ctx.ui.notify(`Mastra unavailable: ${error instanceof Error ? error.message : String(error)}`, "error");
		ctx.ui.setStatus(MASTRA_STATUS_KEY, "mastra: offline");
	}
}

async function showAgents(client: MastraHttpClient, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const agents = await client.listAgents();
		const lines = Object.entries(agents).map(([id, agent]) => `${id}${agent.name ? ` - ${agent.name}` : ""}`);
		ctx.ui.notify(lines.length > 0 ? lines.join("\n") : "No Mastra agents found", "info");
	} catch (error) {
		ctx.ui.notify(`Could not list Mastra agents: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}
