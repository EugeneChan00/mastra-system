# Issue #17: Snapshot Observability - RESOLVED

## Status
**READY FOR FIX** - Root cause identified

## Summary

Snapshot observability system has a configuration gap - developer agent doesn't have workspace tools with snapshot recording.

## Root Causes

1. **Path mismatch** (resolved): Test directory was outside workspace
2. **Missing tools** (fix pending): Developer agent has no workspace tools with snapshot recording

## Resolution Path

**Fix:** Update `mastra-agents/src/agents/developer-agent.ts` to include workspace tools.

See sub-issue: `.agents/plans/issue-17a-writefile-mount-failure.md`

## Verification

After fix:
1. write_file returns snapshotPath, snapshotEventId, turnDiff, sessionDiff
2. read_snapshots tool available
3. Turn/session diffs generated after mutations
4. E2E test passes all phases
