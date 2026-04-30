import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * GitHub repository and code research tool for the researcher-agent.
 *
 * Provides read-only GitHub API access for repository inspection, source browsing,
 * search, and issue/PR lookup. Uses the public GitHub REST API (no auth required for
 * public repos; higher rate limits with a GH_TOKEN).
 *
 * The @modelcontextprotocol/server-github MCP server is the recommended production
 * path for richer GitHub interactions. When that MCP server is available and configured
 * in Mastra's MCP connections, prefer those tools instead of this REST wrapper.
 * This tool serves as a lightweight fallback when MCP is not available.
 *
 * Requires no secrets for public repository read access. Set GH_TOKEN for higher
 * rate limits and private repo access.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const githubRepoQuerySchema = z.object({
  owner: z.string().min(1).describe("Repository owner (user or org)"),
  repo: z.string().min(1).describe("Repository name"),
});

export const githubRepoResultSchema = z.object({
  ok: z.boolean(),
  name: z.string().optional(),
  fullName: z.string().optional(),
  description: z.string().optional(),
  htmlUrl: z.string().optional(),
  stars: z.number().optional(),
  forks: z.number().optional(),
  openIssues: z.number().optional(),
  language: z.string().optional(),
  defaultBranch: z.string().optional(),
  createdAt: z.string().optional(),
  pushedAt: z.string().optional(),
  topics: z.array(z.string()).optional(),
  license: z.string().optional(),
  error: z.string().optional(),
});

export const githubFileQuerySchema = z.object({
  owner: z.string().min(1).describe("Repository owner"),
  repo: z.string().min(1).describe("Repository name"),
  path: z.string().min(1).describe("File path within the repository"),
  ref: z.string().optional().describe("Git ref (branch, tag, or commit SHA)"),
});

export const githubFileResultSchema = z.object({
  ok: z.boolean(),
  name: z.string().optional(),
  path: z.string().optional(),
  sha: z.string().optional(),
  size: z.number().optional(),
  content: z.string().optional(),
  encoding: z.string().optional(),
  htmlUrl: z.string().optional(),
  error: z.string().optional(),
});

export const githubSearchQuerySchema = z.object({
  q: z.string().min(1).describe("Search query (GitHub search syntax)"),
  type: z.enum(["repositories", "code", "commits", "issues", "users"]).default("repositories").optional(),
  perPage: z.number().int().min(1).max(100).default(10).optional(),
});

export const githubSearchResultSchema = z.object({
  ok: z.boolean(),
  totalCount: z.number().optional(),
  items: z.array(z.record(z.string(), z.unknown())).optional(),
  error: z.string().optional(),
});

