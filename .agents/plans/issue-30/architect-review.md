# Architect Agent System Prompt Review

## Current State Summary

The Architect agent is defined across three files:

- **Entry point**: `mastra-agents/src/agents/architect-agent.ts:14-28` — composes the agent using `composeAgentInstructions` which combines:
  1. `architectInstructionsPrompt` — the "You are..." role block
  2. `sharedPolicyPrompts.specialist` — five shared specialist policies
  3. `sharedToolPrompts.specialist` — one specialist tool runtime prompt
  4. `architectPolicyPrompts` — vertical-slice discipline, depth gate, wrapper detection, authority boundary, ownership naming, vendor boundary, handoff discipline, non-goals
  5. `architectToolPrompts` — empty array

- **Instructions block**: `mastra-agents/src/prompts/agents/architect.ts:17-29` — defines role as "read-only boundary, contract, state ownership, and integration design for the Mastra System supervisor" with six enumerated use cases.

- **Mode prompts**: `mastra-agents/src/prompts/agents/architect.ts:5-15` — three mode variants (balanced, scope, analysis) each 2 lines.

- **Policy block**: `mastra-agents/src/prompts/agents/architect.ts:31-80` — eight named policy sections (vertical-slice discipline, depth gate, wrapper/shell detection, authority boundary, state/control/data/event ownership, vendor boundary, handoff note discipline, non-goals).

---

## First-Principle Analysis

### What the Architect agent should know before any action

1. **Role identity**: It is exclusively a boundary/contract/state design specialist. It is not a developer, not a product manager, not a supervisor, not a researcher. It must produce architecture deltas and handoff notes, not code or product decisions.

2. **Input contract**: It operates on an already-approved slice handed to it by the supervisor. It does not scope the work — that precedes its involvement.

3. **Output contract**: Its sole outputs are architecture deltas, ownership models, contracts, invariants, and handoff notes for Developer and Validator. Anything resembling implementation logic is out-of-scope.

4. **Evidence discipline**: Every structural assertion must be traceable to concrete evidence (file paths, line references, tool output). Inference is allowed but must be labeled as such.

5. **Confidence signaling**: When evidence is absent, partial, or contradictory, the agent must explicitly state confidence level and mark what follow-up would resolve the gap.

6. **Non-goals enforcement**: The agent must actively reject any request that crosses into implementation, product scope, future-state design, or code writing.

7. **Vertical scope discipline**: The agent must resist broadening the slice to justify a more elegant abstraction.

---

## Gap Analysis

### Gap 1: No explicit confidence / uncertainty signaling requirement

**Location**: `architectInstructionsPrompt` (lines 17-29 of `architect.ts`) and all policy sections.

**What it actually says**: The instructions say to "map explicit state ownership, control flow, data flow, event flow" and "define handoff notes." The shared `evidenceDisciplinePrompt` says to "separate facts, assumptions, findings, blockers, risks, and next actions" and to "name what is missing" when evidence is partial.

**What it should do**: Explicitly require the agent to classify every claim as **verified** (traceable to evidence), **inferred** (reasoned but unverified), or **uncertain** (conflicting or absent evidence) and to propagate these classifications into the output so downstream agents can weight the claims appropriately.

**Why it matters**: Without explicit confidence signaling, the Developer agent or Validator may treat inferred architecture claims as verified facts. This is a compounding failure mode — an incorrect boundary assumption early in a slice propagates into incorrect module ownership, incorrect contracts, and incorrect verification targets.

**Causal chain**: If we add explicit confidence classification → Developer/Validator can calibrate their trust → fewer downstream misalignment escalations → slice completes faster.

---

### Gap 2: The mode prompts are shallow relative to the depth of the policy block

**Location**: `architectModePrompts` at `architect.ts:5-15` vs `architectPoliciesPrompt` at `architect.ts:31-80`.

**What it actually says**: Each mode prompt is 2 lines. "balanced" says "provide enough boundary and ownership guidance for the next safe step." "scope" says "identify the owning module, boundaries, contracts, and integration seams." "analysis" says "analyze ownership, coupling, invariants, and contract risk."

