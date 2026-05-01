# Developer Agent System Prompt Review

## Current State Summary

The Developer agent is composed via `composeAgentInstructions` in `developer-agent.ts:18-24`:

```
instructions: composeAgentInstructions(
  developerInstructionsPrompt,           // Role definition
  sharedPolicyPrompts.specialist,        // 5 shared policies
  sharedToolPrompts.specialist,          // 1 tool prompt
  developerPolicyPrompts,                // [developerPoliciesPrompt, developerOutputPrompt]
  developerToolPrompts,                  // Empty array
)
```

**What exists:**

| Component | Source | Lines | Content |
|-----------|--------|-------|---------|
| `developerInstructionsPrompt` | `prompts/agents/developer.ts` | 18-29 | Role definition: "focused Mastra supervisor-delegated specialist agent" |
| `developerPoliciesPrompt` | `prompts/agents/developer.ts` | 31-79 | Implementation authority, phase gates, write boundary discipline, contract preservation, implementation discipline, integration evidence, verification discipline, adversarial self-check |
| `developerOutputPrompt` | `prompts/agents/developer.ts:81-82` | Single line | Output format preference |
| `sharedPolicyPrompts.specialist` | `prompts/policy.ts:77-84` | 5 policies | Evidence discipline, scope discipline, prompt-vs-code, response policy, blocker protocol |
| `sharedToolPrompts.specialist` | `prompts/tools.ts:1` | Single prompt | Tool runtime constraint |

**Missing from composition:**

`specialistToolRuntimePrompt` ("Operate inside the tools exposed to your active Mastra Agent instance...") is **not composed** into the Developer agent, despite being in `sharedToolPrompts.specialist`. The Developer agent receives `sharedPolicyPrompts.specialist` but **not** `sharedToolPrompts.specialist`.

---

## First-Principle Analysis

### 1. Role Definition (`developerInstructionsPrompt`, lines 18-29)

**Ground truth:** The prompt says the Developer is "a focused Mastra supervisor-delegated specialist agent" and lists use cases.

**First principles:** Before taking any action, the Developer agent should know:
- What "focused" means operationally
- What "clearly bounded" requires to be true
- What "vertical slice" means in size/complexity terms
- What the Mastra workspace is and which one is in scope
- What authority is delegated vs retained by supervisor

**Gap analysis:**
- "Focused" appears 3 times but is never operationally defined
- "Clearly bounded" and "explicit" are used as threshold conditions but no criteria exist for what "bounded enough" looks like
- "Vertical slice" is used without size/complexity guidance
- "Mastra workspace" is singular and assumed known; no confirmation protocol for which workspace
- The mode prompts ("balanced", "build", "verify") add mode-specific behavior but have no explicit criteria for when each applies

**Causal trace:** If the agent cannot determine whether a task is "sufficiently bounded," it either over-requests confirmation (blocking) or proceeds on insufficient clarity (scope drift risk).

---

### 2. Phase Gate Before Editing (`developerPoliciesPrompt`, lines 37-42)

**Ground truth:**
```
Phase gate before editing:
- Restate the write boundary and central behavior.
- Read the relevant files first.
- Identify public contracts, exported types, schemas, config surfaces, permissions, tests, or user-facing behavior that must be preserved.
- Confirm the target file or section is inside the boundary.
- If any item is missing, report what is missing and do not mutate.
```

**First principles:** Before mutating, the agent should confirm: (a) it has the boundary, (b) it has the central behavior, (c) it has the required context, (d) it has authority, and (e) the target is inside the boundary.

**Gap analysis:**
- "If any item is missing, report what is missing and do not mutate" (line 42) is an unconditional stop. This is correct for missing boundary/authority but may be overly strict for missing peripheral context that is not required for the central behavior.
- "Read the relevant files first" (line 39) is correct but has no stopping criterion — the agent could read excessively before acting.
- "Identify public contracts..." (line 40) lists items but does not say how many must be confirmed vs how many are "nice to have."
- The phrase "required context" in line 34 is never elaborated; no criteria exist for what makes context "required."

