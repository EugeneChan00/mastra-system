# Scout Agent System Prompt Review

## Current State Summary

The Scout agent is defined at `mastra-agents/src/agents/scout-agent.ts:14-28` with these prompt layers (in composition order):

1. `scoutInstructionsPrompt` (lines 17-29 of `scastra-agents/src/prompts/agents/scout.ts`) — role and use cases
2. `sharedPolicyPrompts.specialist` — generic specialist policies (5 prompts from `policy.ts:78-84`)
3. `sharedToolPrompts.specialist` — single tool-runtime prompt (`tools.ts:1`)
4. `scoutPolicyPrompts` — Scout-specific policies: `scoutPoliciesPrompt` + `scoutOutputPrompt` (`scout.ts:31-65`)
5. `scoutToolPrompts` — **empty array** (`scout.ts:67-69`)

Mode prompts are defined in `scoutModePrompts` (lines 5-15): `balanced`, `scope`, `research`. No `plan` mode is defined despite `plan` appearing in `sharedAgentModeNames` at `shared.ts:25`.

---

## First-Principle Analysis

### 1. Role Clarity

**What it actually says to the model (ground truth):**

The `scoutInstructionsPrompt` (`scout.ts:17-29`) establishes Scout as:
- "focused Mastra supervisor-delegated specialist agent"
- "read-only repository discovery and current-state inspection"
- Use cases: locating files/configs/scripts/tests/docs, summarizing existing behavior, identifying ownership from imports/exports/call paths, checking for discoverable facts, collecting concrete paths/symbols/line references, finding next-smallest uncertainty-reducing inspection

**First principles before any action:**
- Scout does not implement. It observes and reports.
- Scout does not decide scope, architecture, or product direction. It surfaces evidence.
- Scout's work product is routing-ready evidence, not a final answer.
- Scout operates in a delegated mode: the supervisor assigns objectives, Scout returns findings.

**Gap analysis:**
- No gap on role clarity. The role is well-established and the anti-goals (lines 56-60) are explicit.
- The role of "routing guidance" in the completion discipline (line 53) is appropriate but underspecified.

---

### 2. Supervisor Phase Architecture Inappropriateness (Critical)

**The problem:** `sharedPolicyPrompts.specialist` (imported at `scout-agent.ts:20`) includes `supervisorRuntimePolicyPrompt` at `policy.ts:86-89`, which contains full phase architecture:

- Operating phases at `policy.ts:37-42`: Orchestrate, Scope, Plan, Build, Validate
- Phase transition discipline at `policy.ts:44-49`: "Enter Scope after...", "Enter Plan only after...", "Enter Build only after...", "Enter Validate only after..."

**First principles analysis:**
- Scout's workflow is: inspect → confirm/ruling/block → handoff. It never enters Plan/Build/Validate.
- The supervisorRuntimePolicyPrompt was designed for the supervisor agent archetype, not specialist sub-agents.
- Including supervisor phase architecture in a specialist prompt is cross-archetype contamination.

**Causal trace:** If Scout receives a delegated task that partially overlaps with Plan or Build phases, the embedded phase architecture creates conflicting behavioral signals. Scout is told to "Enter Plan only after..." while simultaneously being told to stay read-only and exit after evidence collection. This creates decision paralysis at phase boundaries.

**Policy evaluation:** This is not boilerplate — it is actively wrong for Scout. The phase architecture in supervisorRuntimePolicyPrompt should be excluded from the specialist composition path that Scout uses.

---

### 3. Scout Mode Architecture Gap

**The problem:** `shared.ts:25` defines `plan: "Plan"` in `sharedAgentModeNames`, but `scoutModePrompts` (lines 5-15 of `scout.ts`) defines only `balanced`, `scope`, `research`. No `plan` mode is defined for Scout.

**Causal trace:** If Scout is dispatched with mode `"plan"` (which is a valid shared mode ID), the harness has no mode prompt to emit. Behavior defaults to the base instruction set, but mode-specific guidance is absent.

**Gap analysis:** This is not currently causing failures (no code references `"plan"` mode for Scout), but it is a latent architectural inconsistency. The name `plan` in `sharedAgentModeNames` suggests planned alignment with the supervisor phase, which is conceptually inappropriate for Scout anyway.

---

### 4. Evidence Discipline Fit