**What it should do**: Mode prompts should be the *primary behavioral guidance* — the thing the agent reads first and uses to weight its reasoning. They should be as substantive as the policy block, not decorative two-line tags. Each mode should state: what lens to apply, what output shape is expected, what the stop condition is, and what the agent should explicitly NOT do in that mode.

**Why it matters**: A 2-line mode prompt that says "analyze ownership, coupling, invariants" does not distinguish the analysis mode's behavior from balanced mode in any actionable way. The policy block has deep, specific content (depth gate, wrapper detection, authority boundary) but the modes don't direct the agent to apply specific policy sections with specific weightings.

**Causal chain**: If we deepen mode prompts to 5-8 lines each with explicit lens权重 and stop conditions → agent behavior is more mode-deterministic → supervisor can reliably predict Architect output shape per mode → fewer re-dispatches.

---

### Gap 3: Handoff note discipline is underspecified for Validator

**Location**: `architectPoliciesPrompt` lines 65-69 (`architect.ts:65-69`).

**What it actually says**: "A Developer handoff needs a write boundary, central behavior, module ownership statement, public interface or contract, and one minimal verification target. A Validator handoff needs the claim under review, invariants, expected evidence, and known verification gaps."

**What it should do**: The Validator handoff should additionally require the Architect to state which invariants are **structural** (enforceable by code) vs **behavioral** (requiring test or runtime evidence), and to name the specific evidence type required (static analysis, unit test, integration test, manual inspection). "Expected evidence" without a type classification leaves the Validator guessing.

**Why it matters**: The Validator is the gate. If the Architect gives a Validator handoff that says "verify the module owns this state" without specifying whether static analysis, a unit test, or a runtime trace is the appropriate evidence, the Validator may choose the wrong verification method and miss real violations.

**Causal chain**: If we add structural vs behavioral invariant classification → Validator knows which evidence type to collect → fewer invalidation loops → faster slice completion.

---

### Gap 4: No explicit escalation trigger for architectural disputes

**Location**: `architectPoliciesPrompt` section "Authority boundary" lines 47-51 (`architect.ts:47-51`).

**What it actually says**: "Decide what the boundaries are and what each module owns. Do not decide product scope, business priority, or technology adoption unless the supervisor explicitly asks for that decision support. If alternatives change scope, cost, risk, or product behavior, surface options and stop for a decision."

**What it should do**: The policy says "surface options and stop for a decision" but does not define what "surface" means in operational terms. The Architect should be required to return a structured **options brief** with a specific decision question, named alternatives, tradeoffs per alternative, and a recommended default — so the supervisor or user can make an informed choice without a back-and-forth clarification loop.

**Why it matters**: "Surface options" as a directive is underspecified. An Architect might return a one-line "Option A vs Option B, please decide" which forces the supervisor to re-dispatch for clarification. A structured options brief eliminates that loop.

**Causal chain**: If we require a structured options brief with tradeoffs and a named decision question → supervisor can decide without re-dispatch → faster decision loop.

---

### Gap 5: The tool prompts are empty for Architect

**Location**: `architectToolPrompts` at `architect.ts:82-84` is an empty array `[]`.

**What it actually says**: Nothing — the Architect has no tool-specific behavioral guidance beyond the generic `specialistToolRuntimePrompt`.

**What it should do**: Architect-specific tool guidance should state which tools the Architect is expected to use for evidence gathering (read_file for static analysis, list_files for directory structure, potentially Bash for command output), which tools are explicitly not its concern (no write_file, no edit_file — it is read-only), and how to handle tool failures during evidence gathering.

**Why it matters**: The `specialistToolRuntimePrompt` (`tools.ts:1`) says "operate inside the tools exposed to your active Mastra Agent instance" but does not specify which tools are architecturally relevant vs implementation-relevant. An Architect that fires off Developer-level tool calls (write_file, edit_file) is violating its read-only contract but has no explicit guidance preventing this.

**Causal chain**: If we add tool-role guidance (read-only tools for evidence, explicit non-approval of write tools) → Architect behavior is more constrained to its read-only role → fewer scope drifts.

---

### Gap 6: "Do not broaden the slice" is not paired with a naming obligation

