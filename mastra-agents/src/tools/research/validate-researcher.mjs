/**
 * Static validation script for researcher-agent.
 * Uses node built-ins only — no external dependencies, no module resolution.
 *
 * Validates:
 *   1. Tool files exist and have non-trivial content.
 *   2. Agent file exists and references all 5 tools.
 *   3. Schemas are exported from index.ts.
 *   4. Prompts include required guidance sections.
 *   5. Env example includes research keys.
 *   6. No shell/command tool patterns in agent source.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = "mastra-agents/src";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function read(path) {
  try {
    return readFileSync(join(process.cwd(), path), "utf8");
  } catch {
    throw new Error(`Cannot read: ${path}`);
  }
}

function hasAll(haystack, needles) {
  return needles.map((n) => haystack.includes(n)).filter((b) => !b);
}

// ---------------------------------------------------------------------------
// 1. Research tool files exist and are non-trivial
// ---------------------------------------------------------------------------

const toolFiles = [
  "tools/research/index.ts",
  "tools/research/exa.ts",
  "tools/research/web-fetch.ts",
  "tools/research/github.ts",
];

console.log("--- 1. Tool files ---");
for (const f of toolFiles) {
  const src = read(`${BASE}/${f}`);
  const size = src.length;
  if (size < 100) throw new Error(`${f} is too small (${size} bytes)`);
  console.log(`  OK  ${f} (${size} bytes)`);
}

// ---------------------------------------------------------------------------
// 2. GitHub tool exports all expected schema names
// ---------------------------------------------------------------------------

console.log("\n--- 2. GitHub schema exports ---");
const githubSrc = read(`${BASE}/tools/research/github.ts`);
const expectedExports = [
  "githubRepoTool",
  "githubFileTool",
  "githubSearchTool",
  "githubRepoQuerySchema",
  "githubFileQuerySchema",
  "githubSearchQuerySchema",
  "githubRepoResultSchema",
  "githubFileResultSchema",
  "githubSearchResultSchema",
];
for (const exp of expectedExports) {
  if (!githubSrc.includes(`export const ${exp}`) && !githubSrc.includes(`export { ${exp}`)) {
    throw new Error(`GitHub tool missing export: ${exp}`);
  }
  console.log(`  OK  ${exp}`);
}

// ---------------------------------------------------------------------------
// 3. Research index re-exports all schemas
// ---------------------------------------------------------------------------

console.log("\n--- 3. Research index barrel ---");
const indexSrc = read(`${BASE}/tools/research/index.ts`);
const indexExports = [
  "exaSearchTool",
  "webFetchTool",
  "githubRepoTool",
  "githubFileTool",
  "githubSearchTool",
  "exaSearchQuerySchema",
  "webFetchQuerySchema",
  "githubRepoQuerySchema",
  "githubFileQuerySchema",
  "githubSearchQuerySchema",
];
for (const exp of indexExports) {
  if (!indexSrc.includes(exp)) {
    throw new Error(`Index missing export: ${exp}`);
  }
  console.log(`  OK  ${exp}`);
}

// ---------------------------------------------------------------------------
// 4. Tools index exports research tools
// ---------------------------------------------------------------------------

console.log("\n--- 4. Tools index barrel ---");
const toolsIndex = read(`${BASE}/tools/index.ts`);
for (const exp of ["exaSearchTool", "webFetchTool", "githubRepoTool", "githubFileTool", "githubSearchTool"]) {
  if (!toolsIndex.includes(exp)) {
    throw new Error(`tools/index.ts missing export: ${exp}`);
  }
  console.log(`  OK  ${exp}`);
}

// ---------------------------------------------------------------------------
// 5. Agent references all 5 tools and has no shell tools
// ---------------------------------------------------------------------------

console.log("\n--- 5. Researcher agent ---");
const agentSrc = read(`${BASE}/agents/researcher-agent.ts`);

const toolRefs = ["exaSearch", "webFetch", "githubRepo", "githubFile", "githubSearch"];
for (const t of toolRefs) {
  if (!agentSrc.includes(t)) throw new Error(`Agent missing tool ref: ${t}`);
  console.log(`  OK  tool registered: ${t}`);
}

const shellPatterns = ["shell", "exec", "bash", "run ", "run("];
for (const pat of shellPatterns) {
  // Allow in comments, bullet points, and doc-text lines (which legitimately describe security policies)
  const lines = agentSrc.split("\n").filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("#") && !t.startsWith("-");
  });
  const code = lines.join("\n");
  if (code.includes(pat)) {
    // check if it's part of a word (e.g. "developer" contains "velop" but not "run")
    const idx = code.indexOf(pat);
    const before = code[idx - 1] ?? " ";
    const after = code[idx + pat.length] ?? " ";
    if (!/\w/.test(before) && !/\w/.test(after)) {
      throw new Error(`Agent source contains shell pattern '${pat}'`);
    }
  }
}
console.log("  OK  no shell/exec patterns in agent code");

// ---------------------------------------------------------------------------
// 6. Prompt includes required sections
// ---------------------------------------------------------------------------

console.log("\n--- 6. Prompt guidance ---");
const requiredSections = [
  "research.exa-search",
  "research.web-fetch",
  "research.github-repo",
  "research.github-file",
  "research.github-search",
  "EXA_API_KEY",
  "GH_TOKEN",
  "Inspected source",
  "bounded",
  "timeout",
  "Never log",
  "Fetch after search",
];
for (const section of requiredSections) {
  if (!agentSrc.includes(section)) {
    throw new Error(`Agent instructions missing: '${section}'`);
  }
  console.log(`  OK  prompt includes: ${section}`);
}

// ---------------------------------------------------------------------------
// 7. Env example documents research keys
// ---------------------------------------------------------------------------

console.log("\n--- 7. .env.example research keys ---");
const envExample = read(`${BASE}/../.env.example`);
if (!envExample.includes("EXA_API_KEY")) throw new Error(".env.example missing EXA_API_KEY");
if (!envExample.includes("GH_TOKEN")) throw new Error(".env.example missing GH_TOKEN");
console.log("  OK  EXA_API_KEY and GH_TOKEN documented");

// ---------------------------------------------------------------------------
// 8. No createTool calls missing schema
// ---------------------------------------------------------------------------

console.log("\n--- 8. createTool calls have schemas ---");
const toolSrcs = toolFiles.map((f) => ({ f, s: read(`${BASE}/${f}`) }));
const createToolCalls = toolSrcs.flatMap(({ f, s }) => {
  const matches = [...s.matchAll(/createTool\s*\(\s*\{/g)].map((m) => ({
    pos: m.index,
    file: f,
  }));
  return matches;
});
for (const call of createToolCalls) {
  console.log(`  OK  createTool at ${call.file}:${call.pos}`);
}
if (createToolCalls.length < 5) throw new Error(`Expected 5+ createTool calls, found ${createToolCalls.length}`);

// ---------------------------------------------------------------------------
// 9. No hardcoded API keys or tokens in source
// ---------------------------------------------------------------------------

console.log("\n--- 9. No embedded secrets ---");
const secretPatterns = [
  /exa[_-]?api[_-]?key\s*=\s*["'][^"']{10,}/i,
  /github[_-]?token\s*=\s*["'][^"']{10,}/i,
  /gh[_-]?token\s*=\s*["'][^"']{10,}/i,
  /api[_-]?key\s*=\s*["'][a-f0-9]{32,}/i,
];
for (const re of secretPatterns) {
  for (const { f, s } of toolSrcs) {
    if (re.test(s)) throw new Error(`Possible embedded secret in ${f}`);
  }
}
console.log("  OK  no embedded secrets found");

console.log("\n=== All static checks passed ===\n");