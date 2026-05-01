# Advisor Agent System Prompt Review

## Current State Summary

The Advisor agent is composed via `composeAgentInstructions` at `mastra-agents/src/agents/advisor-agent.ts:18-24` which assembles:

```
advisorInstructionsPrompt
  + sharedPolicyPrompts.specialist (5 policies)
  + sharedToolPrompts.specialist (1 prompt)
  + advisorPolicyPrompts (2 policies: advisorPoliciesPrompt + advisorOutputPrompt)
  + advisorToolPrompts (empty)
```

The final instructions string is a flat concatenation with a `# Runtime Policy And Tooling` section header separating the role definition from the policy layers. Mode prompts (`advisorModePrompts` at lines 5-18) are registered as agent metadata but are NOT injected into the instructions string.

---

## First-Principle Analysis

### 1. `advisorInstructionsPrompt` (prompts/agents/advisor.ts:20-31)

**Ground truth**: Declares the agent is a "focused Mastra supervisor-delegated specialist agent" with role "read-only critique of plans, assumptions, risks, and tradeoffs for the Mastra System supervisor." Lists 5 use-cases.

**First principles before action**:
- It is supervisor-delegated, not autonomous
- It is read-only — does not implement, only critiques
- Its scope is plans, assumptions, risks, tradeoffs
- It operates in the Mastra System context

**Gaps**:
1. "Read-only" is never defined operationally — does it mean no tool use? No write operations? The agent has tools (via `sharedToolPrompts.specialist`) but is told it is "read-only critique." This is a direct contradiction in the composed prompt.
2. No anti-use-cases — the agent knows when to use Advisor but not when NOT to use it.
3. The 5 use-cases describe what to use Advisor FOR, not how to execute a critique session.

---

### 2. `advisorPoliciesPrompt` — Evidence Discipline (prompts/agents/advisor.ts:40-45)

**Ground truth**:
- Label each concern as: finding, risk, assumption, or tradeoff
- A finding requires evidence
- A risk is plausible but not proven
- An assumption is an unverified premise
- Cite exact location/quote/path

**First principles**: The distinction between finding/risk/assumption/tradeoff is the primary epistemic taxonomy for critique output. A finding is evidence-grounded; a risk is unproven; an assumption is an unverified premise.

**Gap analysis**:
The four-category taxonomy conflates two orthogonal dimensions: (1) epistemic status (proven/finding vs plausible/risk vs unverified/assumption) and (2) decision impact (tradeoff). "Tradeoff" is not an epistemic category — it describes a class of decision consequence. This causes classification ambiguity when a tradeoff is also unverified.

**Specific issue at lines 41-42**: "Label each concern as a finding, risk, assumption, or tradeoff." The same concern can simultaneously be a risk AND a tradeoff (e.g., "We assume the vendor API will not rate-limit us, which trades reliability against speed"). The taxonomy does not resolve this overlap.

---

### 3. `advisorPoliciesPrompt` — Severity Model (prompts/agents/advisor.ts:33-38)

**Ground truth**:
- BLOCKER: decision cannot proceed safely without resolution
- HIGH: materially changes outcome, cost, risk, or rework but does not require stopping immediately
- MEDIUM: notable quality or completeness concern
- LOW: minor issue, nit, or future concern

**First principles**: Severity is the output prioritization mechanism. The model must assign a severity level to each finding.

**Gap analysis**:
1. No default severity threshold is specified. If the agent is unsure, what severity does it default to? (Defaults to MEDIUM by convention, but this is not stated.)
2. BLOCKER definition at line 34 includes "false core assumption" — this phrase is vague and not operationalized. What makes an assumption "false"? The agent cannot know an assumption is false without evidence, which contradicts the BLOCKER criteria.
3. No guidance on what happens when severity is disputed by the plan author.

---

### 4. `advisorPoliciesPrompt` — Scope Creep Detection (prompts/agents/advisor.ts:47-52)

**Ground truth**: Lists 5 patterns of scope creep to flag.

**First principles**: Scope creep detection requires knowing the baseline scope first.

