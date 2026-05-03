# Mastra Multi-Channel Agent Architecture Plan (Slack, GitHub, Linear)

This document defines the shared parent-scope architecture for building one Mastra-based agent runtime that operates across Slack, GitHub, and Linear, while delegating channel-specific implementation to sub-issues.

## Scope and ownership

- **Parent issue (RT88-65):** Shared runtime, contracts, security, state, observability, rollout sequence.
- **RT88-66 (Slack):** Slack adapter/configuration and Slack-specific UX behaviors.
- **RT88-67 (GitHub):** GitHub adapter/configuration, repo guardrails, issue/PR comment workflows.
- **RT88-68 (Linear):** Linear adapter/configuration, comments-mode first, org/team mapping.

## Shared architecture goals

1. Use a single core agent runtime across all channels.
2. Keep channel-specific rendering and APIs isolated to adapter modules.
3. Enforce consistent webhook security, idempotency, and durable state.
4. Provide deterministic rollout sequencing: Slack → GitHub → Linear.

## Target architecture

```text
[Slack Webhooks]    [GitHub Webhooks]    [Linear Webhooks]
        \                 |                 /
         \                |                /
          +---- Shared Webhook Ingress + Verification ----+
                              |
                      Event Normalization
                              |
                    Shared Channel Runtime
               (thread model + auth context + policy)
                              |
                   Shared Mastra Agent Core
                 (prompts/tools/workflows/state)
                              |
                Channel Renderer + Outbound Adapter
                /                |                 \
             Slack API       GitHub API        Linear API
```

## Core modules (parent issue deliverables)

### 1) `channel-runtime` abstraction

Define channel-agnostic interfaces:

- `InboundChannelEvent` — normalized inbound event shape.
- `ChannelContext` — installation, identity, permissions, trace context.
- `ChannelConversationRef` — canonical thread/conversation key.
- `AgentTurnRequest` / `AgentTurnResponse` — shared runtime payloads.
- `ChannelRenderer` — channel-specific render transforms from agent output.

Responsibilities:

- Normalize inbound webhook payloads into a shared message model.
- Resolve installation and auth context before agent execution.
- Call shared agent core exactly once per deduped inbound event.
- Emit structured outcomes (reply, ignore, error, retry).

### 2) `webhook-security` middleware

Shared middleware used before adapter logic:

- Raw body capture for signature verification.
- Per-channel signature verification adapters.
- Delivery id extraction for dedupe keys.
- Replay window validation and idempotency checks.

Contract:

- Invalid signatures are rejected with explicit structured logs.
- Duplicate delivery ids return no-op success responses.

### 3) `auth-resolution` service

Per-channel provider behind one interface:

- `SlackAuthProvider`
- `GitHubAuthProvider`
- `LinearAuthProvider`

Parent-scope requirement:

- Support single-tenant development configuration now.
- Preserve install-context schema and interfaces needed for OAuth/multi-tenant migration later.

### 4) Persistent state model

Minimum persistent entities:

- `installations` (channel, tenant/workspace/org, credentials reference)
- `conversation_bindings` (channel thread → canonical conversation id)
- `processed_deliveries` (dedupe + replay protection)
- `agent_runs` (run status, latency, error metadata)
- `processing_cursors` (channel progress/high-water marks where needed)

Guideline:

- Keep conversation memory channel-agnostic.
- Store channel rendering hints separately.

### 5) Observability and operations

Shared telemetry contract:

- Correlation id per webhook delivery.
- Run id linking ingress, agent execution, and outbound API calls.
- Metrics by channel: success/failure, retries, latency p50/p95, signature failures.

Operational controls:

- Retry policy with backoff and jitter.
- Dead-letter handling for repeated failures.
- Dashboard and alert thresholds by channel.

## Channel capability matrix (parent-owned)

Maintain a single matrix in the parent scope that documents:

- Threading semantics
- Message formatting constraints
- Mentions/identity behavior
- Interactive feature support
- Rate-limit and latency expectations

Sub-issues must reference this matrix and only add channel-specific details without diverging core runtime contracts.

## Sequenced implementation plan

### Phase 0 — Foundation (RT88-65)

1. Finalize shared interfaces and runtime boundaries.
2. Implement webhook-security middleware and idempotency primitives.
3. Stand up persistent storage schema and repositories.
4. Add shared observability scaffolding and baseline dashboards.
5. Publish channel capability matrix v1 and rollout checklist.

**Exit criteria:**

- Shared runtime can accept normalized test events.
- Signature verification + dedupe is passing in integration tests.
- Persistent storage is used for conversation mapping and deliveries.

### Phase 1 — Slack first (RT88-66)

- Integrate Slack adapter into shared runtime.
- Validate thread continuity and responsiveness targets.
- Confirm retries and operational behavior in staging.

### Phase 2 — GitHub (RT88-67)

- Integrate issue/PR comment events via shared runtime.
- Add repo allowlist and permission checks.
- Ensure long-running tasks use async completion patterns.

### Phase 3 — Linear (RT88-68)

- Start with comments-mode integration.
- Validate org/team installation mapping.
- Defer agent-session mode pending product need.

### Phase 4 — Hardening (RT88-65)

- Add cross-channel regression suite.
- Finalize production readiness checklist and runbook.
- Confirm no core-logic forks between channels.

## Work breakdown by issue

### Parent issue (RT88-65)

- Runtime contracts and architecture docs
- Shared middleware (security/idempotency/tracing)
- State schema and storage integration
- Capability matrix and readiness criteria

### Sub-issues

- **RT88-66:** Slack adapter + Slack UX specifics
- **RT88-67:** GitHub adapter + repo/permission guardrails
- **RT88-68:** Linear adapter + comments-first behavior

## Risks and mitigations

- **Risk:** Channel-specific behavior leaks into core runtime.
  - **Mitigation:** enforce renderer/adapters as the only channel-specific layer.
- **Risk:** Duplicate webhook deliveries cause repeated agent runs.
  - **Mitigation:** processed-deliveries table with strict unique constraints.
- **Risk:** Auth model migration pain for multi-tenant installs.
  - **Mitigation:** install-context abstractions in phase 0 even for single-tenant.
- **Risk:** Operational blind spots during rollout.
  - **Mitigation:** channel-tagged metrics + alerting before production cutover.

## Definition of done for parent scope

- Shared architecture document approved.
- Shared runtime interfaces merged with tests.
- Security/idempotency/state/observability foundations merged.
- Sub-issues have clear integration contract and sequencing dependencies.
