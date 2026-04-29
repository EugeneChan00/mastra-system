/**
 * Smoke tests for the researcher-agent.
 *
 * These tests verify:
 * - Agent registration (id, description, instructions non-empty)
 * - Tools are registered on the agent
 * - Prompt instructions contain required research-tool guidance
 * - No arbitrary executor exposure in the agent
 */

import assert from "node:assert/strict";
import test from "node:test";
import { researcherAgent } from "./researcher-agent.ts";

// ---------------------------------------------------------------------------
// Registration smoke
// ---------------------------------------------------------------------------

test("researcherAgent is registered with non-empty id, name, and description", () => {
  assert.ok(researcherAgent, "researcherAgent is exported");
  assert.ok(researcherAgent.id, "agent has an id");
  assert.equal(researcherAgent.id, "researcher-agent", "agent id matches");
  assert.ok(researcherAgent.name, "agent has a name");
  assert.ok(researcherAgent.description, "agent has a description");
});

test("researcherAgent instructions are non-empty and reference research tools", () => {
  assert.ok(researcherAgent.instructions, "agent has instructions");
  const instructions = researcherAgent.instructions as string;
  assert.ok(instructions.length > 100, "instructions are substantive");

  // Verify key tool references appear in instructions
  assert.ok(instructions.includes("exa-search"), "instructions mention exa-search tool");
  assert.ok(instructions.includes("web-fetch"), "instructions mention web-fetch tool");
  assert.ok(instructions.includes("github-repo"), "instructions mention github-repo tool");
  assert.ok(instructions.includes("github-file"), "instructions mention github-file tool");
  assert.ok(instructions.includes("github-search"), "instructions mention github-search tool");
});

test("researcherAgent instructions include evidence hierarchy guidance", () => {
  const instructions = researcherAgent.instructions as string;
  assert.ok(
    instructions.includes("Inspected source") || instructions.includes("local package"),
    "instructions reference source/local evidence",
  );
  assert.ok(
    instructions.includes("official docs") || instructions.includes("release notes"),
    "instructions reference official docs or release notes",
  );
  assert.ok(
    instructions.includes("Fetch after search") || instructions.includes("fetch after"),
    "instructions include fetch-after-search discipline",
  );
});

test("researcherAgent instructions include missing-key behavior guidance", () => {
  const instructions = researcherAgent.instructions as string;
  assert.ok(
    instructions.includes("EXA_API_KEY") || instructions.includes("missing-key"),
    "instructions reference EXA_API_KEY or missing-key behavior",
  );
  assert.ok(
    instructions.includes("configuration") || instructions.includes("unavailable"),
    "instructions describe configuration/availability handling",
  );
});

test("researcherAgent instructions include GitHub-specific guidance", () => {
  const instructions = researcherAgent.instructions as string;
  assert.ok(
    instructions.includes("GitHub") || instructions.includes("github"),
    "instructions mention GitHub tools or behavior",
  );
  assert.ok(
    instructions.includes("GH_TOKEN") || instructions.includes("rate limit"),
    "instructions mention GH_TOKEN or rate limits",
  );
});

test("researcherAgent instructions include failure reporting guidance", () => {
  const instructions = researcherAgent.instructions as string;
  assert.ok(
    instructions.includes("Failure reporting") ||
      instructions.includes("error") ||
      instructions.includes("Failure"),
    "instructions include failure reporting guidance",
  );
});

test("researcherAgent instructions include security and config constraints", () => {
  const instructions = researcherAgent.instructions as string;
  assert.ok(
    instructions.includes("Never log") ||
      instructions.includes("secrets") ||
      instructions.includes("Never") ||
      instructions.includes("security"),
    "instructions include security constraints",
  );
  assert.ok(
    instructions.includes("maxCharacters") ||
      instructions.includes("timeout") ||
      instructions.includes("bounded"),
    "instructions reference bounded output or timeouts",
  );
});

// ---------------------------------------------------------------------------
// Tool registration smoke
// ---------------------------------------------------------------------------

test("researcherAgent has the five research tools registered", () => {
  const agent = researcherAgent as any;
  const tools = agent.tools ?? {};

  assert.ok(tools.exaSearch, "exaSearch tool is registered");
  assert.ok(tools.webFetch, "webFetch tool is registered");
  assert.ok(tools.githubRepo, "githubRepo tool is registered");
  assert.ok(tools.githubFile, "githubFile tool is registered");
  assert.ok(tools.githubSearch, "githubSearch tool is registered");
});

// ---------------------------------------------------------------------------
// No arbitrary executor exposure
// ---------------------------------------------------------------------------

test("researcherAgent has no shell/command/exec tools exposed", () => {
  const agent = researcherAgent as any;
  const tools = agent.tools ?? {};
  const toolIds = Object.keys(tools);

  for (const id of toolIds) {
    assert.ok(
      !id.includes("exec") && !id.includes("shell") && !id.includes("command"),
      `tool id '${id}' does not include exec/shell/command`,
    );
  }
  assert.ok(
    !toolIds.some((id) => id.includes("bash") || id.includes("run")),
    "no bash/run tools exposed on researcher-agent",
  );
});

// ---------------------------------------------------------------------------
// Default options
// ---------------------------------------------------------------------------

test("researcherAgent has reasonable default options", () => {
  const agent = researcherAgent as any;
  assert.ok(agent.defaultOptions, "agent has defaultOptions");
  assert.ok(agent.defaultOptions.maxSteps > 0, "maxSteps is positive");
  assert.ok(agent.defaultOptions.maxSteps <= 100, "maxSteps is reasonable for a research agent");
  assert.ok(agent.defaultOptions.toolCallConcurrency > 0, "toolCallConcurrency is positive");
});