**Causal trace:** The unconditional "do not mutate" could cause the agent to stop on minor missing context that does not actually prevent safe implementation. The agent has no guidance for distinguishing blocking vs non-blocking missing context.

---

### 3. Write Boundary Discipline (`developerPoliciesPrompt`, lines 44-49)

**Ground truth:**
```
Write boundary discipline:
- Mutate only inside the explicit write boundary.
- Do not widen behavior, acceptance criteria, error handling, dependencies, workflows, prompts, or tests without explicit renegotiation.
- Do not refactor, reformat, or restyle unrelated code even if it appears inconsistent.
- Distinguish in-scope style alignment from unrelated cleanup.
- Preserve existing user changes and inspect before editing.
```

**First principles:** The agent should know exactly what is in-scope to change and treat everything else as off-limits.

**Gap analysis:**
- "Distinguish in-scope style alignment from unrelated cleanup" (line 48) is correct but has no concrete examples. An agent may classify style alignment too broadly.
- "Preserve existing user changes and inspect before editing" (line 49) correctly prevents accidental clobbering but gives no guidance on *how* to inspect or what "inspect" means operationally.
- The phrase "explicit renegotiation" correctly requires supervisor approval but does not address what happens if the agent notices the boundary is wrong (too narrow for correct implementation).

**Causal trace:** Without examples of "in-scope style alignment," the agent may either over-expand (claiming style alignment is in-scope when it is cleanup) or under-apply (refusing legitimate style work that makes the implementation coherent).

---

### 4. Contract Preservation (`developerPoliciesPrompt`, lines 51-54)

**Ground truth:**
```
Contract preservation:
- Before finalizing, verify the implementation against named contracts: API signatures, type exports, config schemas, permission rules, workflow interfaces, prompt contracts, or known invariant outputs.
- If a change would alter a public interface, exported type, schema, scorer, memory behavior, or security boundary, name the change before applying it.
- Do not silently update tests to match broken behavior.
```

**This section is the strongest.** The explicit enumeration of contract types (API signatures, type exports, config schemas, permission rules, workflow interfaces, prompt contracts, invariant outputs) gives the agent concrete things to check. The "do not silently update tests" rule prevents false verification.

**Gap analysis:**
- "Known invariant outputs" is vague — how does the agent know what the invariant outputs are?
- "Scorer" is mentioned but Mastra scorers are not otherwise referenced; context may be missing.
- The section addresses *what* to preserve but not *how* to verify preservation. No mention of running type checks, API contracts tests, or schema validation.

**Causal trace:** This section prevents silent contract breakage, which is a real failure mode. The primary gap is verification method, not intent.

---

### 5. Integration Evidence (`developerPoliciesPrompt`, lines 63-67)

**Ground truth:**
```
Integration evidence:
- After implementing, run the smallest command that exercises the central behavior or cross-boundary path.
- Do not treat local compilation as integration proof when the central claim requires runtime, workflow, API, or tool-chain behavior.
- Report the exact command string, result, and what the output proves.
- If integration evidence cannot be produced inside the boundary or available tools, name the claim as unverified and state the next smallest check.
```

**First principles:** After implementation, the agent must demonstrate that the central claim actually works, not just that it compiles.

**Gap analysis:**
- "Smallest command" is not defined and could vary widely in practice.
- The section correctly distinguishes compilation from integration but **does not say what tools are available** to run integration tests. This is a critical omission: the agent is told to run commands but is not reminded what commands/tools it has access to.
- The section references "available tools" but no tool policy is composed into the Developer agent (see `specialistToolRuntimePrompt` gap).

**Causal trace:** An agent following this policy will attempt to run integration evidence but may not know what tools it has, leading to either false "unverified" claims or attempts to use tools that don't exist.

---

### 6. Verification Discipline (`developerPoliciesPrompt`, lines 69-73)

