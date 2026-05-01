# Validator Agent System Prompt Review

## Current State Summary

The Validator agent is defined in `mastra-agents/src/agents/validator-agent.ts:14-28` and composed from five prompt groups:

```
validatorInstructionsPrompt
  + sharedPolicyPrompts.specialist
  + sharedToolPrompts.specialist
  + validatorPolicyPrompts
  + validatorToolPrompts
```

The final instruction string is produced by `composeAgentInstructions()` (`shared.ts:101-118`), which concatenates all non-empty prompt groups under a single `# Runtime Policy And Tooling` header with no internal section breaks.

**What is actually there:**

- `validatorInstructionsPrompt` (`validator.ts:20-31`): 12-line role definition + "Use Validator for" list
- `sharedPolicyPrompts.specialist` (`policy.ts:78-84`): 5 policies (evidence discipline, scope discipline, prompt-vs-code, response policy, blocker protocol)
- `sharedToolPrompts.specialist` (`tools.ts:24`): 1 prompt (specialistToolRuntimePrompt)
- `validatorPolicyPrompts` (`validator.ts:93`): 2 prompts (validatorPoliciesPrompt + validatorOutputPrompt)
- `validatorToolPrompts` (`validator.ts:95-97`): empty array

---

## First-Principle Analysis

### 1. Role Definition (`validatorInstructionsPrompt`)

**Ground truth:** The agent is told it is "a focused Mastra supervisor-delegated specialist agent" whose role is "read-only validation of diffs, tests, contracts, integration evidence, and claims" (line 24). The "Use Validator for" list (lines 26-30) describes judgment tasks: judging implementation satisfaction, checking slice reality, auditing artifacts, looking for false positives, deciding pass/fail.

**First principles:** A Validator must believe, before any action:
- Its job is to judge, not to implement
- It operates on claims and evidence, not on code
- Its output is a gate decision, not a fix
- It is invoked by a supervisor who retains architectural authority

**Gap analysis:** The role definition is correct but the "Use Validator for" list mixes high-level tasks with agent-selection guidance ("deciding whether the artifact should pass, conditionally pass, fail, or be blocked" at line 31). The latter is actually a *output* of validation, not a use case for *when to invoke* the Validator. This could cause a supervisor to invoke the Validator prematurely — before there is an artifact to judge.

### 2. Read-Only Constraint is Fragile

**Ground truth:** `validatorPoliciesPrompt` line 37 (validator.ts:37) states: "Stay read-only unless the supervisor explicitly changes the task into corrective implementation." The word "explicitly" signals a strong constraint.

**First principles:** A read-only agent must not attempt implementation even when blocked.

**Gap analysis:** `sharedPolicyPrompts.specialist` contains `blockerProtocolPrompt` (`policy.ts:11-16`) which states:
> "Complete the maximum safe partial analysis or implementation inside the stated boundary."
> "Do not silently expand scope, create new resources, or substitute a different task to get around a blocker."

The word "implementation" in `blockerProtocolPrompt` directly conflicts with the Validator's read-only constraint. A read-only Validator that follows `blockerProtocolPrompt` verbatim will attempt implementation when blocked — violating line 37 of `validatorPoliciesPrompt`.

This is a **structural conflict** baked into the composition at `validator-agent.ts:18-24`. The specialist policies were written for agents that can implement; they are applied wholesale to an agent that cannot.

**Causal trace:** If the Validator encounters a missing file it needs to inspect, it faces two contradictory directives: (a) preserve the blocker and report it (validatorPolicyPrompts) vs. (b) complete partial implementation to work around it (blockerProtocolPrompt). In practice, the model likely follows the more specific policy (validatorPolicyPrompts) but this is not guaranteed.

### 3. Tool Prompts Are Effectively Absent

**Ground truth:** `validatorToolPrompts` is an empty array (`validator.ts:95-97`). `sharedToolPrompts.specialist` contains only `specialistToolRuntimePrompt` (`tools.ts:1`), which says the Validator should "Operate inside the tools exposed to your active Mastra Agent instance."

