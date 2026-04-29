import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const EXA_API_KEY = process.env.EXA_API_KEY;

/**
 * Exa web search tool for the researcher-agent.
 *
 * Uses the Exa (exa.ai) search API to perform web searches. Requires EXA_API_KEY.
 * Set EXA_API_KEY in environment to enable. If absent, the tool returns a clear
 * missing-key error rather than attempting a request.
 *
 * Output is bounded to a configurable number of characters and results to avoid
 * large payloads.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const exaSearchQuerySchema = z.object({
  query: z.string().min(1).describe("Search query string"),
  type: z.enum(["auto", "keyword", "neural", "agent"]).default("auto").optional(),
  numResults: z.number().int().min(1).max(100).default(10).optional(),
  startCrawlDate: z.string().optional(),
  endCrawlDate: z.string().optional(),
  maxCharacters: z.number().int().min(100).max(10000).default(2000).optional(),
  text: z.boolean().default(true).optional(),
  highlights: z.boolean().default(false).optional(),
});

export const exaSearchResultSchema = z.object({
  ok: z.boolean(),
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string().optional(),
        highlight: z.string().optional(),
        publishedDate: z.string().optional(),
        author: z.string().optional(),
      }),
    )
    .optional(),
  error: z.string().optional(),
  missingKey: z.boolean().optional(),
});

export type ExaSearchInput = z.infer<typeof exaSearchQuerySchema>;
export type ExaSearchOutput = z.infer<typeof exaSearchResultSchema>;

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const exaSearchTool = createTool({
  id: "research.exa-search",
  description:
    "Perform a web search using the Exa search API. Requires EXA_API_KEY environment variable. " +
    "Returns source titles, URLs, snippets, and optional highlights. " +
    "Use this for finding documentation, release notes, ecosystem information, and authoritative references. " +
    "Prefer official docs, release notes, and primary sources over community summaries.",
  inputSchema: exaSearchQuerySchema,
  outputSchema: exaSearchResultSchema,
  execute: async (query: ExaSearchInput): Promise<ExaSearchOutput> => {
    if (!EXA_API_KEY) {
      return {
        ok: false,
        error: "EXA_API_KEY environment variable is not set. Web search is unavailable in this session.",
        missingKey: true,
      };
    }

    try {
      const response = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": EXA_API_KEY,
        },
        body: JSON.stringify({
          query: query.query,
          type: query.type ?? "auto",
          numResults: query.numResults ?? 10,
          ...(query.startCrawlDate ? { startCrawlDate: query.startCrawlDate } : {}),
          ...(query.endCrawlDate ? { endCrawlDate: query.endCrawlDate } : {}),
          contents: {
            text: query.text ?? true,
            highlights: query.highlights ?? false,
            maxCharacters: query.maxCharacters ?? 2000,
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          ok: false,
          error: `Exa API error ${response.status}: ${body}`,
        };
      }

      const data = await response.json() as {
        results?: Array<{
          title?: string;
          url?: string;
          snippet?: string;
          highlight?: string;
          publishedDate?: string;
          author?: string;
        }>;
      };

      const results =
        (data.results ?? []).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.snippet,
          highlight: r.highlight,
          publishedDate: r.publishedDate,
          author: r.author,
        })) ?? [];

      return { ok: true, results };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

export const exaSearchSchemas = {
  query: exaSearchQuerySchema,
  result: exaSearchResultSchema,
};