export type GithubRepoInput = z.infer<typeof githubRepoQuerySchema>;
export type GithubRepoOutput = z.infer<typeof githubRepoResultSchema>;
export type GithubFileInput = z.infer<typeof githubFileQuerySchema>;
export type GithubFileOutput = z.infer<typeof githubFileResultSchema>;
export type GithubSearchInput = z.infer<typeof githubSearchQuerySchema>;
export type GithubSearchOutput = z.infer<typeof githubSearchResultSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 10_000;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "MastraResearchBot/1.0",
  };
  const token = process.env.GH_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function githubFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const url = `${GITHUB_API}${path}`;
  return fetch(url, { headers: githubHeaders(), signal });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const githubRepoTool = createTool({
  id: "research.github-repo",
  description:
    "Fetch repository metadata from GitHub (stars, description, language, topics, etc.). " +
    "Read-only access for public repos without authentication. " +
    "Set GH_TOKEN environment variable for higher rate limits and private repo access.",
  inputSchema: githubRepoQuerySchema,
  outputSchema: githubRepoResultSchema,
  execute: async (query: GithubRepoInput): Promise<GithubRepoOutput> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await githubFetch(
        `/repos/${query.owner}/${query.repo}`,
        controller.signal,
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return { ok: false, error: `GitHub API ${response.status}: ${body}` };
      }

      const data = await response.json() as Record<string, unknown>;
      return {
        ok: true,
        name: String(data["name"] ?? ""),
        fullName: String(data["full_name"] ?? ""),
        description: data["description"] ? String(data["description"]) : undefined,
        htmlUrl: String(data["html_url"] ?? ""),
        stars: Number(data["stargazers_count"] ?? 0),
        forks: Number(data["forks_count"] ?? 0),
        openIssues: Number(data["open_issues_count"] ?? 0),
        language: data["language"] ? String(data["language"]) : undefined,
        defaultBranch: String(data["default_branch"] ?? ""),
        createdAt: data["created_at"] ? String(data["created_at"]) : undefined,
        pushedAt: data["pushed_at"] ? String(data["pushed_at"]) : undefined,
        topics: (data["topics"] as string[] | null | undefined)?.slice(0, 20),
        license: data["license"]
          ? String((data["license"] as Record<string, unknown>)["spdx_id"] ?? "")
          : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

export const githubFileTool = createTool({
  id: "research.github-file",
  description:
    "Fetch a single file's content from a GitHub repository. " +
    "Returns decoded content for text files (source code, docs, configs). " +
    "Binary files are not decoded; their size and SHA are returned instead. " +
    "Use ref parameter to specify a branch, tag, or commit SHA.",
  inputSchema: githubFileQuerySchema,
  outputSchema: githubFileResultSchema,
  execute: async (query: GithubFileInput): Promise<GithubFileOutput> => {
    try {
      const refPath = query.ref ? `/heads/${query.ref}` : "";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await githubFetch(
        `/repos/${query.owner}/${query.repo}/contents/${query.path}${refPath}`,
        controller.signal,
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return { ok: false, error: `GitHub API ${response.status}: ${body}` };
      }

      const data = await response.json() as Record<string, unknown>;
      const contentBase64 = data["content"] as string | undefined;
      let content: string | undefined;
      let encoding: string | undefined;

      if (contentBase64 && data["encoding"] === "base64") {
        try {
          // atob for node environments
          content = Buffer.from(contentBase64.replace(/\n/g, ""), "base64").toString("utf-8");
          encoding = "base64";
        } catch {
          content = `[base64 content not decodable — size: ${data["size"]} bytes]`;
          encoding = "base64";
        }
      } else if (contentBase64) {
        content = contentBase64;
        encoding = "raw";
      }

      return {
        ok: true,
        name: String(data["name"] ?? ""),
        path: String(data["path"] ?? ""),
        sha: String(data["sha"] ?? ""),
        size: Number(data["size"] ?? 0),
        content,
        encoding,
        htmlUrl: String(data["html_url"] ?? ""),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

export const githubSearchTool = createTool({
  id: "research.github-search",
  description:
    "Search GitHub for repositories, code, commits, issues, or users using GitHub search syntax. " +
    "Examples: 'language:typescript stars:>100 pushed:>2024-01-01', 'repo:owner/name path:README.md', " +
    "'is:issue is:open assignee:username'. " +
    "Set GH_TOKEN for higher rate limits (public: 10 req/min, authenticated: 30 req/min).",
  inputSchema: githubSearchQuerySchema,
  outputSchema: githubSearchResultSchema,
  execute: async (query: GithubSearchInput): Promise<GithubSearchOutput> => {
    try {
      const params = new URLSearchParams({
        q: query.q,
        per_page: String(query.perPage ?? 10),
      });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await githubFetch(
        `/search/${query.type}?${params}`,
        controller.signal,
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return { ok: false, error: `GitHub API ${response.status}: ${body}` };
      }

      const data = await response.json() as {
        total_count?: number;
        items?: unknown[];
      };

      return {
        ok: true,
        totalCount: data.total_count ?? 0,
        items: (data.items ?? []) as Record<string, unknown>[],
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

export const githubSchemas = {
  repoQuery: githubRepoQuerySchema,
  repoResult: githubRepoResultSchema,
  fileQuery: githubFileQuerySchema,
  fileResult: githubFileResultSchema,
  searchQuery: githubSearchQuerySchema,
  searchResult: githubSearchResultSchema,
};