**First principles:** A Validator must be able to:
- Read files and diffs
- Execute commands (tests, type checks, build)
- Search across code
- Inspect tool output

**Gap analysis:** The Validator has no explicit guidance on:
- How to judge whether a command actually exercised the behavior under test
- How to distinguish "tool ran" from "tool proved the claim"
- What to do when a tool's output is ambiguous or partial

The `specialistToolRuntimePrompt` is generic to all specialists. The Validator's tool interactions are judgment-heavy (did this test actually cover the change?) not execution-heavy. No Validator-specific tool guidance exists.

### 4. Gate Decision Framework is Strong

**Ground truth:** `validatorPoliciesPrompt` lines 33-88 define a rigorous gate system:
- PASS / CONDITIONAL PASS / FAIL / BLOCKED with explicit definitions (lines 39-44)
- Evidence sufficiency checks (lines 46-50)
- False-positive taxonomy (lines 52-56): Type A (coverage theater) and Type B (wrong-reason pass)
- Integration reality checks (lines 58-63)
- Check-run classification (lines 70-76): VERIFIED / DECLINED_BY_DESIGN / UNAVAILABLE_TOOL / UNAVAILABLE_DEPENDENCY / NOT_ATTEMPTED / ATTEMPTED_WITH_ERROR
- Residual risk standard (lines 78-83)
- Remediation and recheck (lines 85-88)

**First principles:** This is the core of what a Validator should do. The framework is well-designed.

**Gap analysis:**
1. The false-positive taxonomy (lines 52-56) is excellent but not connected to the gate decision checks. A FAIL decision should explicitly cite which false-positive type was found.
2. The "central behavior" concept appears in multiple places (lines 36, 48, 63) but is never explicitly defined in the prompt. The Validator must infer what "central behavior" means for each slice.
3. The residual risk standard (lines 78-83) and remediation guidance (lines 85-88) exist but the output format (`validatorOutputPrompt`, line 90-91) does not mandate them as fields. A Validator could produce a complete gate decision without naming residual risks or remediation steps.

### 5. Mode Prompts Lack Anchor Points

**Ground truth:** `validatorModePrompts` (`validator.ts:5-18`) defines four modes: balanced, test, audit, debug. Each mode prompt is 2-3 sentences of behavioral guidance.

**First principles:** A mode prompt should tell the Validator what *evidence to look for* and *what questions to ask*, not just what tone to adopt.

**Gap analysis:** The debug mode prompt (line 15-17) is the strongest: "Investigate a failing or suspicious behavior from evidence to likely cause. Name the smallest next check or fix boundary when proof is incomplete." This gives the Validator a concrete action (trace backward from effect to cause).

By contrast, the audit mode prompt (lines 12-14) says "Prioritize behavioral regressions, missing tests, and boundary violations" but does not explain *how* to find these — it describes the target domain, not the investigation method.

### 6. Composition Produces No Internal Structure

**Ground truth:** `composeAgentInstructions()` (`shared.ts:101-118`) produces:

```
[validatorInstructionsPrompt]

# Runtime Policy And Tooling

[sharedPolicyPrompts.specialist items]
[sharedToolPrompts.specialist items]
[validatorPolicyPrompts items]
```

All items are concatenated under a single header with `\n\n` separators. No section breaks between the role definition, the specialist policies, and the Validator-specific policies.

**First principles:** A Validator needs a clear hierarchy: (1) Who I am, (2) What I must do before judging, (3) How I judge, (4) What I output. The specialist policies混入 (mix in) language appropriate for build agents into a read-only Validator.

**Gap analysis:** When the model reads its instructions, it receives them as a flat list. The structural conflict between "read-only" and "partial implementation" is not visually separated — it appears as contradictory adjacent directives. A section-based structure would make the read-only constraint visually dominant.

---

## Specific Improvement Recommendations

### REC-1: Separate Read-Only Constraint into Its Own Section

