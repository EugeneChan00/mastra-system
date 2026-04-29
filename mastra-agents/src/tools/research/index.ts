/**
 * Research tools for the researcher-agent.
 *
 * Provides web search, web fetch/reader, and GitHub repository research tools.
 * Each tool has a clear missing-key or absent-config error when the required
 * environment variable or MCP server is not available.
 */

export { exaSearchTool, exaSearchSchemas } from "./exa.js";
export type { ExaSearchInput, ExaSearchOutput } from "./exa.js";
// Individual schema re-export for test callers
export { exaSearchQuerySchema, exaSearchResultSchema } from "./exa.js";

export { webFetchTool, webFetchSchemas } from "./web-fetch.js";
export type { WebFetchInput, WebFetchResult } from "./web-fetch.js";
// Individual schema re-export for test callers
export { webFetchQuerySchema, webFetchResultSchema } from "./web-fetch.js";

export {
  githubRepoTool,
  githubFileTool,
  githubSearchTool,
  githubSchemas,
  githubRepoQuerySchema,
  githubFileQuerySchema,
  githubSearchQuerySchema,
  githubRepoResultSchema,
  githubFileResultSchema,
  githubSearchResultSchema,
} from "./github.js";
export type {
  GithubRepoInput,
  GithubRepoOutput,
  GithubFileInput,
  GithubFileOutput,
  GithubSearchInput,
  GithubSearchOutput,
} from "./github.js";
