/**
 * Git operations wrapper for snapshot system.
 * Uses Node.js child_process (compatible with both Bun and Node runtimes).
 */
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(spawn);

export async function gitAvailable(): Promise<boolean> {
  try {
    return await new Promise((resolve) => {
      const proc = spawn("git", ["--version"]);
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}

export async function git(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => { stdout += data.toString(); });
    proc.stderr?.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error("git " + args.join(" ") + " failed: " + stderr.trim()));
      }
    });

    proc.on("error", (err) => {
      reject(new Error("git " + args.join(" ") + " failed: " + err.message));
    });
  });
}