**Why needed:** The read-only constraint (`validatorPoliciesPrompt` line 37) is the most important behavioral rule for the Validator. It is currently embedded in the middle of `validatorPoliciesPrompt` and contradicts `blockerProtocolPrompt` from the shared specialist policies. A supervisor-delegated read-only agent must have its constraint visibly dominant.

**Current text (validator.ts:37):**
```
- Stay read-only unless the supervisor explicitly changes the task into corrective implementation.
```

**Recommended:** Add a first-class "Read-Only Constraint" section at the top of `validatorPoliciesPrompt` (before "Validation setup"), or elevate it to the `validatorInstructionsPrompt` role definition. The constraint should be the very first thing the model reads after the role name.

**Causal chain:** If the read-only constraint is visually prominent (top of instructions), the model will weight it higher than `blockerProtocolPrompt`'s "partial implementation" language, even when both are present in the flat instruction list.

### REC-2: Remove or Reframe `blockerProtocolPrompt` for the Validator

**Why needed:** `blockerProtocolPrompt` (`policy.ts:11-16`) contains "Complete the maximum safe partial analysis or implementation" — "implementation" is out-of-scope for the Validator. Applying this policy verbatim to a read-only agent is a structural drag that creates contradictory directives.

**Current text (policy.ts:12-13):**
```
- Complete the maximum safe partial analysis or implementation inside the stated boundary.
- Preserve the exact blocker instead of pretending the task is complete.
```

**Recommended (option A — remove):** Do not include `blockerProtocolPrompt` in the Validator's composition. The Validator's blocker behavior is already captured by the BLOCKED gate decision (validator.ts:43) and the "maximum safe partial analysis" concept can be achieved by the gate decision framework alone.

**Recommended (option B — reframe):** If the blocker protocol is desired for consistency, replace "partial analysis or implementation" with "partial analysis only" and explicitly invoke the gate framework for blocked work.

**Causal chain:** If blockerProtocolPrompt is removed (option A), the Validator will no longer receive contradictory implementation language and will default to the BLOCKED gate decision when it cannot proceed. If retained (option B), the reframe ensures partial work stays within read-only bounds.

### REC-3: Add a "When to Invoke Validator" Section to the Supervisor's Delegation Guidance

**Why needed:** `validatorInstructionsPrompt` line 31 says "Use Validator for... deciding whether the artifact should pass, conditionally pass, fail, or be blocked" — this describes the Validator's output, not the trigger for invocation. The supervisor needs guidance on *when* to invoke the Validator (after a build step? before a release? both?).

**Current text (validator.ts:26-31):**
```
Use Validator for:
- judging whether an implementation satisfies the stated behavior and boundary
- checking whether the current slice is real and integrated or merely preparatory
- auditing diffs, tests, command output, contracts, tool evidence, and residual risk
- looking for false positives, weak oracles, mocked-away integration, missing tests, and architecture drift
- deciding whether the artifact should pass, conditionally pass, fail, or be blocked
```

**Recommended:** Reframe line 31 to be invocation-guidance:
```
Invoke Validator when: an implementation artifact exists and needs a gate decision before the next phase or release.
```

This belongs in the Supervisor's delegation guidance (`supervisorToolPrompt` at `tools.ts:3-10`), not in the Validator's own instructions.

**Causal chain:** If the supervisor knows to invoke the Validator after an artifact exists, the Validator will less frequently be asked to judge a non-existent or in-progress slice.

### REC-4: Define "Central Behavior" Explicitly

**Why needed:** "Central behavior" appears in `validatorPoliciesPrompt` at lines 36, 48, and 63 but is never defined. For every gate decision, the Validator must identify the central behavior under review. Without a definition, the model must infer it each time, risking inconsistent identification.

**Recommended:** Add to `validatorPoliciesPrompt` after "Validation setup" (line 33):
```
Central behavior: the specific runtime behavior that the slice claims to implement or change, expressed as a capability or observable output that a user or downstream module would depend on. The central behavior is not the implementation detail, not the test, not the artifact — it is what the slice enables.
```

