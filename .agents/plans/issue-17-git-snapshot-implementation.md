# Issue #17: Implement Git-Based Snapshot Observability

## Status
**OPEN** - Implementation required

## Summary

Replace the current JSONL-based snapshot system with git-based snapshots (similar to `just-claude/snapshots`). This enables proper tree-based diffing, content-addressable deduplication, and efficient session/turn diff queries.

## Problem Statement

Current JSONL-based snapshot system lacks:
1. **Proper diffing** - Cannot do `git diff tree1 tree2` between turns
2. **Content deduplication** - Each mutation stores full file copy, not delta
3. **File reconstruction** - Cannot easily reconstruct file state at turn N
4. **Efficient queries** - Need complex filtering instead of git log/grep

## Reference Implementation

**Source:** `just-claude/snapshots` (cloned at `~/just-claude`)

### Key Files

| File | Purpose |
|------|---------|
| `~/just-claude/hooks/snapshot/capture.ts` | Core snapshot logic - creates git commits |
| `~/just-claude/hooks/snapshot/hook.ts` | Hook entrypoint - dispatches events |
| `~/just-claude/hooks/snapshot/touched.ts` | PostToolUse path tracking |
| `~/just-claude/hooks/snapshot/paths.ts` | Path configuration |
| `~/just-claude/hooks/snapshot/git-ops.ts` | Git wrapper |
| `~/just-claude/micro-apps/palmer/src/snapshots.ts` | Palmer renderer for snapshots |

### Storage Layout

```
~/.agents/snapshots/<agent-type>/<session-id>/snapshots.git/
├── refs/
│   ├── baseline/startup, resume-<iso>, end-<iso>
│   ├── turn/main/t1, t2, t3...
│   └── latest
└── objects/  (git compressed blobs)
```

### Key Functions

**capture.ts:**
- `captureTurn(sessionId, cwd)` - Creates turn commit from PostToolUse paths
- `captureBaseline(sessionId, source, cwd)` - Creates baseline (startup/resume/end)
- `buildCommit(repoPath, cwd, message, parent)` - Stages cwd to bare repo
- `buildCommitFromPaths(repoPath, absPaths, message, parent)` - Stages specific paths

**snapshots.ts (palmer):**
- `turnDiff(repoPath, turnN)` - `git diff refs/turn/main/tN-1 refs/turn/main/tN`
- `sessionDiff(repoPath)` - `git diff baseline/startup refs/latest`
- `parseUnifiedDiff(diff)` - Parses git diff into structured entries

## Implementation Plan

### Phase 1: Hook Integration

Create Mastra agent hooks that call snapshot hooks:
1. Hook into `SessionStart` → call `captureBaseline(sessionId, "startup", cwd)`
2. Hook into `Stop` → call `captureTurn(sessionId, cwd)` 
3. Hook into `SessionEnd` → call `captureBaseline(sessionId, "end", cwd)`
4. Hook into `PostToolUse` → track Write/Edit/MultiEdit paths

**Note:** Need to map Mastra's hook system to Claude Code's hook interface.

### Phase 2: Path Tracking

Adapt `touched.ts` for Mastra's tool names:
```typescript
const WRITE_TOOLS = new Set([
  "write_file", "edit_file", "replaceInFile",
  // Mastra-specific tool names
]);
```

### Phase 3: Git Repo Management

Initialize bare git repo per session:
```
~/.agents/snapshots/mastra-agents/<session-id>/snapshots.git/
```

### Phase 4: Prompt Updates

Update agent prompts to use git-based diff queries.

**Files to update:**
1. `pi/src/prompts/tools.ts` - Add git snapshot query instructions
2. `pi/src/prompts/policy.ts` - Add snapshot verification policy
3. `mastra-agents/src/prompts/tools.ts` - Add git snapshot tool prompts

## Agent Prompt Updates

### pi/src/prompts/tools.ts

