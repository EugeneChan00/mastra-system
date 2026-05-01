# Supervisor Agent System Prompt Review

## Document Scope
Review of the Supervisor Lead agent's system prompt (instructions and policy fields) using first-principle analysis.

## Files Reviewed
- `mastra-agents/src/agents/agent.ts:21-49` — supervisorAgent composition
- `mastra-agents/src/prompts/agents/supervisor.ts:1-76` — supervisorInstructionsPrompt, supervisorModePrompts, supervisorPolicyPrompts, supervisorToolPrompts
- `mastra-agents/src/prompts/policy.ts:1-90` — sharedPolicyPrompts (supervisor subset at lines 85-89)
- `mastra-agents/src/prompts/tools.ts:1-26` — sharedToolPrompts (supervisor subset at lines 23-26)
- `mastra-agents/src/agents/shared.ts:1-129` — composeAgentInstructions, agentModesFromPrompts, withAgentModes

## Composed Instruction Order
Per `composeAgentInstructions` at `shared.ts:101-118`, the final instruction string is assembled as:
1. `supervisorInstructionsPrompt` (lines 28-40 of supervisor.ts)
2. `# Runtime Policy And Tooling`
3. `evidenceDisciplinePrompt` (policy.ts:1-9)
4. `supervisorRuntimePolicyPrompt` (policy.ts:31-75)
5. `blockerProtocolPrompt` (policy.ts:11-16)
6. `supervisorToolPrompt` (tools.ts:3-21)
7. `supervisorAgentsPrompt` (supervisor.ts:42-52)
8. `supervisorOutputPrompt` (supervisor.ts:54-70)
9. `supervisorToolPrompts` (supervisor.ts:74-76 — empty array)

---

## Current State Summary

### Instructions Field (`supervisorInstructionsPrompt`, supervisor.ts:28-40)
States the Supervisor is orchestrator/team lead, not autocomplete surface. Core doctrine covers vertical slices, deep modules, preserving user changes, separating concerns, surfacing uncertainty.

### Mode Prompts (`supervisorModePrompts`, supervisor.ts:5-26)
Five modes defined: balanced, scope, plan, build, verify — each with a single-paragraph directive. These are converted to `AgentModeMetadata` via `agentModesFromPrompts` at `shared.ts:40-52` and attached via `withAgentModes` at `shared.ts:120-129`.

### Policy Field (via `sharedPolicyPrompts.supervisor`)
Three prompts: `evidenceDisciplinePrompt`, `supervisorRuntimePolicyPrompt`, `blockerProtocolPrompt`.

### Tool Field (via `sharedToolPrompts.supervisor`)
`supervisorToolPrompt` (tools.ts:3-21) — delegation protocol, tool policy, project-specific execution policy.

### Registered Agents (`supervisorPolicyPrompts[0]`, supervisor.ts:42-52)
Lists six specialist agents with responsibilities.

### Output Discipline (`supervisorPolicyPrompts[1]`, supervisor.ts:54-70)
Structured synthesis guidance with status, summary, facts, assumptions, findings, etc.

---

## First-Principle Analysis

### 1. What Should the Supervisor Believe/Know Before Any Action?

A Supervisor Lead agent, reasoning from first principles, should understand:

1. **Role**: It is an orchestrator, not an executor. It coordinates specialists but owns routing, phase transitions, and final synthesis.
2. **Execution model**: It operates inside a Mastra workspace with specific tools. It does not have invisible infrastructure.
3. **Delegation model**: Six specialist agents exist with distinct bounded responsibilities. It must delegate, not do.
4. **Phase model**: Work progresses through discrete phases (Orchestrate → Scope → Plan → Build → Validate). Phase transitions require explicit conditions.
5. **Evidence discipline**: All claims must be grounded in observed files, command output, tool results, or labeled inference. No fabrication.
6. **Boundary discipline**: Product scope, architecture scope, implementation scope, and verification scope are distinct and must not bleed into each other.
7. **Blocker discipline**: When blocked, preserve the exact blocker and unblocking condition. Do not silently expand scope or substitute tasks.
8. **Self-awareness**: It must know which mode it is operating under because mode determines delegation criteria and focus.

---

## Gap Analysis

### Gap 1: Mode Prompts Are Not in the Instruction String

**Evidence**: `supervisorModePrompts` (supervisor.ts:5-26) defines five mode-specific directives. However, `composeAgentInstructions` (shared.ts:101-118) receives only `supervisorInstructionsPrompt`, `sharedPolicyPrompts.supervisor`, `sharedToolPrompts.supervisor`, `supervisorPolicyPrompts`, `supervisorToolPrompts`. `supervisorModePrompts` is consumed only by `agentModesFromPrompts` at `agent.ts:18` to produce `AgentModeMetadata` array, which is then attached as `modes` property via `withAgentModes`.

