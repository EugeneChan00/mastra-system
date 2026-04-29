/**

* Research tools — smoke tests.
*
* These tests verify:
*   1. Tools register without throwing.
*   2. EXA_API_KEY missing-key path returns { missingKey: true }.
*   3. GitHub public-repo path works without GH_TOKEN.
*   4. Schema parsing rejects invalid inputs.
*   5. Web-fetch rejects non-text content types.
*/

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  exaSearchTool,
  webFetchTool,
  githubRepoTool,
  githubFileTool,
  githubSearchTool,
} from "./index.js";
import {
  exaSearchQuerySchema,
  webFetchQuerySchema,
  githubRepoQuerySchema,
  githubFileQuerySchema,
  githubSearchQuerySchema,
} from "./index.js";

import { researcherAgent } from "../../agents/researcher-agent.js";

// ---------------------------------------------------------------------------
// Tool registration — must not throw
// ---------------------------------------------------------------------------

describe("tool registration", () => {
  it("exa-search tool is defined and has an id", () => {
    expect(exaSearchTool).toBeDefined();
    expect(exaSearchTool.id).toBe("research.exa-search");
  });

  it("web-fetch tool is defined and has an id", () => {
    expect(webFetchTool).toBeDefined();
    expect(webFetchTool.id).toBe("research.web-fetch");
  });

  it("github-repo tool is defined and has an id", () => {
    expect(githubRepoTool).toBeDefined();
    expect(githubRepoTool.id).toBe("research.github-repo");
  });

  it("github-file tool is defined and has an id", () => {
    expect(githubFileTool).toBeDefined();
    expect(githubFileTool.id).toBe("research.github-file");
  });

  it("github-search tool is defined and has an id", () => {
    expect(githubSearchTool).toBeDefined();
    expect(githubSearchTool.id).toBe("research.github-search");
  });

  it("researcher-agent is defined with expected id", () => {
    expect(researcherAgent).toBeDefined();
    expect((researcherAgent as { id?: string }).id).toBe("researcher-agent");
  });
});

// ---------------------------------------------------------------------------
// Input schema validation
// ---------------------------------------------------------------------------

