# Researcher Agent System Prompt Review

**Review scope**: `researcher-agent.ts` instructions and policy fields
**Files examined**:
- `/home/zzwf/mastra-system/mastra-agents/src/agents/researcher-agent.ts` (lines 1-28)
- `/home/zzwf/mastra-system/mastra-agents/src/prompts/agents/researcher.ts` (lines 1-86)
- `/home/zzwf/mastra-system/mastra-agents/src/prompts/policy.ts` (lines 1-91)
- `/home/zzwf/mastra-system/mastra-agents/src/prompts/tools.ts` (lines 1-26)
- `/home/zzwf/mastra-system/mastra-agents/src/agents/shared.ts` (lines 1-129)

---

## Current State Summary

The Researcher agent is composed via `composeAgentInstructions` from five prompt layers:

1. `researcherInstructionsPrompt` (lines 20-32 in `researcher.ts`)
2. `sharedPolicyPrompts.specialist` (5 prompts in `policy.ts` lines 78-84)
3. `sharedToolPrompts.specialist` (1 prompt in `tools.ts` line 1)
4. `researcherPolicyPrompts` (2 prompts in `researcher.ts` lines 34-81)
5. `researcherToolPrompts` (empty array in `researcher.ts` lines 83-85)

Mode prompts are provided for: balanced, research, brainstorm, analysis.

---

## First-Principle Analysis

### What the agent *should* know before taking any action

A Researcher agent operating on first principles would reason:

1. **Role identity**: I am a read-only evidence gatherer. I do not build, implement, decide scope, or synthesize final recommendations.
2. **Evidence hierarchy**: Local inspected files > local package metadata > official docs > release notes > community sources. I must cite specific sources with evidence contributed.
3. **Scope boundary**: I answer the dispatched question and stop. I do not expand to implementation concerns, feature recommendations, or adjacent discoveries.
4. **Uncertainty discipline**: I report what I cannot verify, what sources conflict, and what tools are unavailable rather than fabricating coverage.
5. **Version awareness**: Facts are version-conditional. I state observed versions and flag when docs may be stale.
6. **Synthesis role**: The supervisor synthesizes. I return findings, not decisions.

---

## Specific Improvement Recommendations

### Recommendation 1: Add explicit negative role definition

**Current text** (`researcher.ts:26-32`):
```
Use Researcher for:
- checking primary docs or authoritative references when external tools are available
- comparing repository assumptions against package metadata, local type definitions, examples, changelogs, or public docs
- identifying compatibility constraints, supported extension points, unsupported internals, and version-specific behavior
- explaining mechanisms and tradeoffs rather than producing a pattern catalog
- reporting source disagreements, freshness concerns, and uncertainty instead of smoothing them over
- answering a narrow research question for supervisor synthesis, not deciding scope or implementation alone
```

**Gap**: The "Use Researcher for" list has no corresponding "Do not use Researcher for" list. The final line hints at this but does not make it a rule.

**Causal chain**: Without explicit negatives, a model may stretch "research question" to include implementation decisions, scope choices, or pattern selection when the supervisor actually needs only evidence.

**Recommendation**: Add a "Do NOT use Researcher for" section:
```
Do NOT use Researcher for:
- implementation decisions, code writing, or bug fixing
- scope or feature decisions (those belong to the supervisor)
- final recommendations or verdicts (return findings for supervisor synthesis)
- accessing tools or systems not explicitly exposed to this agent
- producing pattern catalogs or broad surveys unless explicitly requested
```

**Why needed**: The absence of explicit negatives means the positive framing is the only guide. The phrase "not deciding scope or implementation alone" (line 32) is too weak to reliably prevent scope drift. A "Do NOT" section makes the boundary a first-class statement.

---

### Recommendation 2: Strengthen the citation discipline with concrete failure scenarios

**Current text** (`researcher.ts:67-71`):
```
Citation discipline:
- Cite local files as path:line or path:line-line when line numbers are available.
- Cite package facts with package name, version, and metadata field or source path.
- Cite external sources with URL or source name when external tools provide them.
- Never cite a source without also stating the specific evidence it contributed.
```

**Gap**: The citation rules describe what to do but do not name what happens if they are violated. Without explicit failure-mode anchoring, models may cite vaguely or cite without stating the specific evidence contribution.

**Causal chain**: Vague citations → supervisor cannot verify findings → synthesis is built on uninspectable evidence → final decision lacks audit trail.

**Recommendation**: Add failure-mode framing:
```
Citation failure modes:
- A citation without specific evidence contribution is an unsupported claim, not a finding.
- A cited URL that was not actually fetched is a fabrication, not an uncertainty.
- Line numbers that do not match the inspected content invalidate the citation.
If you cannot cite with specific evidence, state that the claim is unverified rather than presenting it as sourced.
```

**Why needed**: "Never cite a source without also stating the specific evidence it contributed" is a rule but not a failure-mode explanation. Explicitly naming what goes wrong when citations are weak creates stronger behavioral guidance.

---

### Recommendation 3: Add a "version-conditional" label mandate

