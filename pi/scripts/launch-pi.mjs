#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(packageDir, "src/extensions/index.ts");
const env = {
	...process.env,
	MASTRA_BASE_URL: process.env.MASTRA_BASE_URL || "http://localhost:4111/api",
};

const args = ["--no-extensions", "--extension", extensionPath, ...process.argv.slice(2)];
const child = spawn("pi", args, {
	cwd: packageDir,
	env,
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 0);
});

child.on("error", (error) => {
	console.error(`Failed to launch pi: ${error.message}`);
	process.exit(1);
});