**Causal chain:** If "central behavior" is explicitly defined, the Validator will consistently identify it before judging evidence, producing more reliable gate decisions.

### REC-5: Connect False-Positive Taxonomy to Gate Decision

**Why needed:** The false-positive taxonomy (`validator.ts:52-56`) is strong and specific but exists independently of the gate decision. A Validator could produce a FAIL decision without citing the false-positive type, missing an opportunity to communicate *why* the evidence failed to prove the claim.

**Recommended:** Add to the FAIL definition in gate decision discipline (validator.ts:42-43):
```
- FAIL: evidence contradicts the claim, the implementation misses required behavior, or a required check could have run but was not attempted. Classify the failure type: Type A false positive (coverage theater), Type B false positive (wrong-reason pass), or integration gap (boundary not crossed).
```

**Causal chain:** If FAIL decisions cite false-positive type, the supervisor can distinguish between "the tests exist but are useless" (Type A) vs. "the tests pass for the wrong reasons" (Type B) vs. "no integration test exists" (integration gap) — each requiring different remediation.

### REC-6: Mandate Residual Risk and Remediation in Output Format

**Why needed:** `validatorOutputPrompt` (`validator.ts:90-91`) says "prefer a concise validation brief with... residual risk, remediation, and recheck instructions **when those fields are useful**." The phrase "when useful" means they are optional. But residual risk and remediation are essential to making a CONDITIONAL PASS actionable.

**Current text (validator.ts:90-91):**
```
When reporting, prefer a concise validation brief with claim, status, decision, findings, evidence, evidence sufficiency, oracle quality, integration reality, verification gaps, contract or architecture drift, residual risk, remediation, and recheck instructions when those fields are useful.
```

**Recommended:** Change "when those fields are useful" to "when the decision is CONDITIONAL PASS or FAIL." Residual risk and remediation are not optional for CONDITIONAL PASS — they are the condition that must be rechecked.

**Causal chain:** If residual risk and remediation are mandatory for CONDITIONAL PASS, the supervisor receives an explicit recheck path instead of an ambiguous "needs more testing" signal.

### REC-7: Add Validator-Specific Tool Prompts

**Why needed:** `validatorToolPrompts` is empty. Validation work requires the Validator to judge whether a command actually exercised the claimed behavior. The generic `specialistToolRuntimePrompt` tells the Validator *what tools exist* but not *how to validate with them*.

**Recommended:** Add to `validatorToolPrompts`:
```
Validation command policy:
- Run the actual command, not a proxy command. If the claim is about a type check, run the type check; do not infer it from a successful compile.
- Preserve exact command output. Do not summarize error messages before reporting them.
- Distinguish "command exited 0" from "command proved the claim." A passing test that exercises the wrong code is a Type B false positive.
- When inspecting tool output, name the specific lines or sections that are evidence, not just that output was produced.
```

**Causal chain:** If tool prompts explicitly address the "did the command prove the claim" question, the Validator will produce stronger oracle quality assessments.

### REC-8: Strengthen Mode Prompts with Investigation Methods

**Why needed:** The audit mode prompt (`validator.ts:12-14`) names target domains (behavioral regressions, missing tests, boundary violations) but not investigation methods. The debug mode prompt is stronger because it gives a method: "investigate from evidence to likely cause."

**Current audit mode (validator.ts:12-14):**
```
audit: `Validator Audit mode:
- Review claims, diffs, contracts, and evidence for correctness and gaps.
- Prioritize behavioral regressions, missing tests, and boundary violations.`,
```

**Recommended:** Reframe as investigation steps:
```
audit: `Validator Audit mode:
- Establish the baseline: what behavior, contracts, and architecture existed before the change.
- Compare the diff against the baseline: what changed, what was added, what was removed.
- For each change, ask: does evidence prove this change works? Does it prove integration? Does it prove no regression?
- Report gaps by category: missing evidence, false-positive evidence, architectural drift, and contract violations.`,
```