**Current text** (`researcher.ts:49-53`):
```
Freshness and version discipline:
- State the observed package or docs version when it materially affects the answer.
- Mark facts as version-conditional when they apply only to a specific major or minor range.
- Flag docs as potentially stale when they lack version metadata or conflict with inspected local package state.
- If docs and local package evidence disagree, report both and identify which source should govern the active workspace.
```

**Gap**: "Mark facts as version-conditional" and "flag docs as potentially stale" are instructions but not naming conventions. A model may write "this API changed in v2" without a consistent label that makes version-conditional status machine-readable for the supervisor.

**Causal chain**: No required label format → version-conditional status is buried in prose → supervisor cannot quickly identify which facts are version-gated → synthesis may apply version-conditional findings to the wrong version.

**Recommendation**: Mandate a label format:
```
Version-conditional label: prepend [version: X.Y.Z] or [version: X.Y] to any fact that applies only to a specific range. This makes version-gated findings immediately visible to the supervisor without requiring prose parsing.
```

**Why needed**: Without a required label format, version-conditional status is advisory rather than structured. The supervisor synthesizes across multiple research calls and needs to quickly identify which findings apply to the active workspace version.

---

### Recommendation 4: Clarify mode prompt trigger conditions

**Current text** (`researcher.ts:5-18`):
```
// Mode prompts are emitted for Researcher only when the Harness mode changes.
export const researcherModePrompts = {
  balanced: `Researcher Balanced mode: ...`,
  research: `Researcher Research mode: ...`,
  brainstorm: `Researcher Brainstorm mode: ...`,
  analysis: `Researcher Analysis mode: ...`,
} as const;
```

**Gap**: The comment "emitted for Researcher only when the Harness mode changes" describes when the mode prompt is emitted but not what conditions trigger a mode change or how the researcher should behave when no mode is active. The modes also lack priority or exclusivity rules (can multiple modes be active simultaneously?).

**Causal chain**: Ambiguous mode activation → researcher may apply multiple mode behaviors simultaneously → output structure becomes inconsistent → supervisor cannot rely on mode behavior for synthesis framing.

**Recommendation**: Add mode activation guidance:
```
Mode usage:
- Modes are exclusive; apply only the active mode prompt.
- If no mode is explicitly set, default to balanced.
- Research mode is for evidence gathering; Analysis mode is for comparing already-gathered evidence; Brainstorm mode is for generating options from available facts without additional evidence gathering.
- Do not combine mode behaviors (e.g., do not gather new evidence in Analysis mode).
```

**Why needed**: The four modes have distinct purposes (gathering, comparing, generating, concluding) but no explicit exclusivity or priority rules. Without this, a model may blend behaviors (e.g., gathering new evidence while analyzing, which violates the Analysis mode definition).

---

### Recommendation 5: Add tool-availability disclosure as a mandatory first statement

**Current text** (`tools.ts:1`):
```
const specialistToolRuntimePrompt = `Operate inside the tools exposed to your active Mastra Agent instance. Treat tool availability as the runtime contract. Do not assume hidden internals, patched vendor code, unlisted MCP tools, unavailable external services, unavailable shell access, or out-of-band orchestration.`;
```

**Gap**: The prompt tells the researcher to treat tool availability as the runtime contract but does not require the researcher to *disclose* tool availability to the supervisor. If the supervisor dispatches a research task without knowing which tools are available, it cannot calibrate the question's answerability.

**Causal chain**: No mandatory tool disclosure → supervisor does not know which evidence-gathering paths are available → may dispatch questions that the researcher cannot answer with available tools but does not say so upfront → partial or fabricated answers.

**Recommendation**: Add mandatory disclosure header:
```
Tool availability disclosure (state at the start of each research session):
- List the tools available in this session.
- State explicitly if any expected tools are unavailable.
- If external research tools (web search, documentation browsing) are unavailable, state this immediately so the supervisor can recalibrate the question or provide alternative delegation.
```

**Why needed**: The current text treats tool availability as implicit ("treat as the runtime contract"). But the supervisor synthesizes across agents and needs to know what evidence paths were actually available when findings were produced.

---

### Recommendation 6: Add explicit "findings vs. recommendations" separation

**Current text** (`researcher.ts:73-76`):
```
Research phase awareness:
- Treat the supervisor as the synthesizer. Return findings for aggregation rather than writing the final project decision.
- For complex multi-source work, say when a dedicated deep-research or web-research workflow would be needed; do not pretend to run one if the skill or tool is not exposed to you.
- Keep evidence sections proportional to decision relevance.
```

**Gap**: The "return findings for aggregation rather than writing the final project decision" is stated once but not enforced structurally. A model may embed a recommendation within findings, presenting it as a finding rather than stating it as a synthesis contribution.

**Causal chain**: Findings and recommendations conflated → supervisor receives what looks like evidence but is actually an implementation decision → synthesis is biased by unacknowledged recommendation.

**Recommendation**: Add structural enforcement:
```
Findings must be separated from recommendations:
- A FINDING is: observed evidence, version, source, and what it shows.
- A RECOMMENDATION is: a course of action, pattern choice, or implementation decision.
- If you find yourself writing "you should", "the best approach is", or "I recommend", you are writing a recommendation, not a finding. Rephrase as a finding.
- The supervisor synthesizes findings into recommendations. Do not pre-synthesize.
```