Add section:
```typescript
export const SNAPSHOT_OBSERVABILITY_PROMPT = `
Snapshot Observability:
- Use git-based snapshots for turn and session diffs
- Snapshot repo: ~/.agents/snapshots/mastra-agents/<session-id>/snapshots.git
- Turn diff: git diff refs/turn/main/t{N-1} refs/turn/main/t{N}
- Session diff: git diff refs/baseline/startup refs/latest
- List turns: git for-each-ref refs/turn/main/
- Reconstruct file at turn N: git show refs/turn/main/t{N}:<path>
- Query all turns: git log refs/turn/main/
`
```

### pi/src/prompts/policy.ts

Add verification policy:
```typescript
export const SNAPSHOT_VERIFICATION_POLICY = `
Snapshot Verification:
- After delegating to child agents, query turn diff to verify changes
- Use "git --git-dir=<repo> diff <ref1> <ref2>" for turn/session diffs
- Pass snapshotRepoPath, turnRef, sessionRef via input_args
- Do not accept agent claims without inspecting snapshot diffs
`
```

## Verification Queries

### Turn Diff
```bash
git --git-dir=~/.agents/snapshots/mastra-agents/<session-id>/snapshots.git \
  diff refs/turn/main/t2 refs/turn/main/t3
```

### Session Diff  
```bash
git --git-dir=~/.agents/snapshots/mastra-agents/<session-id>/snapshots.git \
  diff refs/baseline/startup refs/latest
```

### List All Turns
```bash
git --git-dir=~/.agents/snapshots/mastra-agents/<session-id>/snapshots.git \
  for-each-ref --format='%(refname:lstrip=3)' refs/turn/main/
```

### File at Turn N
```bash
git --git-dir=~/.agents/snapshots/mastra-agents/<session-id>/snapshots.git \
  show refs/turn/main/t3:path/to/file
```

## Space Efficiency

| Scenario | JSONL | Git |
|----------|-------|-----|
| 100 edits to same file | 100x file size | ~1x file size |
| Small delta to large file | Full copy | Only delta |
| Identical content | Duplicated | Deduplicated |

## Related Files

- `mastra-agents/src/tools/snapshots.ts` - Current JSONL implementation (to be replaced)
- `mastra-agents/src/tools/workspace.ts` - Workspace tools (integrate with hooks)
- `pi/src/mastra/tool.ts` - Mastra agent tools (add snapshot hooks)

## Prompt Updates Completed

### pi/src/prompts/tools.ts
Added `PI_SNAPSHOT_OBSERVABILITY_PROMPT` with git-based snapshot queries.

### mastra-agents/src/prompts/tools.ts  
Added `snapshotObservabilityPrompt` and updated `supervisorToolPrompt` with git snapshot audit policy.

## Issue Number

**Issue #17** - Git-Based Snapshot Observability Implementation

## Implementation Reference

**just-claude/snapshots repo:** `~/just-claude/hooks/snapshot/`

**Key implementation files:**
| File | Purpose | Key Functions |
|------|---------|---------------|
| `capture.ts` | Core snapshot logic | `captureTurn()`, `captureBaseline()`, `buildCommitFromPaths()` |
| `hook.ts` | Hook entrypoint | Dispatches SessionStart/Stop/SessionEnd/PostToolUse |
| `touched.ts` | Path tracking | `extractWritePath()`, `recordTouchedPath()` |
| `paths.ts` | Path config | `snapshotRootDir()`, `snapshotRepoPath()` |
| `git-ops.ts` | Git wrapper | `git()`, `gitAvailable()` |
| `palmer/src/snapshots.ts` | Palmer renderer | `turnDiff()`, `sessionDiff()`, `parseUnifiedDiff()` |

**Storage layout (from just-claude):**
```
~/.agents/snapshots/<agent-type>/<session-id>/snapshots.git/
├── refs/
│   ├── baseline/startup, resume-<iso>, end-<iso>
│   ├── turn/main/t1, t2, t3...
│   └── latest
└── objects/
```

## Labels

- snapshot-observability
- git-based
- verification
- observability
- implementation-required