**Causal chain:** If the audit mode prompt gives a method (compare baseline vs. change, then categorize gaps), the Validator produces more systematic audits instead of impressionistic reviews.

---

## Drag vs. Gain Classification

| Change | Classification | Mechanism |
|--------|---------------|-----------|
| REC-1: Separate read-only constraint | **Compounding gain** | Reduces contradictory-directive confusion; read-only violations are the highest-stakes failure for this agent |
| REC-2: Remove blockerProtocolPrompt | **Compounding gain** | Eliminates structural conflict between specialist and read-only constraints; fewer contradictory directive inputs |
| REC-3: Add invocation guidance to supervisor | **Compounding gain** | Reduces premature Validator invocation; Validator output is only useful when an artifact exists |
| REC-4: Define "central behavior" | **Compounding gain** | Reduces inconsistent gate decision framing across Validator invocations |
| REC-5: Connect false-positive taxonomy to FAIL | **Compounding gain** | Makes failure mode communication precise; supervisor can route to correct remediation owner |
| REC-6: Mandate residual risk for CONDITIONAL PASS | **Compounding gain** | Transforms CONDITIONAL PASS from ambiguous hedge to actionable recheck contract |
| REC-7: Add Validator tool prompts | **Compounding gain** | Addresses the tool-guidance gap; reduces "oracle quality" being skipped when tools are used |
| REC-8: Strengthen audit mode with method | **Compounding gain** | Makes audit mode systematic rather than impressionistic; reduces review variability |

---

## Conflicts and Gaps

**Structural conflict (confirmed):** `blockerProtocolPrompt` ("complete the maximum safe partial analysis or implementation") applied via `sharedPolicyPrompts.specialist` directly contradicts `validatorPoliciesPrompt` line 37 ("Stay read-only"). This is the most significant gap. Resolution is required before the Validator can be relied upon for high-stakes gate decisions.

**Evidence gap (low confidence):** The composition logic (`composeAgentInstructions`) has no mechanism to exclude specific shared policies for specific agent types. The structural conflict in REC-2 cannot be resolved without either (a) changing how composition works to allow per-agent policy filtering, or (b) creating a `sharedPolicyPrompts.validator` variant that excludes `blockerProtocolPrompt`. The current architecture makes option (a) or (b) the correct path; patching around the conflict at the prompt level is a workaround, not a fix.

**Missing evidence:** No test or inspection protocol exists to verify that the Validator's gate decisions are consistent across invocations. The false-positive taxonomy (REC-5) and residual risk mandate (REC-6) improve decision quality but do not provide verification. A `validator_developer_worker` or test harness audit of Validator decision consistency is outside this slice but noted as a dependency for validating the improvements above.

---

## Self-Validation Log

- Read `validator-agent.ts` — confirmed composition structure (lines 14-28)
- Read `validator.ts` — confirmed prompt content (lines 1-98)
- Read `policy.ts` — confirmed `sharedPolicyPrompts.specialist` contents (lines 78-84); confirmed `blockerProtocolPrompt` contains "implementation" (line 12)
- Read `tools.ts` — confirmed `sharedToolPrompts.specialist` is a single generic prompt (line 24); confirmed `validatorToolPrompts` is empty (validator.ts:95-97)
- Read `shared.ts` — confirmed `composeAgentInstructions` produces flat concatenation with no structural separation (lines 101-118)
- Ran `rg` for "implementation" in policy.ts — confirmed line 12 is the only instance of implementation language in blockerProtocolPrompt
- Confirmed no AGENTS.md exists in `mastra-agents/src/` that would override these instructions

**Stop condition met:** Analysis complete for the dispatched slice (Validator agent system prompt review). All 8 recommendations are scoped to the Validator's instructions and composition. Architectural recommendations for composition infrastructure (per Evidence Gap above) are flagged as adjacent work outside this slice.
