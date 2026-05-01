# End-to-End Snapshot Observability Test Plan

## Purpose

Prove that Mastra agent snapshot observability works end to end when agents actually mutate files.

The test should demonstrate that an orchestrator can:

1. Ask child/specialist agents to write and revise files.
2. Observe session and turn snapshot paths produced by each agent run.
3. Query the snapshot store after each run.
4. Compare turn/session diffs against expected file mutations.
5. Detect add, edit, subtract, and delete behavior inside a controlled test directory.

## Scope

### In scope

- A controlled directory under the user's home directory:
  - `~/test-writing-register/`
- Markdown story files created and modified by agents.
- Snapshot artifacts under:
  - `/workspace/.agents/exec/snapshots/mastra-agents/...`
- Session diff and turn diff inspection.
- Agent completion reminders and snapshot metadata.
- Orchestrator-side audit notes comparing expected vs observed mutations.

### Out of scope

- Product code changes.
- CI integration.
- Performance benchmarking.
- Snapshot retention/cleanup policy.
- Full UI automation.

## Test Directory

Create a clean test directory:

```bash
mkdir -p ~/test-writing-register
```

Use only this directory for file mutations during the test.

Expected files are Markdown stories, for example:

```text
~/test-writing-register/story-alpha.md
~/test-writing-register/story-beta.md
~/test-writing-register/story-gamma.md
```

## Actors

### Orchestrator

The parent/orchestrator agent coordinates all child runs and records observed snapshot evidence.

Responsibilities:

- Dispatch bounded child-agent writing tasks.
- Read each child completion reminder.
- Extract snapshot metadata:
  - `snapshotRepoPath`
  - `sessionSnapshotPath`
  - `turnSnapshotPath`
  - `sessionDiffPath`
  - `turnDiffPath`
  - `turnRef`
  - `turnNumber`
- Query and inspect each diff file.
- Compare observed diffs with expected mutations.
- Produce final observability report.

### Child agents

Child agents perform file mutations only inside `~/test-writing-register/`.

Each child task should be narrow and independently auditable.

## Execution Plan

### Phase 0 — Setup

1. Create the test directory:

   ```bash
   mkdir -p ~/test-writing-register
   ```

2. Ensure the directory starts empty or record any existing files as pre-existing state.

3. Record the baseline:

   ```bash
   find ~/test-writing-register -maxdepth 1 -type f -print | sort
   ```

4. Start the observation log in the repo, for example:

   ```text
   .agents/exec/snapshot-observability-report.md
   ```

## Phase 1 — Add files

Dispatch a child agent with this task:

```text
Create two Markdown story files in ~/test-writing-register/:

1. story-alpha.md
2. story-beta.md

Each file should contain:
- A title
- 2 short paragraphs
- A one-line moral

Do not edit files outside ~/test-writing-register/.
Return the files changed and any snapshot metadata available.
```

Expected mutations:

- `story-alpha.md` added.
- `story-beta.md` added.

Expected turn diff:

- New file sections for both files.
- Added lines for title, paragraphs, and moral.

Expected session diff:

- Same as turn diff if this is the first mutating turn for the child/session.

Orchestrator checks:

1. Read child completion reminder.
2. Extract `turnDiffPath` and `sessionDiffPath`.
3. Read both diff files.
4. Confirm both story files appear in the turn diff.
5. Confirm added Markdown content appears as `+` lines.

## Phase 2 — Edit / subtract content

Dispatch a second child agent with this task:

```text
Edit files only under ~/test-writing-register/:

1. In story-alpha.md, add a new section titled "## Revision" with one short paragraph.
2. In story-beta.md, remove the moral line.

Do not edit files outside ~/test-writing-register/.
Return the files changed and any snapshot metadata available.
```

Expected mutations:

- `story-alpha.md` modified with added section.
- `story-beta.md` modified with moral removed.

Expected turn diff:

- `story-alpha.md` contains added `## Revision` lines.
- `story-beta.md` contains removed moral line as `-...`.

Expected session diff:

- Accumulates Phase 1 additions plus Phase 2 edits relative to session baseline.

Orchestrator checks:

1. Read latest `turnDiffPath`.
2. Confirm additive lines for `story-alpha.md`.
3. Confirm subtractive lines for `story-beta.md`.
4. Read latest `sessionDiffPath`.
5. Confirm session diff reflects cumulative state, not only the latest turn.

