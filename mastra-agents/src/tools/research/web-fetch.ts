import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Web fetch/reader tool for the researcher-agent.
 *
 * Performs HTTP GET requests to arbitrary URLs and returns text content.
 * Output is bounded by character limit and read timeout to prevent large payloads.
 * No shell execution, no dynamic code evaluation.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const webFetchQuerySchema = z.object({
  url: z.string().url().describe("URL to fetch"),
  maxCharacters: z
    .number()
    .int()
    .min(100)
    .max(10000)
    .default(3000)
    .optional()
    .describe("Maximum characters to read from response body"),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30000)
    .default(10000)
    .optional()
    .describe("Request timeout in milliseconds"),
});

export const webFetchResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().nullable(),
  url: z.string(),
  contentType: z.string().optional(),
  text: z.string().optional(),
  error: z.string().optional(),
  truncated: z.boolean().optional(),
});

export type WebFetchInput = z.infer<typeof webFetchQuerySchema>;
export type WebFetchResult = z.infer<typeof webFetchResultSchema>;

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const webFetchTool = createTool({
  id: "research.web-fetch",
  description:
    "Fetch and read the text content of a URL. Returns text content up to a configurable " +
    "character limit (default 3000). Timeout is configurable (default 10s). " +
    "Use this after a web search to retrieve and cite specific document sections. " +
    "Do not use for large file downloads; limit output with maxCharacters for dense pages.",
  inputSchema: webFetchQuerySchema,
  outputSchema: webFetchResultSchema,
  execute: async (query: WebFetchInput): Promise<WebFetchResult> => {
    const maxChars = query.maxCharacters ?? 3000;
    const timeoutMs = query.timeoutMs ?? 10000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(query.url, {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (compatible; MastraResearchBot/1.0; +https://mastra.ai)",
        },
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") ?? "";
      const isText = contentType.startsWith("text/") ||
        contentType.includes("application/json") ||
        contentType.includes("application/xml");

      if (!isText) {
        return {
          ok: false,
          status: response.status,
          url: query.url,
          contentType,
          error: `Non-text content type returned: ${contentType}. Will not read body.`,
        };
      }

      const rawText = await response.text();
      const truncated = rawText.length > maxChars;
      const text = rawText.slice(0, maxChars);

      return {
        ok: response.ok,
        status: response.status,
        url: query.url,
        contentType,
        text,
        truncated,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          ok: false,
          status: null,
          url: query.url,
          error: `Request timed out after ${timeoutMs}ms`,
        };
      }
      return {
        ok: false,
        status: null,
        url: query.url,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

export const webFetchSchemas = {
  query: webFetchQuerySchema,
  result: webFetchResultSchema,
};
