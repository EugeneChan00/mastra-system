# Mastra Agent Calling Methods

This note documents how Pi calls Mastra agents in this workspace and how conversation memory identifiers are chosen by default.

## Call surfaces

Pi exposes two primary Mastra agent call tools:

| Tool | Use | Continuity behavior |
|---|---|---|
| `mastra_agent_call` | Synchronous call when the caller needs final output before continuing. | Sends a resolved `memory.thread` and `memory.resource` with the request. |
| `mastra_agent_start` | Asynchronous/background call with live progress in the Pi TUI. | Uses the same default memory identifier resolution as `mastra_agent_call`. |

Supporting tools:

| Tool | Use |
|---|---|
| `mastra_agent_read` | Read output from a background job. |
| `mastra_agent_async_status` | Check background job state. |
| `mastra_agent_cancel` | Cancel a background job. |
| `mastra_agent_list` / `mastra_agent_status` / `mastra_agent_inspect` | Discover and inspect registered Mastra agents. |

## Default memory identifiers

When the caller does not pass explicit memory IDs, Pi derives them deterministically from the current process context:

```ts
resourceId = `pi:${sha256(cwd).slice(0, 12)}`
threadId   = `pi:${sha256(`${cwd}:${process.pid}`).slice(0, 12)}:${agentId}`
```

Source:

- `pi/src/mastra/memory.ts` defines `defaultResourceId()` and `defaultThreadId()`.
- `pi/src/mastra/tool.ts` resolves `params.resourceId ?? defaultResourceId()` and `params.threadId ?? defaultThreadId(params.agentId)` before creating the stream request.

## Default reuse behavior

For repeated calls with no explicit `threadId` or `resourceId`:

| Scenario | Default `resourceId` | Default `threadId` |
|---|---|---|
| Same Pi process, same working directory, same agent | Reused | Reused |
| Same Pi process, same working directory, different agent | Reused | Different, because `agentId` is part of the thread ID |
| Pi restart, same working directory, same agent | Reused | New, because `process.pid` changes |
| Different working directory | New | New |

This means Pi does **not** create a fresh default thread for every call within the same running Pi process. It reuses the same default thread for the same agent, working directory, and process.

## Starting a new conversation intentionally

Pass a new `threadId` explicitly when you want a fresh conversation thread while keeping the same project/resource memory:

```json
{
  "agentId": "scout-agent",
  "message": "Inspect the workspace layout.",
  "resourceId": "pi:f2ade5464497",
  "threadId": "manual:scout:workspace-layout-001"
}
```

Pass both a new `resourceId` and a new `threadId` when you want fully isolated memory.

## Practical guidance

- Use no explicit IDs for normal same-session continuation.
- Use a stable explicit `threadId` if the conversation must survive Pi restarts.
- Use a new explicit `threadId` for a clean task thread under the same project/resource.
- Use a new explicit `resourceId` only when memory should be isolated from the current project/user context.
