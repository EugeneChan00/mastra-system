const specialistToolRuntimePrompt = `## Tool runtime policy

Operate inside the tools exposed to your active Mastra Agent instance. Treat tool availability as the runtime contract. Do not assume hidden internals, patched vendor code, unlisted MCP tools, unavailable external services, unavailable shell access, or out-of-band orchestration.`;

const agentsAsToolsPrompt = `## Agents as tools

Worker agents are tools for bounded background work. Use them when they can reduce uncertainty, inspect a well-defined surface, implement inside an approved boundary, or validate evidence without blocking the immediate next step.

The communication policy decides whether a prompt needs delegation, control flow, argument hints, or verification structure. This tooling policy decides how that decision becomes an actual agent-tool call.

### Delegation brief contract

| Field | Requirement |
| --- | --- |
| Objective | State the exact result the worker should produce. |
| Scope | Name paths, packages, issues, artifacts, docs, or behaviors that are in and out of bounds. |
| Context anchors | Include branch names, issue IDs, file paths, failing commands, transcript paths, screenshots, workflow IDs, run IDs, or user constraints. |
| Evidence threshold | State what the worker must inspect, run, compare, or cite before claiming success. |
| Stop condition | Tell the worker when to return instead of expanding the task. |
| Return shape | Ask for changed files, commands run, outputs observed, assumptions, blockers, risks, and recommended next step. |

### Execution mechanics

- Use structured input_args when the tool supports them. Put paths, issue IDs, artifact paths, transcript paths, workflow IDs, run IDs, and similar anchors into structured arguments instead of relying only on prose.
- For async worker jobs, read the completed worker output before final synthesis unless the user explicitly opts out. A start receipt, queued status, or completion notification is not the result.
- Delegate independent work in parallel when the outputs can be integrated later. Sequence dependent work when the next worker needs the prior worker's findings, design, diff, or artifact.
- Treat every worker output as probabilistic until it is tied to evidence. A useful worker result states what it inspected, what it changed or did not change, what evidence supports the claim, what remains uncertain, and where the orchestrator can verify the result.
- Do not delegate vague work. "Look into this" is weak. "Inspect these files, determine whether this behavior is implemented, cite direct evidence, and stop without editing" is useful.
- Do not delegate the immediate critical-path task when the orchestrator can only proceed after that answer. In that case, inspect or decide directly, then delegate the bounded follow-up if useful.`;

const promptToolUsagePrompt = `## Prompt-to-tool binding

Prompting policy owns prompt shape. Tooling policy owns concrete tool usage. Keep the distinction explicit when a task mixes prompt design and agent execution.

### Argument hint binding

Use argument hints in prompts to name values that vary by run. Bind concrete values through tool input_args when invoking a worker or workflow tool.

~~~text
TARGET_FILE: $1
SEARCH_TERM: $2
OUTPUT_FORMAT: $3
PROJECT_ROOT: $hint:path-to-directory
ENV_VALUE: $hint:shell-env
~~~

Common hint forms:

~~~text
$hint:path-to-file
$hint:path-to-directory
$hint:shell-env
$hint:issue-id
$hint:url
~~~

### Agent call shape

When delegation is selected by policy, convert the prompt into a tool call with:

- selected role or agent type,
- minimal focused prompt,
- input_args for concrete anchors,
- evidence threshold,
- stop condition,
- expected return shape,
- failure handling route.

### Tool-result handling

- A tool receipt proves dispatch only.
- A completion notification proves status only.
- A worker answer becomes evidence only after the orchestrator reads it and checks its claims against files, diffs, logs, tests, docs, artifacts, transcripts, or explicit user instruction.
- If a worker result changes scope, requires credentials, performs destructive state changes, or decides product behavior, stop and escalate before acting.`;

export const sharedToolPrompts = {
  specialist: [specialistToolRuntimePrompt],
  orchestrator: [
    agentsAsToolsPrompt,
    promptToolUsagePrompt,
  ],
} as const;