**Ground truth:**
```
Verification discipline:
- A meaningful verification produces real output, would fail if the central claim were false, and fits the current boundary.
- If a command was not run, state not run and the blocker.
- Do not report a command as passing if output contains errors or a non-zero status.
- Preserve useful error output. Do not smooth it into generic failure language.
```

**First principles:** Verification must be honest, falsifiable, and preserve evidence.

**Gap analysis:**
- "Would fail if the central claim were false" — this is the correct falsifiability criterion but the agent may not be able to determine this in practice without understanding the claim deeply.
- "Preserves useful error output" and "do not smooth" are correct but ambiguous. What counts as "useful"? The agent may discard context it doesn't understand.
- The section correctly identifies that passing status with errors should not be reported as passing, but gives no guidance on what "errors" means (warnings? stderr? non-zero exit? all of these?).

**Causal trace:** Without clear criteria for what constitutes an error and what counts as "useful" output, the agent may sanitize error output in ways that hide actionable information.

---

### 7. Adversarial Self-Check (`developerPoliciesPrompt`, lines 75-79)

**Ground truth:**
```
Adversarial self-check before reporting:
- Ask whether the change could look correct while failing on a different input, environment, or edge case.
- Ask whether the verification oracle is real or tautological.
- Ask whether the change creates architecture drift, contract drift, or hidden scope expansion.
- If verification is weak, name the gap and the next smallest check that would close it.
```

**First principles:** The agent should challenge its own work before reporting it as complete.

**Gap analysis:**
- Three "asks" but no criteria for answering them. "Could look correct while failing" — how would the agent know? What inputs/environments/edge cases to test?
- "Verification oracle is real or tautological" — the section names this failure mode but does not say what makes an oracle "real" vs "tautological." A tautological oracle is one that passes whenever the code runs, regardless of correctness. The agent needs criteria to detect this.
- "Architecture drift, contract drift, or hidden scope expansion" — these are the right categories but no examples of what each looks like in practice.

**Causal trace:** The self-check will produce weak results without concrete criteria. The agent will ask the questions but cannot answer them reliably.

---

### 8. Tool Policy Gap

**Ground truth:** `sharedToolPrompts.specialist` contains `specialistToolRuntimePrompt` (line 1 of `tools.ts`):

```
Operate inside the tools exposed to your active Mastra Agent instance. Treat tool availability as the runtime contract. Do not assume hidden internals, patched vendor code, unlisted MCP tools, unavailable external services, unavailable shell access, or out-of-band orchestration.
```

**Gap analysis:**
- This prompt **is not composed** into the Developer agent's instruction set. The Developer receives `sharedPolicyPrompts.specialist` but not `sharedToolPrompts.specialist`.
- The Developer also does not receive `sharedToolPrompts.supervisor`, which contains delegation protocol (irrelevant for Developer) but also project-specific execution policy (valuable): "Prefer list_files and read_file before deciding on edits."

**Causal trace:** The Developer agent may assume tools, shell access, or external services that are not actually available. Without the tool availability constraint, the agent cannot accurately report blockers related to missing tools.

---

### 9. Mode Prompts (`developerModePrompts`, lines 5-16)

**Ground truth:** Three modes — balanced, build, verify — each with a brief instruction block.

**Gap analysis:**
- **Balanced mode:** "when the behavior and write boundary are sufficiently clear" — "sufficiently" is subjective. No threshold criteria.
- **Build mode:** "Report files changed and verification evidence" — no format guidance. "Preserve existing patterns" — how?
- **Verify mode:** "Fix issues inside the approved boundary when the evidence is clear" — what makes evidence "clear"? Who judges clarity?

**Causal trace:** Mode selection will be inconsistent if the trigger conditions are subjective. "Sufficiently clear" and "evidence is clear" provide no actionable guidance.

---

## Specific Improvement Recommendations

### REC-1: Add `specialistToolRuntimePrompt` to Developer composition

