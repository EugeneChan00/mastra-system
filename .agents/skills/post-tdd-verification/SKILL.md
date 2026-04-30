---
name: post-tdd-verification
description: Run a post-implementation verification pass after red-green-refactor appears complete. Use when Codex is given an implementation scope, transcript path, GitHub issue or PR, commit refs, branch, or test results and should audit whether tests are meaningful, implementation structure is sound, and the change respects SOLID design principles using three parallel verification subagents.
---

# Post-TDD Verification

Use this skill after an implementation slice claims to be complete and tests pass. The goal is to challenge the quality of the test boundary and the implementation, not to reimplement the feature.

## Inputs

Collect or infer these inputs before dispatch:

- Implementation scope: issue, feature, bug, or behavior the commit claims to handle.
- Git refs: commit SHA, branch, PR URL, base branch, or comparison range.
- Context sources: transcript path, issue URL/number, design notes, implementation plan, or prior audit notes.
- Verification signals: test commands run, failing/passing history, CI status, or known gaps.

If a value is unavailable, mark it explicitly as unknown in the subagent prompts. Do not block on missing metadata if the repo and commit range are enough to audit.

## Dispatch Pattern

Spawn three read-only verification subagents in parallel. Use explorer-style agents when available. Give each agent the same shared inputs and a narrow audit scope. Instruct every agent:

- Do not edit files.
- Inspect the commit diff, relevant tests, and implementation code.
- Use transcript or issue context to compare intended behavior against actual coverage.
- Return findings ordered by severity with file and line references when possible.
- Separate confirmed findings from residual risk.

While agents run, the coordinator may collect lightweight local context, but avoid duplicating the agents' full reviews.

## Agent 1: Test Integrity Audit

Audit red-green-refactor quality.

Ask this agent to find:

- False-positive tests: tests that could pass without exercising the intended behavior.
- Tests that likely would not have failed before the implementation.
- Assertions that only check shape, call count, snapshots, or happy paths while missing the real boundary.
- Tests that assert implementation details instead of externally meaningful behavior.
- Missing tests for lifecycle boundaries, error paths, race conditions, persistence, idempotency, fallback behavior, config limits, and user-visible outcomes.

Require the output to include:

- Test file, line, and test name when available.
- Why the current assertion boundary is weak.
- The concrete behavior a stronger test should prove.

## Agent 2: Structural Implementation Audit

Audit whether the implementation is wired correctly at the code structure level.

Ask this agent to inspect:

- Function definitions and call sites.
- Class instantiation, dependency construction, and lifetime.
- Imports, exports, package boundaries, and registration points.
- Argument parsing, schema validation, defaulting, and config flow.
- Async control flow, event registration, cleanup, cancellation, retry, and error propagation.
- Data contracts between modules, tools, UI surfaces, persistence, and external APIs.
- Dead code, duplicate paths, unreachable branches, stale compatibility shims, and naming drift.

Require the output to explain how each issue can surface at runtime, not just that the code looks untidy.

## Agent 3: SOLID Design Audit

Audit design quality using SOLID as a practical checklist.

Ask this agent to evaluate:

- Single Responsibility: modules or classes doing too many unrelated jobs.
- Open/Closed: places where new states, agents, events, or tools require invasive edits.
- Liskov Substitution: implementations that violate expected interface behavior or state assumptions.
- Interface Segregation: broad APIs, overloaded tools, or callers forced to know irrelevant fields.
- Dependency Inversion: high-level logic depending directly on concrete transport, storage, UI, or runtime details.

Also ask for overengineering risks. A SOLID audit should not push abstractions unless they reduce real coupling or make the current scope safer.

## Coordinator Output

Merge the three reports into a concise final audit:

- Findings first, ordered by severity.
- Label each finding source: `test-integrity`, `structural`, `solid`, or `cross-cutting`.
- Include exact file links and line numbers when available.
- Call out duplicate findings once, with combined evidence.
- Include a short "Missing Tests" section if test gaps are the main result.
- Include a short "Residual Risk" section for concerns that could not be confirmed.
- Do not claim the implementation is verified unless all three audits found no material issues and the relevant tests or CI were actually checked.

If the user asks for fixes after the audit, make a separate plan from the findings before editing.
