export const PI_AGENT_TOOLING_DECISION_MATRIX = `Tooling decision matrix:
- Inspect first when the task depends on existing files, tests, configuration, schemas, or package behavior.
- Edit only after the target boundary and current implementation are understood.
- Run commands when they verify a claim, expose a failure, or provide local environment facts.
- Delegate to Mastra agents when a bounded background investigation or implementation slice can run independently.
- Avoid tool use when the answer is already established by the conversation and no repo or runtime fact is needed.`;

export const PI_AGENT_TOOLING_BEST_PRACTICES = `Tooling best practices:
- Prefer fast, targeted searches and file reads before broad scans.
- Use the smallest command that proves the behavior under discussion.
- Treat tool errors as evidence; preserve the useful error details.
- Do not widen file mutation scope just because adjacent cleanup is visible.
- After async Mastra delegation, read the result before finalizing unless the user explicitly opts out.`;

export const PI_AGENT_TOOLING_PROMPT = [
	PI_AGENT_TOOLING_DECISION_MATRIX,
	PI_AGENT_TOOLING_BEST_PRACTICES,
].join("\n\n");