**First-principle violation**: A Supervisor operating in "Verify" mode should have the Verify mode directive ("Audit the completed or claimed work before final synthesis. Require evidence from tests, inspected diffs, tool output, or explicit verification gaps.") active in its instruction context. The current architecture attaches mode metadata but does not include mode-specific prompt text in the composed instruction string the model actually reads.

**Causal trace**: If a user triggers Verify mode, the Supervisor model does not have Verify-mode text in its instruction context unless the caller layer explicitly injects it. The `withAgentModes` wrapper adds `mode: string` and `modes: readonly AgentModeMetadata[]` properties, but these are data properties — not instruction text.

**Recommendation 1**: Include mode prompt text in the composed instruction string, gated by the active mode. The composition function or the caller must inject `supervisorModePrompts[activeMode]` into the prompt groups array.

---

### Gap 2: No Explicit Self-Monitoring or Self-Correction Loop

**Evidence**: `supervisorRuntimePolicyPrompt` (policy.ts:31-75) defines operating phases and phase transition discipline. However, there is no directive that explicitly instructs the Supervisor to verify it is following its own phase discipline before each action. The closest is `supervisorRuntimePolicyPrompt` line 49: "If a phase returns partial results, decide whether the partial is sufficient to proceed" — but this is a decision rule for child output, not a self-check.

**First-principle gap**: The Supervisor should, before each significant action, ask "Am I in the correct phase? Have I met the entry conditions for this phase? Should I be delegating instead of acting?"

**Causal trace**: Without an explicit self-check loop, the Supervisor may drift from Plan to Build without explicit write-boundary confirmation, or may attempt to synthesize before Validate completes.

**Recommendation 2**: Add a self-check directive to `supervisorRuntimePolicyPrompt`: "Before each delegation or synthesis action, verify: (1) you are in the correct phase, (2) entry conditions for this phase are met, (3) delegation is the right move vs. direct action."

---

### Gap 3: Agent Registration Description Could Conflict with Calling Context

**Evidence**: `supervisorAgentsPrompt` (supervisor.ts:42-52) says "Do not describe these specialists as agents from the sibling coding harness. They are Mastra supervisor-delegated specialist agents." This is defensive guidance against a specific framing error.

**First-principle concern**: The defensive clause implies the Supervisor might be confused about its own agents' identity. This is a symptom of an architectural ambiguity: if the Supervisor is itself a Mastra agent running inside the same system as its specialists, the sibling-harness description is accurate but potentially confusing. If the Supervisor runs in an outer harness orchestrating agents in an inner harness, the distinction is real but should be made structurally clear, not patched with prompt text.

**Causal trace**: If the Supervisor is a Mastra agent (`new Agent(...)`) that itself uses `developerAgent` etc. as sub-agents (per `agent.ts:35-42`), then the sibling-harness description is architecturally incorrect. The specialists are co-resident Mastra agents, not external harness agents.

**Recommendation 3**: Clarify the architectural relationship between Supervisor and specialists structurally. If they are co-resident Mastra agents, remove the defensive sibling-harness clause and replace with accurate framing: "These specialists are co-resident Mastra agent instances you delegate to by name."

---

### Gap 4: Streaming Policy Is Passive, Not Active

**Evidence**: `supervisorRuntimePolicyPrompt` lines 73-75 (policy.ts:73-75) state "Always prefer streaming execution for runtime agent calls. This is prompt-enforced unless the caller layer enforces Agent.stream()."

**First-principle gap**: The word "prefer" is weak. If streaming is the policy, it should be stated as the default behavior, not a preference. Additionally, the Supervisor has no explicit guidance on what to do when streaming is not available or fails.

**Causal trace**: A Supervisor that does not stream agent calls will hold memory for longer, increasing token usage and latency for the user.

**Recommendation 4**: Strengthen streaming policy to "Stream all delegated agent calls by default. If streaming fails, fall back to non-streaming but report the fallback to the user."

---

### Gap 5: No Explicit Feedback Loop from Validation to Scope

**Evidence**: Phase transitions (policy.ts:44-49) go Orchestrate → Scope → Plan → Build → Validate → (synthesis). After Validate, the flow is toward final synthesis. There is no explicit guidance that Validate results should feed back to Scope if gaps are found.

**First-principle gap**: A rigorous Supervisor should, when Validate finds insufficient evidence, consider returning to Scope to sharpen the slice or Plan to tighten contracts — not just proceed to synthesis with a partial result.

**Causal trace**: Without feedback guidance, the Supervisor may accept "partial-safe" results from Validate and proceed to synthesis when a tighter scope would have produced verifiable results.

**Recommendation 5**: Add to `supervisorRuntimePolicyPrompt` under Validate phase: "If validation reveals insufficient evidence, do not proceed to synthesis. Return to Scope or Plan to sharpen the target before attempting Build again."

---

### Gap 6: SupervisorToolPrompts Is Empty — No Agent-Specific Tool Guidance

**Evidence**: `supervisorToolPrompts` (supervisor.ts:74-76) is an empty array `const supervisorToolPrompts = [] as const;`. Compare with `sharedToolPrompts.supervisor` which contains `supervisorToolPrompt` — but that is in the shared tool prompts, not the supervisor-specific ones.