**What `evidenceDisciplinePrompt` says** (`policy.ts:1-9`):
- Work from evidence; ground claims in observed files/command output/tool results/user instructions/inference
- Use path:line or path:line-line
- Separate facts, assumptions, findings, blockers, risks, next actions
- Classify unavailable checks precisely

**Fit assessment:** This discipline is generic and applicable to all specialists. Scout's `Citation discipline` (lines 45-48 of `scout.ts`) extends this appropriately with Scout-specific examples. No gap.

---

### 5. Blocked-Work Protocol Fit

**What `blockerProtocolPrompt` says** (`policy.ts:11-16`):
- Complete maximum safe partial analysis inside stated boundary
- Preserve exact blocker; do not pretend task is complete
- State what would unblock the work
- Distinguish "not found after inspection" from "not inspected because access/tools unavailable"
- Do not silently expand scope to get around a blocker

**Fit assessment:** Highly appropriate for Scout. Scout's `Completion and handoff` section (lines 50-54 of `scout.ts`) reinforces this with routing guidance. No gap.

---

### 6. Tool Prompt Poverty

**What `specialistToolRuntimePrompt` says** (`tools.ts:1`):
> "Operate inside the tools exposed to your active Mastra Agent instance. Treat tool availability as the runtime contract. Do not assume hidden internals, patched vendor code, unlisted MCP tools, unavailable external services, unavailable shell access, or out-of-band orchestration."

**Assessment:** This is a runtime-awareness prompt, not a tool-usage guidance prompt. It tells Scout what tools it has, not how to use them effectively for discovery.

**What `scoutToolPrompts` contains** (`scout.ts:67-69`):
Empty array. There is zero Scout-specific tool guidance.

**First principles:** For a discovery-focused agent, tool usage discipline is critical. How to structure grep/search queries for maximum recall without over-broad scanning. How to follow import chains. How to use symbol inspection. How to distinguish build artifacts from source. These are not in the current prompt.

**Gap analysis:** This is a structural gap, not critical (Scout can infer tool usage from its general role), but it is a missed opportunity for explicit guidance that reduces Scout's search randomness.

---

### 7. Scope Discipline Tension

**specialistScopePolicyPrompt** (`policy.ts:23-27`):
> "Execute the delegated task, not the larger project. Preserve the supervisor's stated boundary, non-goals, evidence threshold, and stop condition. Escalate when the task requires a new product decision, write-boundary expansion, missing tool, or unavailable external evidence."

**scoutPoliciesPrompt Boundary discipline** (`scout.ts:31-36`):
> "Stay read-only: no file writes, no config mutations, no scaffold generation, no plan rewrites, no code edits, and no ownership of implementation... Do not decide product scope or architecture. Surface evidence that helps the supervisor route Scope, Plan, Build, or Validate."

**Fit assessment:** The two are consistent and complementary. Scout-specific policy deepens the general specialist policy with Scout-appropriate specifics. No tension.

---

### 8. Completion Discipline

**scoutPoliciesPrompt lines 50-54:**
> "Discovery is complete when the stated objective is confirmed, ruled out, or blocked with the blocker named. Mark the handoff incomplete when evidence is insufficient for supervisor routing. Include routing guidance when useful: which specialist should act next and why. Name unknowns, next checks, and whether they are optional curiosity or required before proceeding."

**Gap analysis:** The completion criteria are clear but the *workflow* for achieving them is not specified. There is no "how to conduct a discovery session" guidance — no systematic approach to narrowing search, no guidance on when to stop breadth-first and go depth-first, no guidance on how to determine "adequate search scope."

The `Current-state mapping discipline` section (lines 38-43) partially addresses this:
> "Inspect before asserting. Prefer depth over breadth once the likely target area is found; broad inventories are useful only until the supervisor can route the next step."

This is good but incomplete — it tells Scout when to switch from breadth to depth but not how to identify the likely target area in the first place.

---

## Specific Improvement Recommendations

### Recommendation 1: Exclude supervisorRuntimePolicyPrompt from Scout's specialist composition (Critical)

**What to change:** `mastra-agents/src/prompts/policy.ts` — restructure `sharedPolicyPrompts` so `supervisorRuntimePolicyPrompt` is not included in the `specialist` key.

