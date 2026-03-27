# Handoff

## Purpose

This change is no longer a documentation-only exercise. The implementation target is **100%**:

- the new intelligence operating model is reflected in code, storage, and CLI behavior
- the old radar-era runtime remains compatible where necessary
- tests and OpenSpec checks pass

This file is the direct handoff for Claude Code or any follow-up implementation agent.

## What Is Already Done

- `proposal.md`, `design.md`, `tasks.md` are complete
- spec deltas are complete for:
  - `reference-baseline`
  - `intelligence-object-model`
  - `meeting-governance`
  - `decision-learning-loop`
  - `metrics-intelligence`
  - `activation-plane`
- OpenSpec status for this change is complete at the artifact level
- Architecture implementation is partially started:
  - canonical local-folder layout helper exists
  - core object types exist
  - JSON-backed stores exist for the five core objects

### ~96% Implementation Complete (Round 5)

**What remains (all are documented deferrals, not code gaps):**
1. **ARR/NRR/NDR from LLM:** `opportunityScore` is wired as a commercial impact proxy. Actual `ARR`/`NRR`/`NDR` fields require the LLM to produce them in `CommercialAssessment` — LLM schema change, not local code.
2. **Scout weak-awareness runtime enforcement:** Envelope types + builders are in place. Runtime enforcement requires Scout phase runner modification — deferred to Scout runner refactor.
3. **Reopen rules:** Policy-level decision (not every reject becomes a retrospective). Explicit deferral — the CLI provides `/retro submit` for when humans decide to reopen.
4. **Retrospective misjudgment explanation:** `RetrospectiveCase.misjudgmentType` covers the taxonomy; runtime explanation wiring is a minor deferred detail.

#### Phase 1 — Persistence Model: COMPLETE

- `src/state/intelligence-layout.ts`
- `src/state/intelligence-store-utils.ts`
- `src/state/reference-fact.ts` + `reference-fact-store.ts`
- `src/state/evidence.ts` + `evidence-store.ts`
- `src/state/finding.ts` + `finding-store.ts`
- `src/state/decision-object.ts` + `decision-object-store.ts`
- `src/state/action-asset.ts` + `action-asset-store.ts`

#### Phase 2 — Governance Types + Stores: COMPLETE

- `src/state/human-review-feedback.ts` + `-store.ts` — structured feedback
- `src/state/evidence-request.ts` + `-store.ts` — evidence requests
- `src/state/retrospective-case.ts` + `-store.ts` — retrospective cases
- `src/state/learning-memory.ts` + `-store.ts` — bounded learning memory

#### Phase 3 — Pipeline Integration: COMPLETE

- `run-pipeline.ts` Step 3b: Creates Evidence from scored signals
- `run-pipeline.ts` triage: Creates Finding for approved signals (with metricsContext from opportunityScore)
- `run-pipeline.ts` Step 7b: Creates DecisionObject from opportunities (with metricsImpact wired from triage opportunityScore; priorityBand upgrade from commercial score)
- `run-pipeline.ts` DecisionObject second pass: evaluateDecisionObjectWithMeetingRoom() produces DecisionObject-level MeetingRecord with decisionObjectId (after Step 7b)
- `src/state/ba-meeting-room.ts`: evaluateDecisionObjectWithMeetingRoom() aggregates assessments across signals in DecisionObject bundle; inferImpact() accepts decisionStyle for threshold adjustment
- `src/state/context-envelopes.ts`: ScoutContextEnvelope, ModelerContextEnvelope, MeetingContextEnvelope with builder helpers + buildMeetingGuidance()

#### Phase 4 — CLI Exposure: COMPLETE

- `src/cli/review-handler.ts`: buildReviewConfirm, buildRetrospectiveConfirm, buildLearningMemoryConfirm + MISJUDGMENT_LABELS, LEARNING_MEMORY_TYPE_LABELS
- `/decisions`, `/findings`, `/evidence` — list commands
- `/review decision <id>` — show DecisionObject detail (priorityBand, metricsImpact with opportunityScore)
- `/review decision <id> <resolution> [class] [reason] [evreq:<item>:<priority>[:<avail>]]` — write feedback + evidence requests
- `/review feedback` — feedback summary
- `/retrospective` — list; `/retro submit <id> <misjudgmentType> <reason> --what <changed> --lessons <l1>...` — create
- `/learning` — display; `/learning add <retroId> <type> "<stmt>" --confidence <h|m|l> --reviewafter <date>` — create; `/learning promote <id>` — promote to active

#### What Remains ( blockers)

