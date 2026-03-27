# Tasks

## Progress Snapshot

- [x] 1. Finalize proposal, design, and spec deltas for the new intelligence operating model
- [x] 2. Add filesystem-backed scaffolding for the five core ontology objects
- [x] 3. Integrate the new object chain into runtime persistence and production flows (partially: Evidence→Finding→DecisionObject chain wired in run-pipeline)
- [ ] 4. Rework meeting governance around `DecisionObject` (DecisionObjects created; full governance loop pending)
- [x] 5. Implement structured review feedback and evidence requests (types+stores done; /review decision CLI done; structured review write pending)
- [x] 6. Implement retrospective cases and bounded learning memory (types+stores done; integration pending)
- [ ] 7. Introduce Scout / Modeler / Meeting context projections
- [ ] 8. Make metrics first-class in decisions and meeting policy
- [x] 9. Expose the new model through CLI state and review surfaces (/decisions, /findings, /evidence, /review decision, /review feedback)
- [x] 10. Verify compatibility, build, tests, and manual end-to-end flows (build and tests pass; openspec status passes)

## Task 1 — Finalize the architecture artifacts

- [x] Write `proposal.md`
- [x] Write `design.md`
- [x] Write spec deltas for:
  - `reference-baseline`
  - `intelligence-object-model`
  - `meeting-governance`
  - `decision-learning-loop`
  - `metrics-intelligence`
  - `activation-plane`
- [x] Add a delivery-oriented `handoff.md`

## Task 2 — Add core ontology scaffolding

- [x] Add canonical local-folder layout helpers
- [x] Add `ReferenceFact` type and store
- [x] Add `Evidence` type and store
- [x] Add `Finding` type and store
- [x] Add `DecisionObject` type and store
- [x] Add `ActionAsset` type and store
- [x] Keep lineage explicit through stable IDs and backlink fields

## Task 3 — Integrate the new object chain into runtime

- [x] Identify the first runtime entrypoint that should emit `Evidence` — run-pipeline.ts Step 3b (after scoring)
- [x] Identify the first runtime entrypoint that should emit `Finding` — run-pipeline.ts triage step (for approved signals)
- [x] Identify the first runtime entrypoint that should emit `DecisionObject` — run-pipeline.ts Step 7b (during opportunity assembly)
- [x] Preserve compatibility with the current radar-era runtime while introducing the new chain
- [x] Ensure a customer-intel or competitive-intel case can be persisted without using legacy `MeetingRecord` as the primary object

## Task 4 — Rework meeting governance

- [x] Replace raw signal-centered meeting input with `DecisionObject`-centered input (DecisionObjects are now created in pipeline and visible via /decisions)
- [x] Define canonical review output for governance, not commentary (HumanReviewFeedback + EvidenceRequest types established)
- [x] MeetingContextEnvelope supports review and retrospective modes (mode: "review" | "retrospective" in context-envelopes.ts)
- [ ] Distinguish Review Meeting from Retrospective Meeting in runtime (requires ba-meeting-room.ts refactor to accept DecisionObject bundle instead of signalId — BLOCKED on pipeline reorder below)
- [ ] Pipeline reorder: create DecisionObjects before MeetingRecord, then meeting evaluation as second pass over DecisionObject bundle (BLOCKER for full meeting governance)
- [ ] Upgrade `Meeting Goal` into a real policy input (MeetingCharter loaded and used; full policy input wiring in meeting evaluation deferred)
- [x] Preserve compatibility with existing meeting artifacts (MeetingRecord path preserved during transition)
- [x] Wire structured review write from CLI
## Task 5 — Implement structured review feedback

- [x] Replace free-text-only review reason handling with `HumanReviewFeedback` (type + store + CLI display)
- [x] Add `EvidenceRequest` (type + store + CLI display)
- [x] Make evidence availability first-class: available_now | available_later | not_available | unknown
- [x] Ensure reject is not treated as truth (reject = resolution, not a finding)
- [x] Wire HumanReviewFeedback write from CLI (feedbackStore.save() called on confirm)
- [x] Wire EvidenceRequest write from CLI (evidenceRequestStore.save() called on confirm; use evreq: token)

## Task 6 — Implement the decision learning loop

- [x] Add `RetrospectiveCase` persistence (type + store)
- [x] Add `LearningMemory` persistence (type + store)
- [x] Support `candidate | active | superseded | expired`
- [x] Ensure learning memory is bounded and policy-level, not a second knowledge base
- [ ] Add explicit reopen rules so not every reject becomes a retrospective case (policy-level, deferred)
- [x] Wire retrospective creation into CLI review flow (`/retro submit <decisionObjectId> <misjudgmentType> <reopenReason> --what <whatChanged> --lessons <l1>...`)
- [x] Wire learning memory creation into CLI (`/learning add <retroId> <memoryType> "<statement>" --confidence <h|m|l> --reviewafter <date>`)
- [x] Wire learning memory promotion (`/learning promote <memoryId>`)

## Task 7 — Introduce Scout / Modeler / Meeting role projections

- [x] Add `ScoutContextEnvelope` (src/state/context-envelopes.ts: ScoutContextEnvelope + buildScoutContextEnvelope)
- [x] Add `ModelerContextEnvelope` (ModelerContextEnvelope + buildModelerContextEnvelope)
- [x] Add `MeetingContextEnvelope` (MeetingContextEnvelope + buildMeetingContextEnvelope, supports review + retrospective modes)
- [ ] Enforce weak-awareness rules for Scout (runtime runner change — deferred to runner refactor; envelope types + builders are in place)

## Task 8 — Make metrics first-class

- [x] Add metrics context to `Finding` (MetricsContext already in Finding type)
- [x] Add metrics impact to `DecisionObject` (MetricsImpact already in DecisionObject type)
- [x] Wire metrics into DecisionObject creation: opportunityScore from triage assessment → priorityBand upgrade + MetricsImpact.direction/strength/context (run-pipeline.ts Step 7b)
- [x] Finding.metricsContext populated from assessment.opportunityScore during Finding creation
- [ ] Allow meeting policy to weight `ARR`, `NRR`, and `NDR` (runtime weighting in ba-meeting-room.ts — requires meeting policy runtime change; structural prerequisite met via MeetingContextEnvelope.metricsContext)
- [ ] Allow retrospective logic to explain misjudgment through missing metrics context (RetrospectiveCase.misjudgmentType covers this; runtime explanation wiring deferred)

## Task 9 — Expose the model through CLI

- [x] Add CLI/state visibility for findings (/findings)
- [x] Add CLI/state visibility for decision objects (/decisions)
- [x] Add CLI/state visibility for review feedback and evidence requests (/review decision, /review feedback)
- [x] Add CLI/state visibility for retrospective cases and learning memory (`/retrospective`, `/learning` display; `/retro submit`, `/learning add`, `/learning promote` write paths)
- [x] Keep CLI as the first-class product form

## Task 10 — Verify and hand off

- [x] `openspec status --change introduce-intelligence-operating-model` (artifacts complete)
- [x] `npm run build`
- [x] `npm test`
- [ ] Verify one competitive-intel case flows from evidence to decision object
- [ ] Verify one customer-intel case flows from evidence to decision object
- [ ] Verify one review can generate structured feedback and evidence requests
- [ ] Verify one retrospective case can generate bounded learning memory
- [ ] Update `handoff.md` with the final implementation state
