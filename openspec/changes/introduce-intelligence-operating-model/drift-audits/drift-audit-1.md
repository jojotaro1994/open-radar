# Drift Audit 1 — Round 1

Date: 2026-03-27
Change: introduce-intelligence-operating-model
Status: Round 1 complete

## 1. Are we still implementing the intelligence operating model, or drifting into side refactors?

**Status: ON TRACK**

We are implementing the intelligence operating model as specified in proposal.md and design.md.

Evidence:
- Evidence → Finding → DecisionObject chain is now wired in run-pipeline.ts (Step 3b for Evidence, triage step for Finding, Step 7b for DecisionObject)
- HumanReviewFeedback, EvidenceRequest, RetrospectiveCase, LearningMemory types and stores are all created
- CLI commands for the new model are added (/decisions, /findings, /evidence, /review decision, /review feedback, /retrospective, /learning)
- No unrelated refactoring observed in this round

## 2. Are we integrating runtime behavior, or only adding passive types/files?

**Status: PARTIALLY INTEGRATED — runtime behavior is being wired**

Evidence of runtime integration:
- EvidenceStore.save() is called in run-pipeline.ts during scoring (Step 3b)
- FindingStore.save() is called in run-pipeline.ts during triage for approved signals
- DecisionObjectStore.save() is called in run-pipeline.ts during opportunity assembly (Step 7b)
- HumanReviewFeedbackStore and EvidenceRequestStore are created and CLI-wired, but not yet written to by the runtime (CLI write path exists)

Gap remaining:
- Structured feedback write from CLI is implemented (/review decision <id> <resolution> <class> [reason])
- But the runtime doesn't automatically generate EvidenceRequests or RetrospectiveCases yet — these require human review to trigger

## 3. Is meeting truly moving toward DecisionObject governance?

**Status: IN PROGRESS**

- DecisionObjects are now created from approved opportunities in the pipeline
- The pipeline still uses the old signal-based triage (MeetingRecord, ReviewQueue with signalId)
- Meeting governance is now multi-layered:
  - Old: signal-level triage → MeetingRecord (still exists, pipeline-compatible)
  - New: DecisionObject-level governance (DecisionObjects exist, CLI visible, structured feedback path exists)

The old MeetingRecord-based governance is preserved for backward compatibility. The new DecisionObject governance layer is layered on top.

## 4. Are we accidentally building a second knowledge base through LearningMemory?

**Status: NOT A RISK**

- LearningMemory is clearly scoped as bounded, revisable, policy-level memory
- It is NOT an archive, NOT a general knowledge store, NOT a case dump
- The type has explicit status lifecycle (candidate → active → superseded → expired)
- The CLI shows it separately from the knowledge base (/learning vs /knowledge)
- No cross-contamination with knowledge-base.ts or knowledge-base-store.ts

## 5. Are ARR / NRR / NDR becoming real decision inputs, or still just metadata?

**STATUS: PARTIALLY — metadata fields exist but not yet driving decisions**

Evidence:
- MetricsContext type exists in Finding (arr?, nrr?, ndr?, notes?)
- MetricsImpact exists in DecisionObject (direction, strength, context)
- Finding creation from LLM assessment attempts to extract metrics data
- CLI displays metricsImpact when present

Gap:
- No meeting policy weighting of ARR/NRR/NDR yet
- No retrospective explanation of misjudgment through missing metrics
- The commercial analyst assessment doesn't currently produce structured metrics fields

## 6. Are we preserving CLI-first operation?

**STATUS: YES**

- All new commands are CLI-native
- No web UI introduced
- New objects are stored as JSON in local filesystem
- The new model is fully operable without a web interface
- Help text updated with new commands

## 7. What should the next 3 rounds focus on?

### Priority 1: Wire RetrospectiveCase + LearningMemory into runtime
- Add a `/retro` command to create RetrospectiveCase from a previously reviewed DecisionObject
- Add a `/learning add` command to create LearningMemory from RetrospectiveCase
- Implement the "reopen rule" logic — not every reject creates a retrospective

### Priority 2: Scout/Modeler/Meeting context envelopes
- Define ScoutContextEnvelope, ModelerContextEnvelope, MeetingContextEnvelope types
- Add Scout weak-awareness enforcement (coverage-aware, gap-aware, conclusion-blind)

### Priority 3: Metrics-driven priority weighting
- Wire MeetingCharter decision style into priority band selection
- Connect ARR/NRR/NDR from LLM assessment into Finding.metricsContext
- Make DecisionObject priorityBand reflect metrics impact when available

### Priority 4: Complete the governance loop
- DecisionObject → review → HumanReviewFeedback is CLI-wired
- EvidenceRequest is CLI-visible but write path needs interactive mode
- Connect approved DecisionObjects to ActionAsset creation

## Review Channel Scan

- Inbox: empty
- Processed: none
- Action: no pending reviews to evaluate

## Round Summary

Round 1 focused on establishing the foundation:
- Governance types + stores: COMPLETE
- Evidence → Finding → DecisionObject pipeline integration: COMPLETE
- CLI exposure: COMPLETE
- Structured feedback write path: COMPLETE (CLI)
- Build + tests: PASSING
- OpenSpec status: COMPLETE

Remaining work (Tasks 4, 6, 7, 8 partially):
- Review Meeting vs Retrospective Meeting distinction
- Retrospective and LearningMemory integration into CLI write flow
- Scout/Modeler/Meeting context envelopes
- Metrics-first-class in meeting policy