**Location**: `architectPoliciesPrompt` "Non-goals" section lines 71-75 (`architect.ts:71-75`) and `sharedPolicyPrompts.specialist` "Scope discipline" (`policy.ts:23-27`).

**What it actually says**: "Do not broaden the slice to justify an abstraction" (line 74) and "Preserve the supervisor's stated boundary" (line 25 of policy.ts).

**What it should do**: When the Architect encounters pressure to broaden the slice (from a Developer asking for more context, or from finding a "cleaner" abstraction that requires touching multiple modules), it should be required to **name the drift explicitly before acting on it** — not just to avoid broadening, but to surface the broadening attempt so the supervisor can either reject it or approve an expanded scope with a new dispatch.

**Why it matters**: "Do not broaden" without a naming obligation is passive. The Architect might silently omit architectural guidance that would require slice expansion, leaving the Developer without the context needed to make correct boundary decisions. A named drift signal lets the supervisor decide whether the expansion is justified.

**Causal chain**: If we require named drift signals → supervisor sees the broadening attempt → can approve or reject with context → Developer gets either expanded scope or clear boundary guidance.

---

## Specific Improvement Recommendations

### Recommendation 1: Add explicit confidence classification to the evidence discipline section

**File**: `mastra-agents/src/prompts/policy.ts`, specifically the `evidenceDisciplinePrompt` section.

**Current text** (`policy.ts:1-9`):
```
Work from evidence.
- Ground important claims in observed files, command output, tool results, user instructions, or clearly labeled inference.
- Prefer file paths and line references when discussing code. Use path:line or path:line-line when the tool provides line numbers.
- Separate facts, assumptions, findings, blockers, risks, and next actions.
```

**Recommended addition** (after existing bullet points):
```
- Classify every structural claim as: VERIFIED (traceable to file/command output), INFERRED (reasoned from partial evidence, labeled as such), or UNCERTAIN (conflicting evidence or absent evidence, named explicitly).
- Propagate claim classifications into handoff notes so downstream agents can calibrate trust.
- If a claim is UNCERTAIN, propose the minimum evidence check that would resolve it.
```

**Why needed**: Without classification, the Architect treats inferred claims and verified claims with equal weight. Downstream agents cannot distinguish them.

**Causal chain**: Add confidence classification → downstream agents weight claims appropriately → Validator applies stricter scrutiny to INFERRED claims → fewer incorrect architectures shipping to implementation.

---

### Recommendation 2: Expand mode prompts to 5-8 substantive lines each

**File**: `mastra-agents/src/prompts/agents/architect.ts`, lines 5-15.

**Current text**:
```
balanced: `Architect Balanced mode:
- Provide enough boundary and ownership guidance for the next safe step.
- Keep architecture tied to the current slice, not a speculative future system.`,
scope: `Architect Scope mode:
- Identify the owning module, boundaries, contracts, and integration seams for the proposed slice.
- Flag decisions that belong to product scope rather than architecture.`,
analysis: `Architect Analysis mode:
- Analyze ownership, coupling, invariants, and contract risk.
- Recommend the smallest architecture delta that supports the current work.`,
```

**Recommended expansion** (example for analysis mode — similar depth for others):
```
analysis: `Architect Analysis mode:
Lens: ownership, coupling, invariants, contract risk.
Focus: smallest architecture delta that unblocks the current work.
Output: boundary proposal with named module ownership, public interfaces, state owner, control flow, invariants, and verification targets.
Stop condition: return when boundary, ownership, and contract claims are named with VERIFIED/INFERRED/UNCERTAIN classification; stop before proposing implementation patterns.
Explicitly NOT in scope: code, tests, product scope decisions, future-state diagrams, or multi-module scaffolding beyond the immediate slice boundary.
Drift naming: if analysis reveals a broader structural issue, name it as DRIFT and stop rather than expanding scope.
`,
```

**Why needed**: Two-line mode prompts do not give the agent enough behavioral guidance to distinguish modes in practice. A Developer dispatching Architect in "analysis" mode expects a different output shape than in "scope" mode — but the current prompts don't encode that distinction.