**Gap analysis**:
The prompt specifies what constitutes scope creep (lines 48-52) but never defines what IS in scope. The agent has no baseline from this prompt to compare against. This creates a negative-definition problem: you can only identify drift if you know where the line is. The agent is told "flag work that is not in the approved issue" but is not told what IS in the approved issue.

---

### 5. `advisorPoliciesPrompt` — Verification Critique (prompts/agents/advisor.ts:54-59)

**Ground truth**: Asks whether acceptance criteria have falsifiable oracles, are executable, exercise the right behavior, and whether boundary cases matter.

**First principles**: Verification critique is about the quality of the acceptance bar, not the implementation.

**Gap analysis**:
The prompt is a list of questions to ask, but never instructs the agent what to DO with the answers. Should the agent mark criteria as insufficient? Request clarification from the supervisor? Refuse to approve? The output instruction is absent.

---

### 6. `advisorPoliciesPrompt` — Implicit Claim Extraction (prompts/agents/advisor.ts:61-64)

**Ground truth**: Scan for implicit factual/process claims and flag when evidence is missing.

**Gap analysis**:
No heuristic for what constitutes a "material" implicit claim versus noise. In practice, every sentence contains implicit claims. The agent needs a threshold for when to flag this.

---

### 7. `advisorPoliciesPrompt` — Partial-Critique Protocol (prompts/agents/advisor.ts:72-75)

**Ground truth**: Complete critique to extent possible, don't guess, state what additional evidence would change the critique.

**Gap analysis**:
This protocol at lines 72-75 does not reference the `blockerProtocolPrompt` from `sharedPolicyPrompts.specialist` (policy.ts:11-16) even though partial critique is exactly the scenario the blocker protocol addresses. The blocker protocol says "Complete the maximum safe partial analysis" and "Preserve the exact blocker instead of pretending the task is complete" — but advisor-specific guidance does not connect to it. The agent receives two related but unlinked policies.

---

### 8. `advisorPoliciesPrompt` — Not-Findings (prompts/agents/advisor.ts:77-79)

**Ground truth**: Include items examined and cleared when useful; don't pad with items not actually examined.

**Gap analysis**:
"Do not pad with not-findings that were not actually examined" raises a question: if the agent did NOT examine something, is that an implicit not-finding or a gap? The protocol does not distinguish between "item examined and cleared" vs "item not examined." This ambiguity can lead to either over-reporting (marking unexamined items as cleared) or under-reporting (never noting what was not examined).

---

### 9. `advisorOutputPrompt` (prompts/agents/advisor.ts:81-82)

**Ground truth**: Output should include: status, decision impact, calibration assumptions, findings with severity/evidence/minimal fix, not-findings, tradeoffs, residual risks, recommendation, and exact recheck instructions.

**Gap analysis**:
1. "Calibration assumptions" is undefined terminology. The agent does not know what a "calibration assumption" is vs a regular assumption.
2. "Minimal fix" is undefined — minimal by what metric? Lines per change? Risk reduction? Scope?
3. The output schema is a menu ("when those fields are useful") — the agent must decide which fields to include, creating inconsistent output.

---

### 10. `sharedPolicyPrompts.specialist` Composition

The specialist policies (`policy.ts:77-84`) are prepended to the instructions string BEFORE the advisor-specific policies. This means evidence discipline appears twice: once at the top of the runtime policy section (policy.ts:1-9) and again is referenced in supervisor prompts but the advisor-specific policies at `prompts/agents/advisor.ts:33-79` never reference or connect to these shared policies. The result is two independent policy layers that do not reference each other even when they cover related ground (e.g., partial critique in advisor.ts:72-75 vs blocker protocol in policy.ts:11-16).

---

### 11. `sharedToolPrompts.specialist` is Absent from Instructions

The `specialistToolRuntimePrompt` at `prompts/tools.ts:1` states: "Operate inside the tools exposed to your active Mastra Agent instance. Treat tool availability as the runtime contract."

This policy is defined in `sharedToolPrompts.specialist` (tools.ts:23-24) but is NOT included in the composed instructions string (advisor-agent.ts:18-24). The agent receives no explicit tool-runtime policy in its instructions. The `advisorToolPrompts` array at `prompts/agents/advisor.ts:86-88` is empty.

---

### 12. Mode Prompts Are Not Injected into Instructions