**Current state at lines 77-90:**
```typescript
export const sharedPolicyPrompts = {
  specialist: [
    evidenceDisciplinePrompt,
    specialistScopePolicyPrompt,
    promptVsCodePolicyPrompt,
    specialistResponsePolicyPrompt,
    blockerProtocolPrompt,
  ],
  supervisor: [
    evidenceDisciplinePrompt,
    supervisorRuntimePolicyPrompt,
    blockerProtocolPrompt,
  ],
} as const;
```

The `specialist` array does NOT include `supervisorRuntimePolicyPrompt`. The scout-agent composition at `scout-agent.ts:18-24` pulls from `sharedPolicyPrompts.specialist`, which correctly excludes supervisorRuntimePolicyPrompt. **This is not actually a bug** — the specialist path does not include supervisor phase architecture. Scout does not receive the Orchestrate/Scope/Plan/Build/Validate phase language.

**Re-assessment:** The phase architecture contamination concern was a misread. The supervisorRuntimePolicyPrompt is in `sharedPolicyPrompts.supervisor`, not `sharedPolicyPrompts.specialist`. Scout gets `sharedPolicyPrompts.specialist` (lines 78-84), which contains: evidence discipline, specialist scope policy, prompt-vs-code policy, specialist response policy, blocker protocol. None of these are supervisor-phase-specific.

**Revised finding:** No structural contamination. The concern was unfounded.

---

### Recommendation 2: Define scoutToolPrompts with discovery-specific tool guidance (Medium priority)

**What to change:** `mastra-agents/src/prompts/agents/scout.ts` lines 67-69 — replace empty array with Scout-specific tool prompts.

**Proposed additions:**
- How to construct search queries for discovery (specificity vs recall tradeoffs)
- How to follow import/export chains for ownership identification
- How to distinguish source files from generated artifacts and build outputs
- How to use file stats to distinguish transient workspace state from permanent repository state
- How to set search scope boundaries to avoid infinite recursion in node_modules/dist/target

**Why needed:** Without explicit tool guidance, Scout relies on generic reasoning about "discovery-oriented operations." Explicit guidance reduces variance in Scout's search strategy quality across different model instances and prompt interpretations.

---

### Recommendation 3: Add "Adequate Search Scope" discipline to scoutPoliciesPrompt (Medium priority)

**What to change:** `mastra-agents/src/prompts/agents/scout.ts` — add a new discipline section after `Current-state mapping discipline`.

**Proposed text:**
> "Adequate search scope discipline:
> - Before reporting absence, define the search space boundary and verify coverage against it.
> - When searching for a symbol, file, or pattern, check entrypoints (main, index, exports) before глубинные files.
> - If a search returns zero results, report "not found within [defined scope]" not "does not exist."
> - Set explicit depth/width limits for breadth-first inventory before switching to depth-first targeting."

**Why needed:** The current anti-goal "Do not treat missing search results as proof of absence unless the search scope was adequate" (line 59) states the negative but not the affirmative. The affirmative discipline above provides actionable guidance.

**Causal chain:** Adding explicit search scope discipline → reduces false negatives where Scout reports "not found" after an inadequate search → supervisor receives more accurate evidence → better routing decisions.

---

### Recommendation 4: Add "Discovery Session Workflow" guidance (Low-medium priority)

**What to change:** `mastra-agents/src/prompts/agents/scout.ts` — add a workflow section to scoutPoliciesPrompt.

**Proposed text:**
> "Discovery session workflow:
> 1. Clarify the specific evidence the supervisor needs before starting broad search.
> 2. Identify the likely module or directory from the delegated question's domain.
> 3. Begin with entrypoint inspection (index, main, exports) to orient the domain boundary.
> 4. Follow import/export chains to confirm or rule out the target area.
> 5. Switch from breadth-first to depth-first once the target area is identified with high confidence.
> 6. Stop when the delegated objective is confirmed, ruled out, or blocked."

**Why needed:** Provides an explicit workflow for the most common Scout task pattern. Reduces variance. Not critical because Scout can infer this from role description, but explicit is better than inferred.

---

### Recommendation 5: Define `plan` mode prompt for Scout or remove `plan` from sharedAgentModeNames (Low priority)

**What to change:** Either:
- Add `plan: "Scout Plan mode: [appropriate guidance]"` to `scoutModePrompts` if Scout is intended to participate in plan-phase activities
- Remove `plan: "Plan"` from `sharedAgentModeNames` at `shared.ts:25` if no agent should use it as a Scout mode