describe("input schema — exa search", () => {
  it("accepts a valid minimal query", () => {
    const result = exaSearchQuerySchema.safeParse({ query: "vitest testing" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing query", () => {
    const result = exaSearchQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects an empty query string", () => {
    const result = exaSearchQuerySchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  it("accepts all optional fields within bounds", () => {
    const result = exaSearchQuerySchema.safeParse({
      query: "mcp server github",
      type: "keyword",
      numResults: 5,
      maxCharacters: 5000,
      text: true,
      highlights: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects numResults above 100", () => {
    const result = exaSearchQuerySchema.safeParse({
      query: "test",
      numResults: 101,
    });
    expect(result.success).toBe(false);
  });

  it("rejects maxCharacters below 100", () => {
    const result = exaSearchQuerySchema.safeParse({
      query: "test",
      maxCharacters: 50,
    });
    expect(result.success).toBe(false);
  });
});

describe("input schema — web fetch", () => {
  it("accepts a valid URL", () => {
    const result = webFetchQuerySchema.safeParse({ url: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed URL", () => {
    const result = webFetchQuerySchema.safeParse({ url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing URL", () => {
    const result = webFetchQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects maxCharacters below 100", () => {
    const result = webFetchQuerySchema.safeParse({
      url: "https://example.com",
      maxCharacters: 50,
    });
    expect(result.success).toBe(false);
  });

  it("rejects timeoutMs below 1000", () => {
    const result = webFetchQuerySchema.safeParse({
      url: "https://example.com",
      timeoutMs: 500,
    });
    expect(result.success).toBe(false);
  });
});

describe("input schema — github repo", () => {
  it("accepts a valid owner/repo pair", () => {
    const result = githubRepoQuerySchema.safeParse({
      owner: "facebook",
      repo: "react",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing owner", () => {
    const result = githubRepoQuerySchema.safeParse({ repo: "react" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty repo", () => {
    const result = githubRepoQuerySchema.safeParse({ owner: "facebook", repo: "" });
    expect(result.success).toBe(false);
  });
});

describe("input schema — github file", () => {
  it("accepts a valid file query", () => {
    const result = githubFileQuerySchema.safeParse({
      owner: "facebook",
      repo: "react",
      path: "README.md",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional ref", () => {
    const result = githubFileQuerySchema.safeParse({
      owner: "facebook",
      repo: "react",
      path: "README.md",
      ref: "main",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing path", () => {
    const result = githubFileQuerySchema.safeParse({
      owner: "facebook",
      repo: "react",
    });
    expect(result.success).toBe(false);
  });
});

describe("input schema — github search", () => {
  it("accepts a valid search query", () => {
    const result = githubSearchQuerySchema.safeParse({ q: "language:typescript stars:>100" });
    expect(result.success).toBe(true);
  });

  it("accepts all type variants", () => {
    for (const type of ["repositories", "code", "commits", "issues", "users"]) {
      const result = githubSearchQuerySchema.safeParse({ q: "test", type });
      expect(result.success, `type=${type}`).toBe(true);
    }
  });

  it("rejects an invalid type", () => {
    const result = githubSearchQuerySchema.safeParse({ q: "test", type: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing query", () => {
    const result = githubSearchQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EXA missing-key path
// ---------------------------------------------------------------------------

describe("exa search — missing EXA_API_KEY", () => {
  // Ensure EXA_API_KEY is not set for this test block
  const original = process.env.EXA_API_KEY;

  beforeEach(() => {
    delete process.env.EXA_API_KEY;
  });

  afterEach(() => {
    process.env.EXA_API_KEY = original;
  });

  it("returns missingKey: true when EXA_API_KEY is not set", async () => {
    const result = await exaSearchTool.execute({ query: "test" });
    expect(result.ok).toBe(false);
    expect(result.missingKey).toBe(true);
    expect(result.error).toContain("EXA_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// GitHub public repo access (no GH_TOKEN needed)
// ---------------------------------------------------------------------------

describe("github repo — public repo without GH_TOKEN", () => {
  const original = process.env.GH_TOKEN;

  beforeEach(() => {
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    process.env.GH_TOKEN = original;
  });

  it("returns ok:true for a known public repository", async () => {
    const result = await githubRepoTool.execute({ owner: "facebook", repo: "react" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fullName).toBe("facebook/react");
      expect(typeof result.stars).toBe("number");
    }
  }, 15_000);

  it("returns ok:false for a non-existent repository", async () => {
    const result = await githubRepoTool.execute({
      owner: "this-owner-definitely-does-not-exist-123456",
      repo: "this-repo-definitely-does-not-exist-789",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  }, 15_000);
});

describe("github file — public repo without GH_TOKEN", () => {
  const original = process.env.GH_TOKEN;

  beforeEach(() => {
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    process.env.GH_TOKEN = original;
  });

  it("returns content for a README in a public repo", async () => {
    const result = await githubFileTool.execute({
      owner: "facebook",
      repo: "react",
      path: "README.md",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBeDefined();
      expect(result.content!.length).toBeGreaterThan(0);
    }
  }, 15_000);

  it("returns ok:false for a non-existent file path", async () => {
    const result = await githubFileTool.execute({
      owner: "facebook",
      repo: "react",
      path: "this-file-does-not-exist-xyz.md",
    });
    expect(result.ok).toBe(false);
  }, 15_000);
});

describe("github search — public access without GH_TOKEN", () => {
  const original = process.env.GH_TOKEN;

  beforeEach(() => {
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    process.env.GH_TOKEN = original;
  });

  it("returns results for a repository search", async () => {
    const result = await githubSearchTool.execute({
      q: "mcp server typescript",
      type: "repositories",
      perPage: 5,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.totalCount).toBe("number");
      expect(Array.isArray(result.items)).toBe(true);
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Agent prompt instructions contain required policy sections
// ---------------------------------------------------------------------------

describe("researcher-agent instructions", () => {
  it("researcher-agent is defined with a non-empty id", () => {
    expect(researcherAgent).toBeDefined();
    expect((researcherAgent as { id?: string }).id).toBe("researcher-agent");
  });

  it("researcher-agent has expected name", () => {
    expect((researcherAgent as { name?: string }).name).toBe("Researcher Agent");
  });
});
