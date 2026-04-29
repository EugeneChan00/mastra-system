# Research Tools — Environment Configuration

This document describes the environment variables required for researcher-agent research tooling.

## EXA_API_KEY

**Purpose**: Enables `research.exa-search`, the web search tool for the researcher-agent.

**Obtain**: Sign up at https://exa.ai and copy your API key.

**Format**: Plain string. No scope or permission level needed.

**Example**:
```bash
EXA_API_KEY=your-exa-api-key-here
```

**Required for**: `research.exa-search` web search functionality.

**Behavior when absent**: The tool returns a clear error message: `"EXA_API_KEY environment variable is not set. Web search is unavailable in this session."` Research falls back to local evidence and GitHub research.

**Security**: Treat this key as a secret. It is not logged or echoed by any tool. Rotate if compromised.

---

## GH_TOKEN

**Purpose**: Optional GitHub personal access token for `research.github-repo`, `research.github-file`, and `research.github-search`.

**Obtain**: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token.

**Recommended scopes**:
- `public_repo` — sufficient for public repository read access and higher rate limits.
- `repo` — only if private repository research is needed.

**Format**: Bearer token string.

**Example**:
```bash
GH_TOKEN=github_pat_xxxxxxxxxxxxxx
```

**Effect when set**:
- Public repo rate limit: 10 req/min → 30 req/min.
- Enables access to private repositories (if `repo` scope is granted).

**Effect when absent**: All three GitHub tools work for public repositories at the unauthenticated rate limit (10 req/min). No error is raised; throughput is reduced.

**Behavior when invalid**: GitHub API returns 401/403. The tool surfaces the error from the API response rather than silently failing.

**Security**: Treat this token as a secret. Rotate if compromised. Do not log it.

---

## MCP GitHub Server (Alternative/Complementary)

The `@modelcontextprotocol/server-github` MCP server provides richer GitHub interactions (issue/PR filtering, code browsing, commit history) beyond what the REST tools cover.

When that MCP server is available and configured in Mastra's MCP connections, it is preferred over the REST-based GitHub research tools. The REST tools serve as a lightweight fallback.

Configuration for MCP is environment-specific and is not covered here.

---

## Tool Behavior Summary

| Tool | Required key | Optional key | Behavior without keys |
|---|---|---|---|
| `research.exa-search` | `EXA_API_KEY` | — | Returns missing-key error |
| `research.web-fetch` | — | — | Always available; bounded output |
| `research.github-repo` | — | `GH_TOKEN` | Works for public repos; reduced rate limit |
| `research.github-file` | — | `GH_TOKEN` | Works for public repos; reduced rate limit |
| `research.github-search` | — | `GH_TOKEN` | Works for public repos; reduced rate limit |

## Secrets Not Logged

All research tools follow this invariant:
- API keys and tokens are never included in tool output, error messages, or logs.
- Keys are read from `process.env` at tool invocation time and discarded immediately after use.
- When a key is missing, the tool returns a clear error message without exposing environment variable names.
