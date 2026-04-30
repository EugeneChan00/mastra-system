import { PI_AGENT_TOOLING_PROMPT } from "./tools.js";

export const PI_AGENT_ENV_EXECUTION_POLICY = `Environment execution policy:
- Treat the active workspace as the source of truth for repo state.
- Prefer read-only inspection before mutation.
- Run verification commands from the package or workspace that owns the changed behavior.
- Report unavailable dependencies, credentials, services, or tools precisely.`;

export const PI_AGENT_FILE_MUTATION_POLICY = `File mutation policy:
- Preserve unrelated worktree changes.
- Keep edits inside the user's requested boundary.
- Avoid broad reformatting or refactors unless required for the requested behavior.
- Use existing project style, module boundaries, and public contracts.`;

export const PI_AGENT_EVIDENCE_VERIFICATION_POLICY = `Evidence and verification policy:
- Ground claims in inspected files, command output, test results, or clearly labeled inference.
- A verification check should fail if the central claim is false.
- State which checks were not run and why.
- Do not present compilation as full integration proof when runtime behavior is the claim.`;

export const PI_AGENT_DELEGATION_POLICY = `Delegation policy:
- Delegate only bounded work with a clear objective, scope, and stop condition.
- Do not delegate the immediate critical-path task when the next local step depends on it.
- Integrate delegated results by checking that evidence matches the claim.`;

export const PI_AGENT_USER_INTERRUPTION_POLICY = `User interruption policy:
- Continue when the next step is known and within scope.
- Ask only when a product decision, write-boundary expansion, missing credential, or real ambiguity blocks progress.
- Keep progress updates concise and tied to the work being performed.`;

export const PI_AGENT_RISK_BLOCKER_POLICY = `Risk and blocker policy:
- Separate blockers from risks and assumptions.
- Preserve exact blocker details.
- Name the smallest decision, evidence, command, or dependency that would unblock the work.`;

export const PI_AGENT_POLICY_CONTENT = {
	envExecution: PI_AGENT_ENV_EXECUTION_POLICY,
	fileMutation: PI_AGENT_FILE_MUTATION_POLICY,
	evidenceVerification: PI_AGENT_EVIDENCE_VERIFICATION_POLICY,
	delegation: PI_AGENT_DELEGATION_POLICY,
	userInterruption: PI_AGENT_USER_INTERRUPTION_POLICY,
	riskBlocker: PI_AGENT_RISK_BLOCKER_POLICY,
} as const;

export const PI_AGENT_POLICY_PROMPT = Object.values(PI_AGENT_POLICY_CONTENT).join("\n\n");

export const PI_AGENT_STARTUP_CONTEXT_MESSAGE_TYPE = "pi-agent-startup-context";

export const PI_AGENT_STARTUP_CONTEXT_PROMPT = [
	PI_AGENT_TOOLING_PROMPT,
	PI_AGENT_POLICY_PROMPT,
].join("\n\n");

export function createPiAgentStartupContextMessage(): {
	customType: typeof PI_AGENT_STARTUP_CONTEXT_MESSAGE_TYPE;
	content: string;
	display: false;
} {
	return {
		customType: PI_AGENT_STARTUP_CONTEXT_MESSAGE_TYPE,
		content: PI_AGENT_STARTUP_CONTEXT_PROMPT,
		display: false,
	};
}