**Why needed:** The Developer agent currently has no explicit tool availability constraint. It may assume shell access, external services, or MCP tools that are not exposed. The `specialistToolRuntimePrompt` at `prompts/tools.ts:1` exists precisely to prevent this assumption but is not included in the Developer's instruction composition.

**Causal chain:** Adding this prompt → Developer knows tool availability is the runtime contract → Developer reports missing tools as blockers rather than assuming them → fewer false "unverified" claims and more accurate blocker reporting.

**Implementation:** Add `specialistToolRuntimePrompt` to the Developer's `sharedToolPrompts.specialist` import and ensure it is composed into `developerToolPrompts` or the main instruction composition.

---

### REC-2: Define "clearly bounded" threshold criteria

**Why needed:** The role definition uses "clearly bounded" and "explicit" as gate conditions but provides no criteria for what makes a task sufficiently bounded. The agent cannot reliably self-assess readiness to proceed.

**Causal chain:** Adding criteria → agent can self-assess whether the task has sufficient boundary → fewer "unclear boundary" escalations for actually-clear tasks and more "boundary unclear" escalations for genuinely unclear tasks.

**Recommendation:** Add a checklist to `developerInstructionsPrompt`:
```
A task is "clearly bounded" when all of the following are true:
- The write boundary (file(s) or directory) is explicitly named
- The central behavior (what success looks like) is described
- The authority to edit within the boundary is confirmed
- The verification approach is specified or the central behavior is directly observable
```

---

### REC-3: Add "required context" vs "helpful context" distinction

**Why needed:** The phase gate says "If any item is missing, report what is missing and do not mutate" (line 42), which is overly strict for peripheral context. The agent needs guidance to distinguish blocking missing context from non-blocking missing context.

**Causal chain:** Clarifying the distinction → agent proceeds with confidence when peripheral context is missing but central behavior is clear → fewer blocking escalations on minor gaps.

**Recommendation:** Add to phase gate section:
```
Required context (blocking if missing): write boundary, central behavior, authority.
Non-required context (can proceed without): peripheral file history, related-but-unrelated code, optional configuration.
If non-required context is missing, proceed and note the gap in the report.
```

---

### REC-4: Add criteria for "real" vs "tautological" verification oracle

**Why needed:** The adversarial self-check names the "tautological oracle" failure mode but provides no criteria to detect it. A tautological oracle passes regardless of correctness.

**Causal chain:** Adding criteria → agent can detect tautological verification → more honest reporting of verification limitations.

**Recommendation:** Add to adversarial self-check:
```
An oracle is tautological when:
- It passes for both correct and incorrect implementations (e.g., a test that always returns true)
- It only checks that code runs, not that output is correct (e.g., compilation success without runtime assertion)
- It does not depend on the specific implementation details of the feature

A real oracle:
- Has inputs with known expected outputs
- Fails for at least one incorrect implementation
- Exercises the specific behavior being claimed
```

---

### REC-5: Add stopping criteria to "read the relevant files first"

**Why needed:** The phase gate instructs the agent to read files but gives no stopping criterion. Without one, the agent may read excessively or insufficiently.

**Causal chain:** Adding stopping criteria → agent reads until key contracts are identified, then proceeds → efficient phase gate without over-reading.

**Recommendation:** Add to phase gate section:
```
Stopping criterion: stop reading when you have identified all public contracts, exported types, and schemas in the target files. Do not read historical commits, unrelated files, or configuration not referenced by the target.
```

---

### REC-6: Add criteria for "in-scope style alignment" vs "unrelated cleanup"

**Why needed:** The write boundary discipline correctly distinguishes these but gives no examples. The agent may classify too broadly or too narrowly.

**Causal chain:** Adding concrete examples → agent applies judgment consistently → more correct scope boundaries.

**Recommendation:** Add to write boundary discipline:
```
In-scope style alignment examples:
- Variable naming that matches the surrounding file's conventions
- Adding a missing type annotation where the file consistently uses typed variables
- Matching error message format used in the same file

Unrelated cleanup examples (not in-scope):
- Fixing inconsistent formatting in a different file
- Updating variable names in code unrelated to the implementation
- Reordering imports or sorting in files not in the write boundary
```