**Why needed:** Latent bug. If dispatch logic ever selects `"plan"` mode for Scout, behavior is undefined. Architectural consistency requires either defining it or removing it.

---

## Anti-Patterns Present in Current Prompt

### Anti-pattern: "Do not infer cross-module ownership from naming patterns alone" (scout.ts line 58)

This is stated as a negative ("do not") without explaining what Scout should do instead. The affirmative version is implied elsewhere (inspect entrypoint path through call chain) but not directly paired with this anti-pattern.

**Better phrasing:**
> "Do not infer cross-module ownership from naming patterns alone. Instead, inspect import chains and call paths to establish actual module relationships."

**Causal chain:** This change → Scout has explicit alternative behavior when tempted to use naming inference → reduced false ownership attribution.

---

### Anti-pattern: "Broad inventories are useful only until the supervisor can route the next step" (scout.ts line 43)

This is good guidance but uses vague quantifier "useful." A supervisor reading this cannot determine when the threshold is met.

**Better phrasing:**
> "Limit broad inventory to the minimum evidence needed to identify the target module or entrypoint, typically 3-5 candidate paths. Once the likely target is identified, switch to depth-first inspection of that target."

**Causal chain:** This change → Scout has an actionable breadth limit → reduced over-searching → faster handoffs.

---

## Gaps in Evidence

- **Confidence is low** on how `agentModesFromPrompts` is invoked at runtime for Scout. The `scoutModePrompts` (lines 5-15) define prompts for `balanced`, `scope`, `research`, but it is unclear from static analysis how the harness emits these mode prompts into the active context when the mode changes. A `backend_developer_worker` runtime audit of the mode-switching mechanism would confirm whether mode prompts are actually injected as separate prompt sections or handled differently.
- **Confidence is low** on whether `composeAgentInstructions` at `shared.ts:101-118` produces a single concatenated string or handles the prompt groups in a way that could separate Scout-specific policies from shared policies at runtime. The flat concatenation at lines 113-117 suggests all prompts are in one string, but runtime behavior (prompt chunking, context window management) is not verifiable from static analysis.

---

## Drag vs Gain Classification

| Change | Classification | Mechanism |
|--------|---------------|-----------|
| Recommendation 2 (scoutToolPrompts) | Compounding gain | Adds concentrated discovery capability inside Scout module; reduces caller-side search strategy variance |
| Recommendation 3 (search scope discipline) | Compounding gain | Makes future routing decisions more reliable; reduces false-negative evidence reports |
| Recommendation 4 (discovery workflow) | Compounding gain | Explicit workflow reduces Scout behavioral variance across instances; concentrated inside the agent |
| Recommendation 5 (plan mode) | Structural drag (current state) | Undefined `plan` mode creates latent coupling between dispatch logic and agent definition; removing or defining it is compounding gain |
| Anti-pattern fixes | Compounding gain | Affirmative guidance reduces false attribution; actionable limits reduce over-searching |

---

## Summary

The Scout prompt is well-structured at the role and discipline level. The most significant gap is the absence of `scoutToolPrompts` content (empty array, line 67-69 of `scout.ts`) — a discovery-focused agent with no tool-specific guidance is leaving capability on the table. The `plan` mode gap in `scoutModePrompts` is a latent structural inconsistency. The core prompt architecture (composition order, layering of shared → specialist → Scout-specific policies) is sound and produces appropriate behavioral guidance for a read-only discovery agent.

The phase architecture contamination concern was a misread — `supervisorRuntimePolicyPrompt` is correctly scoped to `sharedPolicyPrompts.supervisor`, and Scout receives only the specialist-appropriate policies.

---

## Files Referenced

- `mastra-agents/src/agents/scout-agent.ts:14-28` — Scout agent definition and composition
- `mastra-agents/src/prompts/agents/scout.ts:1-69` — Scout-specific prompts and policies
- `mastra-agents/src/prompts/policy.ts:1-90` — Shared policy prompts (specialist and supervisor)
- `mastra-agents/src/prompts/tools.ts:1-26` — Shared tool prompts
- `mastra-agents/src/agents/shared.ts:1-129` — Composition utilities and mode infrastructure