**Why needed**: The current text says "rather than writing the final project decision" which is semantic guidance but not structural enforcement. Explicit separation with examples of what counts as each prevents conflation.

---

### Recommendation 7: Tighten "Source disagreement protocol" to prevent false resolution

**Current text** (`researcher.ts:55-59`):
```
Source disagreement protocol:
- Present conflicts rather than hiding them.
- If package types disagree with docs, say that package types govern the inspected version but docs may represent intended behavior.
- If runtime behavior, type definitions, and docs disagree, name each source and the implication for implementation risk.
- Do not resolve disagreement by confidence alone; explain what evidence would settle it.
```

**Gap**: The phrase "docs may represent intended behavior" is reasonable but leaves an ambiguity: if docs say one thing and types say another, the researcher is told to say docs "may represent intended behavior" but not told to flag this as a potential bug or documentation error versus an intentional deviation.

**Causal chain**: "May represent intended behavior" is too soft → researcher may implicitly validate stale docs by framing them as "intended" when they are simply outdated → supervisor synthesizes with incorrect assumption about which source is authoritative.

**Recommendation**: Strengthen the framing:
```
Source disagreement framing:
- When package types disagree with docs, state: "Package types govern for the inspected version. Docs may reflect a different version or intended future behavior."
- When runtime behavior disagrees with types or docs, name the runtime observation and flag it as an implementation risk requiring verification.
- Never frame a disagreement as "the docs are wrong" without evidence of which version the docs target.
- Always name the specific source versions in conflict.
```

**Why needed**: "Docs may represent intended behavior" is ambiguous about whether the docs are authoritative for a different version, reflect future intent, or are simply wrong. The researcher needs explicit guidance on how to frame each case.

---

## Gap Summary Table

| Recommendation | Severity | Root Cause |
|---|---|---|
| Add explicit negative role definition | High | "Use Researcher for" has no "Do NOT use for" counterpart |
| Strengthen citation discipline with failure scenarios | High | Rules stated without failure-mode explanation |
| Add version-conditional label mandate | Medium | Version-conditional status not structurally enforced |
| Clarify mode trigger conditions | Medium | Mode exclusivity and activation not defined |
| Add tool-availability disclosure as mandatory | Medium | Tool availability is implicit, not disclosed |
| Add findings vs. recommendations separation | Medium | Conflation possible without structural enforcement |
| Tighten source disagreement protocol | Low | "Intended behavior" framing is ambiguous |

---

## Policy Evaluation

### Evidence Discipline Prompt (`policy.ts:1-9`)
**Real failure mode addressed**: Yes. Fabricating completion, verification, tool access, or workspace state is a documented failure mode in multi-agent systems. The prompt explicitly names "never fabricate completion, verification, tool access, source coverage, workspace state, or memory."

**Assessment**: Strong. Names specific fabrications (completion, verification, tool access, coverage, workspace state, memory) rather than generic "don't lie."

### Blocker Protocol Prompt (`policy.ts:11-16`)
**Real failure mode addressed**: Yes. Silently expanding scope or substituting tasks to work around blockers is a common failure mode.

**Assessment**: Strong. The five-category blocker classification (not found after inspection vs. not inspected due to unavailability) is operationally useful.

### Specialist Scope Policy Prompt (`policy.ts:23-27`)
**Real failure mode addressed**: Yes. Scope drift is a primary failure mode in specialist agents.

**Assessment**: Adequate but could be strengthened with the "Do NOT" structure recommended above.

### Specialist Tool Runtime Prompt (`tools.ts:1`)
**Real failure mode addressed**: Yes. Assuming hidden internals, unlisted MCP tools, or out-of-band orchestration is a reliability failure.

**Assessment**: Adequate but lacks tool-availability disclosure requirement (see Recommendation 5).

---

## Causal Chain Summary

| Change | Behavioral Result |
|---|---|
| Add "Do NOT use Researcher for" section | Scope drift to implementation reduces; boundary becomes first-class |
| Add citation failure-mode framing | Unsupported claims labeled as such; supervisor audit trail strengthens |
| Mandate [version: X.Y.Z] label format | Version-gated findings become machine-readable for supervisor synthesis |
| Add mode exclusivity and activation rules | Researcher stops blending mode behaviors; output structure becomes predictable |
| Add mandatory tool-availability disclosure | Supervisor calibrates questions to available tools; no false answerability expectations |
| Add findings/recommendations structural separation | Recommendations no longer masquerade as findings; synthesis integrity improves |
| Strengthen "intended behavior" framing in source disagreement | Stale docs less likely to be implicitly validated as authoritative |

---

## Self-Validation Log

- [x] Read all five source files
- [x] Applied first-principle analysis to each major prompt section
- [x] Verified specific line references for every claim
- [x] Distinguished real gaps from cosmetic issues
- [x] Causal chains traced for every recommendation
- [x] Policy evaluated against documented failure modes
- [x] No production code written; analysis-only output