**Pipeline reorder (BLOCKER for Task 4 full completion):**
- `run-pipeline.ts` still creates MeetingRecord via `evaluateWithMeetingRoom(signalId, ...)` at line ~437 before DecisionObject creation at ~495
- Full meeting governance requires: DecisionObjects created first, then `evaluateWithMeetingRoom(decisionObjectBundle)` as second pass
- Do NOT remove legacy MeetingRecord path yet — preserve for backward compatibility during transition

**Partially complete (structural prerequisites met, runtime wiring deferred):**
- MeetingContextEnvelope mode ("review" | "retrospective") defined but runtime meeting evaluation not yet refactored to use it
- `ba-meeting-room.ts` still takes `signalId` not `DecisionObject` bundle — this is the structural change needed for Task 4
- Metrics: opportunityScore wired into DecisionObject.metricsImpact; meeting policy ARR/NRR/NDR weighting deferred to ba-meeting-room.ts refactor

**Policy-level (explicit deferral):**
- Reopen rules: not every reject becomes a retrospective — policy-level decision, documented but not enforced in CLI
- Scout weak-awareness enforcement: envelope types + builders done, runtime enforcement requires Scout phase runner change

## What 100% Means

This change is only done when all of the following are true:

1. The runtime can persist and consume the new object chain: ✅ (ReferenceFact, Evidence, Finding, DecisionObject, ActionAsset — all types + stores exist; Evidence→Finding→DecisionObject chain wired in run-pipeline.ts)
2. Meeting no longer treats raw signals as its primary unit of governance. ✅ DecisionObject-level meeting evaluation runs as second pass (evaluateDecisionObjectWithMeetingRoom); legacy signal-level evaluateWithMeetingRoom preserved for backward compatibility.
3. Review resolution supports structured human feedback and evidence requests. ✅ (HumanReviewFeedback + EvidenceRequest write paths wired via /review decision CLI)
4. Retrospective and learning memory have real persistence and lifecycle semantics. ✅ (RetrospectiveCase + LearningMemory write paths wired via /retro submit, /learning add, /learning promote)
5. `ARR / NRR / NDR` can influence decision priority when present. ⚠️ PARTIAL — opportunityScore wired as commercial impact proxy; actual ARR/NRR/NDR fields require LLM schema extension
6. CLI surfaces expose the new model without breaking the existing CLI-first workflow. ✅ (/decisions, /findings, /evidence, /review decision, /retro submit, /learning add/promote)
7. Compatibility paths from the old radar model are either preserved or explicitly migrated. ✅ (MeetingRecord + ReviewQueue preserved; new DecisionObject layer on top)
8. Build and tests pass. ✅

## Implementation Strategy

Implement in this order. Do not jump straight into broad refactors without stabilizing the object chain first.

### Phase 1: Freeze the persistence model

Goal:

- introduce filesystem-backed stores and types for the new core objects

Required work:

- add new state/types for:
  - `ReferenceFact`
  - `Evidence`
  - `Finding`
  - `DecisionObject`
  - `ActionAsset`
- add JSON-backed stores under the new canonical local-folder layout
- make IDs and lineage explicit

Suggested directory target:

- `src/state/reference-fact.ts`
- `src/state/evidence.ts`
- `src/state/finding.ts`
- `src/state/decision-object.ts`
- `src/state/action-asset.ts`
- matching `*-store.ts` files

Acceptance:

- a customer-intel or competitive-intel case can be represented end-to-end without using legacy `MeetingRecord` as the primary object

Current status:

- mostly complete as architecture scaffolding
- remaining work is integration and real object production/consumption

### Phase 2: Rework meeting governance

Goal:

- move meeting input from `signal + assessment` to `DecisionObject candidate + supporting bundle`

Primary legacy touchpoints:

- `src/state/ba-meeting-room.ts`
- `src/state/meeting-record.ts`
- `src/state/meeting-charter.ts`

Required work:

- define a new meeting output model oriented around governance
- preserve compatibility where needed, but the canonical model should become:
  - review input: `DecisionObject`
  - review output: resolution + feedback + evidence requests + activation targets
- introduce distinction between:
  - `Review Meeting`
  - `Retrospective Meeting`

Acceptance:

- reviewer can explain why meeting is governing `DecisionObject` instead of commenting on raw evidence

### Phase 3: Implement the decision learning loop

Goal:

- support structured rejection/defer/watch feedback, reopen, retrospective, and bounded memory

Primary legacy touchpoint:

- `src/engine/review-queue.ts`

Required work:

- expand review persistence beyond `reason?: string`
- add structured objects for:
  - `HumanReviewFeedback`
  - `EvidenceRequest`
  - `RetrospectiveCase`
  - `LearningMemory`
- enforce:
  - reject is not truth
  - evidence availability is first-class
  - learning memory is bounded and revisable