**Causal chain**: Deeper mode prompts → agent output shape is more predictable per mode → supervisor can dispatch with accurate expectations → fewer re-dispatches for output format mismatch.

---

### Recommendation 3: Expand Validator handoff to require structural vs behavioral invariant classification

**File**: `mastra-agents/src/prompts/agents/architect.ts`, lines 67-69.

**Current text**:
```
- A Validator handoff needs the claim under review, invariants, expected evidence, and known verification gaps.
```

**Recommended text**:
```
- A Validator handoff needs: the claim under review, each invariant classified as STRUCTURAL (enforceable by static analysis or type system) or BEHAVIORAL (requiring runtime test or inspection), the specific evidence type required per invariant, and known verification gaps with the minimum check that would close each gap.
```

**Why needed**: "Expected evidence" without type guidance lets the Validator choose the wrong evidence method. A STRUCTURAL invariant (e.g., "module A must not import module B") is verifiable with static analysis. A BEHAVIORAL invariant (e.g., "state transition X is atomic") requires a runtime test. Without classification, the Validator may run a unit test when static analysis would suffice — or vice versa.

**Causal chain**: Add invariant classification → Validator applies correct evidence method → first-pass verification is accurate → fewer invalidation loops.

---

### Recommendation 4: Define structured escalation format in Authority boundary section

**File**: `mastra-agents/src/prompts/agents/architect.ts`, lines 47-51.

**Current text**:
```
Authority boundary:
- Decide what the boundaries are and what each module owns.
- Do not decide product scope, business priority, or technology adoption unless the supervisor explicitly asks for that decision support.
- If alternatives change scope, cost, risk, or product behavior, surface options and stop for a decision.
```

**Recommended text** (add after existing bullets):
```
- When a decision requires supervisor judgment, return a structured options brief:
  1. The specific decision question (one sentence)
  2. Named alternatives (2-3 maximum)
  3. Tradeoffs per alternative (scope, cost, risk, coupling impact — one line each)
  4. Architect's recommended default (if any), marked as DEFAULTED — not as a decision
- Do not return "Option A vs Option B, please decide" without the tradeoff structure.
- If the decision is product scope (not architecture), mark as PRODUCT-SCOPE and do not analyze tradeoffs as architecture.
```

**Why needed**: "Surface options and stop" without a defined format produces variable escalation quality. The supervisor may receive a one-line question that requires a clarification loop, or a 10-paragraph essay when a two-line tradeoff summary would suffice.

**Causal chain**: Structured options brief → supervisor decides with context in one pass → no clarification loop → faster decision.

---

### Recommendation 5: Add Architect-specific tool role guidance to architectToolPrompts

**File**: `mastra-agents/src/prompts/agents/architect.ts`, lines 82-84.

**Current text**:
```
export const architectToolPrompts = [
  // Agent-specific Architect tool prompts belong here.
] as const;
```

**Recommended text**:
```
export const architectToolPrompts = [
  `Architect tool discipline:
- Use read_file and list_files as primary evidence-gathering tools.
- Use Bash sparingly for command output (e.g., git status, package listing) when file inspection is insufficient.
- write_file and edit_file are not Architect tools — the Architect is read-only by contract.
- If a dispatched task requires writing (e.g., drafting an ADR, annotating a diagram), escalate before acting.
- If a tool call fails during evidence gathering, preserve the error and infer conservatively rather than substituting a different tool to bypass the gap.`
] as const;
```

**Why needed**: The `specialistToolRuntimePrompt` is generic and does not encode the Architect's read-only constraint. Without explicit tool-role guidance, an Architect under pressure to "just write the ADR" may violate its read-only contract without realizing it has stepped outside its role.

**Causal chain**: Explicit tool-role guidance → Architect self-limits to read-only evidence gathering → no accidental write operations → role boundary is enforced by prompt rather than by error recovery.

---

### Recommendation 6: Add named drift signal requirement to non-goals

**File**: `mastra-agents/src/prompts/agents/architect.ts`, lines 71-75.

**Current text**:
```
Non-goals:
- Do not implement.
- Do not optimize for elegant diagrams over operational reality.
- Do not broaden the slice to justify an abstraction.
- Do not hide uncertainty behind architecture vocabulary.
```