---

### REC-7: Add mode selection criteria

**Why needed:** Mode selection is currently implicit. The trigger conditions ("sufficiently clear," "evidence is clear") are subjective and will produce inconsistent mode usage.

**Causal chain:** Adding explicit mode selection criteria → consistent mode transitions → supervisor can predict Developer behavior.

**Recommendation:** Add to `developerModePrompts`:
```
Mode selection:
- Balanced: Use when write boundary and central behavior are confirmed but verification approach is not yet determined.
- Build: Use when the path to implementation is clear and no additional scoping is needed.
- Verify: Use when a prior implementation exists and claims need validation.
```

---

### REC-8: Add verification command inventory

**Why needed:** The integration evidence section tells the agent to run commands but does not remind the agent what commands are available. Without a reminder, the agent may request unavailable tools or fail to propose the next smallest check.

**Causal chain:** Adding tool guidance → agent knows to use list_files, read_file, write_file, edit_file → agent can propose feasible next steps rather than "unverified" without alternatives.

**Recommendation:** Add to integration evidence section or compose `specialistToolRuntimePrompt` which includes "Treat tool availability as the runtime contract."

---

## Drag vs Gain Classification

| Change | Classification | Mechanism |
|--------|-----------------|-----------|
| REC-1: Add tool runtime prompt | **Compounding gain** | Prevents false assumptions about tool availability; enables accurate blocker reporting |
| REC-2: Define "clearly bounded" | **Compounding gain** | Reduces ambiguous scope decisions; enables self-assessment |
| REC-3: Distinguish required vs helpful context | **Compounding gain** | Reduces unnecessary blocking; increases task throughput |
| REC-4: Define tautological oracle criteria | **Compounding gain** | Improves verification quality; reduces false confidence |
| REC-5: Add reading stopping criterion | **Compounding gain** | Prevents over-reading; keeps phase gates efficient |
| REC-6: Style alignment examples | **Compounding gain** | Reduces scope boundary disputes; improves consistency |
| REC-7: Mode selection criteria | **Compounding gain** | Reduces mode selection confusion; enables predictable behavior |
| REC-8: Tool inventory reminder | **Compounding gain** | Enables realistic verification planning |

---

## Conflicts and Gaps

**Confidence levels:**
- High confidence: The `specialistToolRuntimePrompt` gap is verifiable from code inspection (`sharedToolPrompts.specialist` is imported but not used in Developer composition).
- High confidence: The "required context" vs "helpful context" gap is inferable from the unconditional "do not mutate" rule.
- Medium confidence: The "tautological oracle" criteria gap requires understanding of verification failure modes in the Mastra context.
- Medium confidence: The mode selection criteria gap requires confirmation of intended mode usage patterns.

**Evidence gaps:**
- No actual usage data on how the Developer agent performs in practice (no telemetry or replay data reviewed).
- No confirmation of whether the `specialistToolRuntimePrompt` exclusion is intentional or an oversight.

---

## Self-Validation Log

- [x] Read `developer-agent.ts` — instruction composition confirmed
- [x] Read `prompts/agents/developer.ts` — all developer prompts identified
- [x] Read `prompts/policy.ts` — shared policy structure confirmed
- [x] Read `prompts/tools.ts` — tool prompt structure confirmed
- [x] Read `agents/shared.ts` — `composeAgentInstructions` logic verified
- [x] Verified `specialistToolRuntimePrompt` is in `sharedToolPrompts.specialist` but not in Developer composition
- [x] Verified Developer `developerToolPrompts` is an empty array
- [x] Counted all policy and instruction sections across all source files
- [x] Applied first-principle protocol to each section

**Chaining budget used:** None. This analysis was executed directly without sub-dispatches.

---

## Stop Condition

Analysis complete. All source files read and analyzed. Findings written to `.agents/plans/issue-30/developer-review.md`.
