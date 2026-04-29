#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MastraHttpClient, createMastraAgentInspectTool, createMastraWorkflowListTool } from "../dist/mastra/index.js";

const baseUrl = process.env.MASTRA_BASE_URL || "http://localhost:4111/api";
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const client = new MastraHttpClient({ baseUrl });

const agents = await client.listAgents();
assert.ok(agents["supervisor-agent"], "expected supervisor-agent to be listed");

const agent = await client.getAgent("supervisor-agent");
assert.equal(typeof agent.name, "string", "expected supervisor-agent metadata");

const inspectTool = createMastraAgentInspectTool(client);
const inspect = await inspectTool.execute("smoke-inspect", { agents: "supervisor-agent" });
assert.equal(inspect.details.count, 1, "expected one inspected agent");
assert.equal(inspect.details.errors.length, 0, "expected no agent inspect errors");
assert.equal(Boolean(inspect.details.agents[0]?.instructions), false, "instructions should be omitted by default");
assert.ok((inspect.details.agents[0]?.tools.length ?? 0) > 0, "expected supervisor-agent tools");

const inspectWithInstructions = await inspectTool.execute("smoke-inspect-instructions", {
	agentId: "supervisor-agent",
	includeInstructions: true,
});
assert.equal(Boolean(inspectWithInstructions.details.agents[0]?.instructions), true, "expected opt-in instructions");

const workflows = await client.listWorkflows();
assert.ok(workflows.checkApi, "expected checkApi workflow to be listed");

const workflowListTool = createMastraWorkflowListTool(client);
const workflowList = await workflowListTool.execute("smoke-workflows", {});
assert.ok(workflowList.details.count >= 1, "expected workflow list tool to return workflows");

const rpc = await smokePiRpc(baseUrl);
assert.equal(rpc.hasMastraCommand, true, "expected Pi RPC command registry to include /mastra");
assert.match(rpc.statusText, /mastra: \d+ agents, \d+ workflows/, "expected Mastra status UI update");

console.log(
	JSON.stringify(
		{
			baseUrl,
			agents: Object.keys(agents).length,
			workflows: Object.keys(workflows).length,
			supervisorTools: inspect.details.agents[0]?.tools.length ?? 0,
			inspections: inspect.details.count,
			piRpc: rpc,
		},
		null,
		2,
	),
);

function smokePiRpc(mastraBaseUrl) {
	return new Promise((resolvePromise, reject) => {
		const extensionPath = resolve(packageDir, "src/extensions/index.ts");
		const child = spawn(
			"pi",
			[
				"--mode",
				"rpc",
				"--no-session",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--extension",
				extensionPath,
			],
			{
				cwd: packageDir,
				env: { ...process.env, MASTRA_BASE_URL: mastraBaseUrl },
				stdio: ["pipe", "pipe", "pipe"],
			},
		);

		let stdout = "";
		let stderr = "";
		let statusText = "";
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`Pi RPC smoke timed out. stdout=${stdout} stderr=${stderr}`));
		}, 8_000);

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
			for (const line of stdout.split("\n")) {
				if (!line.trim()) continue;
				let message;
				try {
					message = JSON.parse(line);
				} catch {
					continue;
				}
				if (message.type === "extension_ui_request" && message.method === "setStatus" && message.statusKey === "mastra") {
					statusText = message.statusText;
				}
				if (message.id === "commands" && message.type === "response") {
					clearTimeout(timeout);
					child.kill("SIGTERM");
					const commands = message.data?.commands ?? [];
					resolvePromise({
						hasMastraCommand: commands.some((command) => command.name === "mastra" && command.source === "extension"),
						statusText,
					});
				}
			}
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.stdin.write(`${JSON.stringify({ id: "commands", type: "get_commands" })}\n`);
	});
}