**Recommended text**:
```
Non-goals:
- Do not implement.
- Do not optimize for elegant diagrams over operational reality.
- Do not broaden the slice to justify an abstraction.
- Do not hide uncertainty behind architecture vocabulary.
- If you encounter pressure to expand scope (from a Developer, from a finding, or from your own judgment that more context would help), name the DRIFT explicitly before acting:
  1. What the broadening would entail (one sentence)
  2. Why it feels necessary (your reasoning)
  3. Why you are NOT acting on it (the vertical-slice discipline rationale)
  4. The supervisor decision that would be required to proceed
- A named drift signal is not failure — it is correct protocol. Silent omission of out-of-scope context is the failure mode.
```

**Why needed**: "Do not broaden" without a naming obligation leaves the Architect no protocol for surfacing legitimate broadening needs. This creates a double failure: either the Architect stays silent and the Developer proceeds with insufficient context, or the Architect silently expands scope and violates vertical-slice discipline.

**Causal chain**: Named drift signals → supervisor sees the broadening attempt → approves/rejects with context → Developer gets either expanded scope (with new dispatch) or clear boundary guidance.

---

## Drag vs Gain Classification

| Change | Classification | Mechanism |
|--------|---------------|-----------|
| Add confidence classification to evidence discipline | **Compounding gain** | Reduces downstream misalignment; INFERRED/UNCERTAIN claims get appropriate scrutiny; fewer incorrect architectures reaching implementation |
| Expand mode prompts to substantive depth | **Compounding gain** | More predictable agent output per mode; reduces re-dispatch rate; supervisor can dispatch with accurate expectations |
| Structural vs behavioral invariant classification | **Compounding gain** | Validator uses correct evidence method per invariant type; faster first-pass verification; fewer invalidation loops |
| Structured escalation format | **Compounding gain** | Eliminates clarification loop on scope/cost/risk decisions; supervisor decides in one pass |
| Architect-specific tool role guidance | **Compounding gain** | Self-enforces read-only constraint via prompt; prevents accidental write operations; reduces escalation on role violations |
| Named drift signal requirement | **Compounding gain** | Gives legitimate broadening pressure a protocol; prevents silent omission that starves Developer of context |

---

## Self-Validation Log

- Read `architect-agent.ts` — confirmed composition structure and agent entry point.
- Read `architect.ts` lines 1-85 — confirmed all Architect-specific prompts.
- Read `policy.ts` lines 1-90 — confirmed shared specialist policies.
- Read `tools.ts` lines 1-26 — confirmed shared tool prompts.
- Read `shared.ts` lines 1-130 — confirmed `composeAgentInstructions` composition order and behavior.
- Cross-referenced composition order: instructions → specialist policies → specialist tools → architect policies → architect tools. Confirmed `architectToolPrompts` is empty.
- Verified no `maxSteps`, `toolCallConcurrency`, or other runtime config leaks into the prompt text (those are in `shared.ts` lines 89-97, not in prompt text).
- Confirmed mode prompts are 2 lines each and policy block is 8 substantive sections — this is the asymmetry driving Gap 2.

---

## Confidence Assessment

**Confidence is HIGH** on the gap analysis for:
- Gap 1 (confidence classification): directly observable from absence in policy text
- Gap 2 (mode prompt depth): directly observable from line-count comparison
- Gap 3 (Validator handoff specificity): directly observable from the "expected evidence" vagueness
- Gap 5 (empty architectToolPrompts): directly observable at `architect.ts:82-84`

**Confidence is MEDIUM** on:
- Gap 4 (structured escalation format): the current "surface options and stop" language is underspecified but could be intentionally minimal; the recommended format is my judgment based on operational need, not explicit system failure evidence
- Gap 6 (named drift signals): the "do not broaden the slice" directive is present but the silent-omission failure mode is inferred from the absence of a naming protocol, not directly observed

**Follow-up recommended**: A `validator_worker` or `backend_developer_worker` feasibility audit on Recommendation 3 (structural vs behavioral invariant classification) would confirm whether the Validator agent has the static-analysis tooling to act on STRUCTURAL claims, or whether that classification would itself be unverified.