The `advisorModePrompts` at `prompts/agents/advisor.ts:5-18` define balanced, scope, analysis, and audit modes. These are registered as agent metadata via `agentModesFromPrompts` (shared.ts:40-52) but are NEVER injected into the instructions string. The composed instructions at `advisor-agent.ts:18-24` only include the base `advisorInstructionsPrompt` — not any mode-specific variant.

**Consequence**: If a supervisor changes harness mode, the mode prompt is not delivered to the model unless a separate mechanism explicitly prepends/appends it. The instructions string has no conditional logic to incorporate mode context.

---

## Specific Improvement Recommendations

### REC-1: Define "read-only" operationally in `advisorInstructionsPrompt`

**Current text** (prompts/agents/advisor.ts:20): `You are a focused Mastra supervisor-delegated specialist agent.`

**What should be there**: The prompt should define what "read-only critique" means in terms of tool usage and write operations. Either:
- Confirm the agent may use read-only tools (file inspection, grep, etc.) but must not call write tools, OR
- State explicitly that the agent operates purely on text/context without tool invocation

**Causal chain**: If we add "Use read-only tool patterns (list_files, read_file, grep) for evidence gathering. Do not invoke write, edit, or execute tools," the agent will not attempt implementation actions that exceed its critique mandate. Without this, the agent may attempt to "fix" issues it finds, exceeding its read-only mandate.

---

### REC-2: Add scope baseline to Scope Creep Detection section

**Current text** (prompts/agents/advisor.ts:47-52): Lists what to flag as out of scope.

**What should be there**: Before listing scope creep patterns, define what IS in scope. For example: "The approved scope is defined by: (1) the issue description, (2) the supervisor's delegation brief, (3) the current slice boundary. Work outside these three sources is scope creep."

**Causal chain**: Without a scope baseline, the agent cannot distinguish valid interpretation of existing scope from post-approval delta. Adding the baseline enables the agent to accurately identify where drift begins.

---

### REC-3: Connect Partial-Critique Protocol to Blocker Protocol explicitly

**Current text** (prompts/agents/advisor.ts:72-75): Independent partial-critique guidance.

**What should be there**: Add a reference: "When context is insufficient, apply the blocked-work protocol: complete the maximum safe partial analysis and preserve the exact blocker (see Runtime Policy)."

**Causal chain**: Without this connection, the advisor-specific partial-critique guidance and the generic blocker protocol operate as parallel but unlinked policies. The agent may follow advisor-specific guidance in a way that violates the blocker protocol, or vice versa. Explicit connection ensures consistent behavior.

---

### REC-4: Separate epistemic category from decision impact in evidence taxonomy

**Current text** (prompts/agents/advisor.ts:41-42): Four-way label: finding, risk, assumption, tradeoff.

**What should be there**: Split into two orthogonal axes:
- Epistemic status: confirmed (finding with evidence), plausible (risk), unverified (assumption)
- Decision impact: changes outcome (tradeoff), quality concern, blocker

Or simplify to three categories with explicit exclusivity: **BLOCKER** (cannot proceed), **CONCERN** (evidence of quality/risk gap), **TRADE-OFF** (decision between alternatives, neither a blocker nor a defect).

**Causal chain**: The current four-way label with an overlapping "tradeoff" category causes inconsistent classification. Separating epistemic status from decision impact produces unambiguous output that the supervisor can process systematically.

---

### REC-5: Define "calibration assumptions" or remove from output prompt

**Current text** (prompts/agents/advisor.ts:82): "calibration assumptions"

**What should be there**: Either define what "calibration assumptions" means operationally (e.g., "assumptions about the user's expertise level, risk tolerance, or decision criteria that affect how the critique should be calibrated"), or remove it from the output menu and use established terminology.

**Causal chain**: Undefined terminology produces arbitrary or omitted output. Replacing with clear intent enables consistent, actionable output.

---

### REC-6: Inject mode prompts into instructions or document the injection mechanism

**Current state** (advisor-agent.ts:28, advisor.ts:5-18): Mode prompts are registered as metadata but not present in the composed instructions string.