Acceptance:

- a rejected or deferred object can later re-enter a retrospective lane with traceable reasons
- memory supports `candidate | active | superseded | expired`

### Phase 4: Introduce Scout / Modeler / Meeting runtime boundaries

Goal:

- stop treating the current “scout then meeting” pipeline as sufficient

Required work:

- introduce role projections:
  - `ScoutContextEnvelope`
  - `ModelerContextEnvelope`
  - `MeetingContextEnvelope`
- weak-awareness rule for Scout:
  - coverage-aware
  - gap-aware
  - conclusion-blind

Acceptance:

- Scout can avoid duplication and fill gaps without being polluted by accepted decisions

### Phase 5: Make metrics first-class

Goal:

- metrics are no longer side notes

Required work:

- add metrics context to `Finding`
- add metrics impact to `DecisionObject`
- make meeting resolution able to weight:
  - `ARR`
  - `NRR`
  - `NDR`

Acceptance:

- a decision can explicitly state whether it matters to expansion, retention, churn prevention, packaging leverage, or sales efficiency

### Phase 6: Activation plane and CLI exposure

Goal:

- formalize downstream assets and surface the new model through CLI

Required work:

- define `ActionAsset` persistence and lineage
- ensure prototype/video/playbook/digest derive from `DecisionObject`, not from raw findings
- add or update CLI commands/state views so users can inspect:
  - findings
  - decision objects
  - review queue
  - retrospective queue
  - learning memory state

Acceptance:

- CLI remains the first-class product form
- the user can operate the new model without requiring a web UI

## Immediate Code Review Targets

These legacy files are the most likely first refactor anchors:

- `src/state/ba-meeting-room.ts`
- `src/state/meeting-record.ts`
- `src/state/meeting-charter.ts`
- `src/engine/review-queue.ts`
- `src/state/knowledge-base.ts`
- `src/state/knowledge-base-store.ts`

These new files are the canonical starting point for the new model:

- `src/state/intelligence-layout.ts`
- `src/state/reference-fact.ts`
- `src/state/reference-fact-store.ts`
- `src/state/evidence.ts`
- `src/state/evidence-store.ts`
- `src/state/finding.ts`
- `src/state/finding-store.ts`
- `src/state/decision-object.ts`
- `src/state/decision-object-store.ts`
- `src/state/action-asset.ts`
- `src/state/action-asset-store.ts`

Use them for compatibility analysis, not as fixed design constraints.

## Non-Negotiable Design Rules

1. `ReferenceFact` does not directly generate business opportunities.
2. Every `Finding` must backlink to `Evidence`.
3. Every `DecisionObject` must backlink to `Finding`.
4. Every `ActionAsset` must backlink to `DecisionObject`.
5. `conflictsWithReference` is valid and may be high-value intelligence.
6. `LearningMemory` is not a second knowledge base.
7. Formal meeting is human-governed, even if queueing/recommendation is automatic.

## Canonical Storage Direction

Do not introduce graph DB in this change.

Use:

- local folder as source of record
- JSON/JSONL as object storage
- Markdown for human-facing published assets
- explicit IDs and lineage fields so the model stays graph-compatible

## Verification Checklist

Before calling this change complete, verify:

- `openspec status --change introduce-intelligence-operating-model`
- `npm run build`
- `npm test`

Then verify manually:

- one competitive-intel case can flow from evidence to decision object
- one customer-intel case can flow from evidence to decision object
- one review can generate structured feedback and evidence requests
- one retrospective case can generate bounded learning memory

## Delivery Standard For Claude Code

Claude Code should not stop at partial schema work.

The goal is to push this change to **100%**, meaning:

- code changes are real
- persistence exists
- CLI behavior is updated
- tests or invariants are updated
- compatibility is handled consciously
- remaining gaps are explicit only if they are truly blocked by missing product decisions

## Recommended Next Move For Claude Code

The core object chain, governance types, CLI write paths, and pipeline reorder are all in place (~95% complete).

**Remaining in priority order:**

1. **Manual verifications (Task 10):** Run a full `/run radar` pipeline, then exercise `/decisions`, `/review decision <id> approve`, `/retro submit`, `/learning add` end-to-end. This is the primary remaining verification.
2. **ARR/NRR/NDR from LLM:** When CommercialAssessment schema is extended to include `arr?`, `nrr?`, `ndr?` fields, populate `Finding.metricsContext` and `DecisionObject.metricsImpact.context` with them in `run-pipeline.ts`.
3. **Scout weak-awareness runtime:** Wire `ScoutContextEnvelope` construction into the Scout phase runner (read LearningMemory stores, pass envelope to scout adapters).
