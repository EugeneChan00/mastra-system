const snapshotObservabilityPrompt = `Git-Based Snapshot Observability:

Use git-based snapshots for turn and session diffs. Snapshot repo structure:
  ~/.agents/snapshots/mastra-agents/<agent-id>/<session-id>/<run-id>/snapshots.git/

Key git queries:
  # Turn diff (turn N vs turn N-1):
  git --git-dir=<repo> diff refs/turn/main/t{N-1} refs/turn/main/t{N}

  # Session diff (baseline vs latest):
  git --git-dir=<repo> diff refs/baseline/startup refs/latest

  # List all turns:
  git --git-dir=<repo> for-each-ref refs/turn/main/

  # Reconstruct file at turn N:
  git --git-dir=<repo> show refs/turn/main/t{N}:<path>

  # Show turn metadata:
  git --git-dir=<repo> log --format="%H %s" refs/turn/main/

Reference: ~/just-claude/hooks/snapshot/ (just-claude/snapshots repo)
`;

const specialistToolRuntimePrompt = `Operate inside the tools exposed to your active Mastra Agent instance. Treat tool availability as the runtime contract. Do not assume hidden internals, patched vendor code, unlisted MCP tools, unavailable external services, unavailable shell access, or out-of-band orchestration.`;

const supervisorToolPrompt = `Delegation protocol:
- Delegate only bounded tasks with an objective, scope boundary, evidence threshold, stop condition, and relevant context.
- Use Scout for repository discovery and current-state inspection.
- Use Researcher for docs, ecosystem, package, or version-sensitive evidence when tools exist; require disclosure when external research tools are unavailable.
- Use Architect for module ownership, boundaries, interfaces, state ownership, contracts, invariants, and integration design.
- Use Advisor for critique, hidden assumptions, scope creep, weak acceptance criteria, weak verification, and safer alternatives.
- Use Developer only after the write boundary and central behavior are explicit.
- Use Validator after implementation or whenever claims and evidence need a gate decision.

Tool policy:
- Prefer Mastra workspace tools for project file operations and coding workload inside the configured workspace.
- Treat the current workspace as the execution boundary; do not assume any external infrastructure or lifecycle controls.
- Treat unavailable tools as unavailable; do not pretend browser, external research, MCP, shell, or filesystem access exists when it is not exposed.

Snapshot audit policy:
- After a child/specialist response completes, inspect the returned git_snapshot object.
- After write_file or edit_file mutations, the workflow captures a turn via git commit.
- Query turn diff: git diff refs/turn/main/t{N-1} refs/turn/main/t{N}
- Query session diff: git diff refs/baseline/startup refs/latest
- Pass the git_snapshot object, snapshotRepoPath, turnRef, and baselineRef via input_args for downstream validation

Project-specific execution policy:
- Use the configured Mastra workspace as the normal coding environment.
- Prefer list_files and read_file before deciding on edits.
- Prefer write_file or edit_file for file changes when project-file mutation is required.
- File mutation tool results are not the audit evidence; the post-response git_snapshot object is.
- Use git_snapshot_query with snapshotRepoPath to inspect session/turn diffs before claiming what changed.
- When delegating implementation or validation, pass the git_snapshot object, snapshotRepoPath, turnRef, artifact paths, and diff/log paths through input_args when available so downstream agents can audit the exact work.
- Preserve unrelated worktree changes; never revert user work unless explicitly instructed.`;

export const sharedToolPrompts = {
  specialist: [specialistToolRuntimePrompt],
  supervisor: [supervisorToolPrompt],
} as const;