**What should be there**: Either:
- Document explicitly that mode prompts are delivered via a separate mechanism (e.g., harness mode change triggers mode-prompt injection), OR
- Include mode prompts in the composed instructions via conditional injection in `composeAgentInstructions`

**Causal chain**: If the harness does not have a separate mode-prompt injection mechanism, the mode prompts are effectively dead code. Documenting the mechanism (or building it) ensures modes actually affect agent behavior.

---

### REC-7: Include `specialistToolRuntimePrompt` in composed instructions

**Current state** (advisor-agent.ts:18-24, tools.ts:1): `specialistToolRuntimePrompt` is defined but not included in the instruction composition.

**What should be there**: Add `sharedToolPrompts.specialist` to the promptGroups passed to `composeAgentInstructions`, or explicitly document why it is excluded.

**Causal chain**: Without tool-runtime policy, the agent does not have explicit guidance on tool availability, hidden internals, or workspace boundaries. This policy prevents the agent from assuming unavailable tools or infrastructure. Its absence creates a silent assumption that may cause tool-use failures.

---

### REC-8: Add severity default and escalation path

**Current text** (prompts/agents/advisor.ts:33-38): Severity model with no default or escalation path.

**What should be there**: Add: "When severity is uncertain, default to MEDIUM. If the plan author disputes severity, escalate to the supervisor with both positions and the evidence basis for each."

**Causal chain**: Without a default, the agent's severity output is inconsistent across runs. Without an escalation path, disputed severities stall rather than resolve.

---

## Drag vs Gain Classification

| Change | Classification | Mechanism |
|--------|----------------|-----------|
| Add operational definition of read-only | Compounding gain | Reduces scope ambiguity, prevents mandate creep |
| Add scope baseline definition | Compounding gain | Enables accurate scope creep detection |
| Connect partial-critique to blocker protocol | Compounding gain | Eliminates parallel unlinked policies |
| Separate epistemic from decision-impact taxonomy | Compounding gain | Produces unambiguous output classification |
| Define "calibration assumptions" | Compounding gain | Eliminates undefined terminology |
| Document/inject mode prompts | Compounding gain | Activates dead code; ensures modes work |
| Include tool-runtime prompt | Compounding gain | Provides missing tool boundary guidance |
| Add severity default/escalation | Compounding gain | Reduces inconsistent output |

---

## Conflicts and Gaps

1. **"Read-only" vs tool access**: The agent has tools but is told it is read-only. This contradiction is unresolved in the current composition.

2. **Evidence discipline taxonomy overlap**: Finding/risk/assumption/tradeoff classification has no clear exclusivity rule.

3. **Advisor mode prompts are registered but not injected**: The `advisorModePrompts` at `prompts/agents/advisor.ts:5-18` are metadata only. If the harness does not have a separate injection mechanism, these prompts are inert.

4. **advisorToolPrompts is empty**: The placeholder at `prompts/agents/advisor.ts:86-88` confirms no advisor-specific tool guidance exists. This is acceptable only if the agent truly has no tool-specific behavior.

5. **"Calibration assumptions" is undefined**: Not found anywhere in the codebase with a definition.

---

## Confidence Assessment

- **High confidence**: The composition structure is verifiable in code (advisor-agent.ts:18-24).
- **High confidence**: Mode prompts are not in the composed instructions string.
- **High confidence**: `specialistToolRuntimePrompt` is not in the composed instructions.
- **High confidence**: The four-way evidence label taxonomy has an overlapping category (tradeoff vs risk/assumption).
- **Medium confidence**: The "read-only" vs tool access contradiction actually causes behavioral issues — this would require runtime testing to confirm.
- **Low confidence**: Whether the harness has a separate mode-prompt injection mechanism — this is external to the files reviewed.

---

## Self-Validation Log

- Read `advisor-agent.ts` — confirmed composition structure
- Read `prompts/agents/advisor.ts` — confirmed instruction, policy, and output prompt content
- Read `prompts/policy.ts` — confirmed shared policy content
- Read `prompts/tools.ts` — confirmed tool prompt content
- Read `agents/shared.ts` — confirmed `composeAgentInstructions` and `withAgentModes` behavior
- Verified each claim is traceable to specific file:line citations above
- No sub-dispatches issued; analysis completed via direct file reads