**First-principle gap**: The empty `supervisorToolPrompts` means there is no supervisor-specific tool guidance beyond what is shared. This is not necessarily a gap — the shared `supervisorToolPrompt` (tools.ts:3-21) does cover delegation protocol. However, the naming suggests an intended split where supervisor-specific tool prompts go in `supervisorToolPrompts` and shared ones in `sharedToolPrompts.supervisor`. The current arrangement mixes supervisor-specific delegation protocol (in shared) with specialist tool runtime (in shared specialist).

**Causal trace**: If future supervisor-specific tool guidance is added to `supervisorToolPrompts`, it will be composed after shared prompts, which is correct. The current emptiness is not a bug but represents a missed opportunity for clear separation.

**Recommendation 6**: Document the intended split: `supervisorToolPrompts` is for Supervisor-specific tool guidance; `sharedToolPrompts.supervisor` is for tool guidance shared between Supervisor and specialists. Ensure any new tool guidance is placed in the correct bucket.

---

### Gap 7: No Explicit Stop Condition Check Before Synthesis

**Evidence**: `supervisorOutputPrompt` (supervisor.ts:54-70) defines the output structure but does not explicitly require the Supervisor to verify the stop condition before producing final synthesis.

**First-principle gap**: The Supervisor should not produce final synthesis until the delegated task's stop condition is confirmed met, or a blocker/partial-safe classification is explicitly stated.

**Causal trace**: Without a stop-condition check, the Supervisor may synthesize and present as "completed" what is actually "partial-safe" or "blocked."

**Recommendation 7**: Add to `supervisorOutputPrompt`: "Before producing final synthesis, verify the stop condition was explicitly checked against evidence. Do not present status as completed unless COMPLETE was classified."

---

## Specific Improvement Recommendations Summary

| # | Recommendation | Location | Why Needed | Causal Chain |
|---|----------------|----------|------------|--------------|
| 1 | Inject active mode prompt into instruction string | `composeAgentInstructions` call site or `withAgentModes` | Mode-specific directives are not in context when mode changes | If mode prompt is missing, Supervisor ignores mode-specific phase guidance |
| 2 | Add self-check directive before delegation/synthesis | `supervisorRuntimePolicyPrompt` | No explicit self-verification of phase discipline | Without self-check, Supervisor may drift phases without realizing |
| 3 | Remove/fix sibling-harness defensive clause | `supervisorAgentsPrompt` | Architecturally misleading if Supervisor and specialists are co-resident | Misleading framing causes incorrect self-description to user |
| 4 | Strengthen streaming from "prefer" to "default" | `supervisorRuntimePolicyPrompt` | Weak directive leads to non-streaming behavior | Without strong streaming policy, token usage and latency increase |
| 5 | Add validation feedback loop to Scope/Plan | `supervisorRuntimePolicyPrompt` Validate section | Validate findings should sharpen scope, not just gate synthesis | Without feedback, partial validation proceeds to synthesis as if complete |
| 6 | Document supervisorToolPrompts vs sharedToolPrompts split | Inline comment in `supervisorToolPrompts` | Unclear bucket ownership leads to mis-filing | Mis-filing leads to duplicate or missing tool guidance |
| 7 | Add stop condition check before final synthesis | `supervisorOutputPrompt` | Prevents premature "completed" status | Without check, partial-safe is presented as complete |

---

## Confidence and Gaps

**High confidence**: Gaps 1, 3, 4, 7 are verifiable from code inspection. Mode prompts are not in instruction string (gap 1); sibling-harness clause is architecturally questionable (gap 3); streaming is "prefer" not mandatory (gap 4); stop condition check is absent (gap 7).

**Medium confidence**: Gaps 2, 5 require judgment about what "should" be there vs. what is arguably implied by existing text. The existing phase-transition text could be interpreted as implicitly covering these cases.

**Low confidence**: Gap 6 is speculative — the empty array is intentional if no supervisor-specific tool prompts exist yet.

---

## Self-Validation Log

- Read `mastra-agents/src/agents/agent.ts` — confirmed supervisorAgent composition
- Read `mastra-agents/src/prompts/agents/supervisor.ts` — confirmed all supervisor prompt exports
- Read `mastra-agents/src/prompts/policy.ts` — confirmed sharedPolicyPrompts structure and content
- Read `mastra-agents/src/prompts/tools.ts` — confirmed sharedToolPrompts structure
- Read `mastra-agents/src/agents/shared.ts` — confirmed composeAgentInstructions and agentModesFromPrompts logic
- Traced composeAgentInstructions call chain: supervisorInstructionsPrompt + 5 prompt groups
- Verified supervisorModePrompts are NOT in the composed instruction string
- Verified supervisorToolPrompts is empty array
- No sub-dispatches issued

---

## Stop Condition

Analysis complete. All five files read and traced. Seven gaps identified with causal chains. No blocking ambiguities remain.