## Phase 3 — Add another file

Dispatch a third child agent with this task:

```text
Create one new Markdown story file under ~/test-writing-register/:

- story-gamma.md

The story should include:
- A title
- 1 short paragraph
- A bullet list of 3 lessons

Do not edit files outside ~/test-writing-register/.
Return the files changed and any snapshot metadata available.
```

Expected mutations:

- `story-gamma.md` added.

Expected turn diff:

- New file section for `story-gamma.md`.
- Added title, paragraph, and bullet list.

Expected session diff:

- Includes `story-alpha.md`, `story-beta.md`, and `story-gamma.md` final cumulative state.

Orchestrator checks:

1. Confirm `story-gamma.md` appears in the turn diff.
2. Confirm session diff includes all three story files.

## Phase 4 — Delete a file

Dispatch a fourth child agent with this task:

```text
Delete only this file:

~/test-writing-register/story-beta.md

Do not edit or delete anything else.
Return the files changed and any snapshot metadata available.
```

Expected mutations:

- `story-beta.md` deleted.

Expected turn diff:

- Removed file content for `story-beta.md` appears as `-` lines.

Expected session diff:

- `story-beta.md` no longer appears as an added current file.
- `story-alpha.md` and `story-gamma.md` remain present.

Orchestrator checks:

1. Confirm `story-beta.md` deletion appears in turn diff.
2. Confirm `story-beta.md` is absent from final filesystem state.
3. Confirm session diff represents final cumulative state.

## Phase 5 — Out-of-scope guard

Dispatch a child agent with this task:

```text
Inspect ~/test-writing-register/ and report the files present.
Do not write, edit, or delete any files.
```

Expected mutations:

- None.

Expected turn diff:

```text
(no snapshot diff)
```

Orchestrator checks:

1. Confirm snapshot exists if the workflow captures read-only turns.
2. Confirm turn diff shows no changes.
3. Confirm no write/edit event log entries were created for this read-only turn.

## Snapshot Evidence to Collect Per Turn

For each child-agent run, record:

```markdown
### Turn N — <agent id / job id>

- jobId:
- agentId:
- snapshotRepoPath:
- sessionSnapshotPath:
- turnSnapshotPath:
- sessionDiffPath:
- turnDiffPath:
- turnRef:
- turnNumber:
- artifactPath:

Expected mutation:

Observed turn diff summary:

Observed session diff summary:

Pass/fail:

Notes:
```

## Acceptance Criteria

The observability test passes only if:

1. Every mutating child-agent run emits or produces queryable snapshot metadata.
2. Every mutating child-agent run has a readable `turnDiffPath`.
3. Every mutating child-agent run has a readable `sessionDiffPath`.
4. Added files appear in turn diffs for add phases.
5. Edited files show both added and removed lines when applicable.
6. Deleted files show removed content in the turn diff.
7. Session diffs accumulate final state across turns.
8. Read-only child-agent run produces no content diff.
9. No diff includes unrelated files outside `~/test-writing-register/`, except known snapshot/system metadata explicitly classified as noise.
10. The orchestrator can cite snapshot paths and diff evidence before accepting child-agent claims.

## Failure Conditions

Fail the test if any of these occur:

- A child agent mutates files but no snapshot path is available.
- A child agent mutates files but `turnDiffPath` is missing or unreadable.
- A child agent mutates files but the expected file path is absent from the turn diff.
- `sessionDiffPath` does not reflect cumulative state.
- A child agent edits outside `~/test-writing-register/`.
- The orchestrator accepts a child-agent claim without inspecting snapshot evidence.

## Final Report Shape

The final report should include:

```markdown
# Snapshot Observability E2E Report

## Status

PASS | FAIL | PARTIAL

## Environment

- repo:
- branch:
- commit:
- test directory:
- timestamp:

## Turns

<one section per child-agent run>

## Snapshot Paths Observed

<table or bullet list>

## Diff Evidence

- Add evidence:
- Edit evidence:
- Subtract evidence:
- Delete evidence:
- Read-only no-op evidence:

## Scope Audit

- Files expected:
- Files actually changed:
- Out-of-scope files:

## Residual Risks

## Conclusion
```

## Cleanup Plan

Cleanup should be explicit and separate from the test unless the user requests it:

```bash
rm -rf ~/test-writing-register
```

Do not clean up automatically if the user wants to inspect snapshot artifacts afterward.
