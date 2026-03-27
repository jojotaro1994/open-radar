/**
 * Context Envelopes — boundary wrappers for Scout / Modeler / Meeting runtime phases.
 *
 * Design principle: each phase receives an explicit envelope that declares what it
 * CAN see (inputs) and what it MUST NOT see (excluded by construction).
 *
 * Weak-awareness rule for Scout:
 *   - coverage-aware: knows what topics/sources were already searched
 *   - gap-aware: knows what gaps the Scout Brief identified
 *   - conclusion-blind: does NOT know accepted/rejected decisions or retrospective judgments
 *
 * These envelopes are constructed at phase entry and passed as structured context,
 * not as implicit global state.
 */

import type { ScoutPlan } from "./scout-plan.js"
import type { KnowledgeBrief } from "./knowledge-brief.js"
import type { MeetingCharter } from "./meeting-charter.js"
import type { DecisionObject } from "./decision-object.js"
import type { Finding } from "./finding.js"
import type { Evidence } from "./evidence.js"
import type { ReferenceFact } from "./reference-fact.js"
import type { HumanReviewFeedback } from "./human-review-feedback.js"
import type { LearningMemory } from "./learning-memory.js"
import type { RetrospectiveCase } from "./retrospective-case.js"

// ── Scout Context Envelope ─────────────────────────────────────────────────────

/**
 * What the Scout phase is allowed to see.
 *
 * Exclusions (enforced by construction):
 * - No accepted DecisionObject statements or resolutions
 * - No RetrospectiveCase lessons or judgments
 * - No HumanReviewFeedback conclusions
 */
export interface ScoutContextEnvelope {
  phase: "scout"

  /** The intent driving this radar run */
  intentId: string
  cycleId: string

  /** Scout assignment plan for this cycle */
  scoutPlan: ScoutPlan

  /** Topics/sources that were already searched in recent cycles (to avoid duplication) */
  coverageAware: {
    previouslySearchedTopics: string[]
    previouslySearchedSources: string[]
    lastSearchedAt?: string
  }

  /** Gaps identified in the Scout Brief that this cycle should fill */
  gapAware: {
    identifiedGaps: string[]
    gapRationale: string[]
  }

  /** Watch rules from active LearningMemory that affect what to flag */
  watchRules: Array<{
    memoryId: string
    rule: string
    condition: string
  }>

  /** Anti-patterns to avoid (from active LearningMemory) */
  antiPatterns: Array<{
    memoryId: string
    pattern: string
    avoidanceGuidance: string
  }>

  /** What the Scout must NOT see — excluded by construction */
  excluded: {
    acceptedDecisions: boolean   // if true: no approved DecisionObjects in scope
    retrospectiveJudgments: boolean  // if true: no RetrospectiveCase lessons in scope
    finalMeetingResolutions: boolean  // if true: no HumanReviewFeedback resolutions
  }

  createdAt: string
}

// ── Modeler Context Envelope ───────────────────────────────────────────────────

/**
 * What the Modeler phase is allowed to see.
 *
 * The Modeler processes Evidence into Findings.
 * It knows about existing Findings to avoid duplication.
 * It does NOT know meeting resolutions (those come after Meeting).
 */
export interface ModelerContextEnvelope {
  phase: "modeler"

  intentId: string
  cycleId: string

  /** Knowledge Brief guiding the modeling phase */
  knowledgeBrief: KnowledgeBrief

  /** Evidence items collected by Scout for this cycle */
  evidenceItems: Evidence[]

  /** Known reference facts relevant to this cycle */
  referenceFacts: ReferenceFact[]

  /** Findings already in the system (to avoid duplicate creation) */
  existingFindings: Array<{
    findingId: string
    topic: string
    summary: string
  }>

  /** DecisionObjects already in the system */
  existingDecisionObjects: Array<{
    decisionObjectId: string
    statement: string
    kind: string
  }>

  createdAt: string
}

// ── Meeting Context Envelope ───────────────────────────────────────────────────

/**
 * What the Meeting phase is allowed to see.
 *
 * Two modes:
 * - review: evaluates DecisionObject candidates (EvidenceRequest + resolution output)
 * - retrospective: evaluates reopened DecisionObjects (RetrospectiveCase + LearningMemory output)
 */
export type MeetingContextMode = "review" | "retrospective"

export interface MeetingContextEnvelope {
  phase: "meeting"
  mode: MeetingContextMode

  intentId: string
  cycleId: string

  /** Meeting charter / goal as policy input */
  meetingCharter: MeetingCharter

  /** The DecisionObject(s) under governance in this meeting */
  decisionObjects: DecisionObject[]

  /** Findings that support each DecisionObject (keyed by decisionObjectId) */
  findingBundle: Record<string, Finding[]>

  /** Evidence items supporting each Finding (keyed by findingId) */
  evidenceBundle: Record<string, Evidence[]>

  /** Reference facts, including known conflicts */
  referenceFacts: ReferenceFact[]

  /** Metrics context available for each DecisionObject */
  metricsContext: Record<string, {
    arr?: number
    nrr?: number
    ndr?: number
    notes?: string
  }>

  /** Prior review feedback for these DecisionObjects (if any) */
  priorFeedback: HumanReviewFeedback[]

  createdAt: string

  /** Retrospective mode only — additional context */
  retrospectiveContext?: {
    retrospectiveCase: RetrospectiveCase
    priorResolutions: string[]
    learningMemories: LearningMemory[]
    /** What changed since the original decision */
    whatChangedSinceOriginal: string
  }
}

// ── Envelope builder helpers ───────────────────────────────────────────────────

/**
 * Build a ScoutContextEnvelope for a radar cycle.
 * This is called at the start of the Scout phase and the envelope is passed
 * as explicit context, not stored as state.
 */
export function buildScoutContextEnvelope(params: {
  intentId: string
  cycleId: string
  scoutPlan: ScoutPlan
  coverageAware: ScoutContextEnvelope["coverageAware"]
  gapAware: ScoutContextEnvelope["gapAware"]
  watchRules: ScoutContextEnvelope["watchRules"]
  antiPatterns: ScoutContextEnvelope["antiPatterns"]
}): ScoutContextEnvelope {
  return {
    phase: "scout",
    ...params,
    excluded: {
      acceptedDecisions: true,
      retrospectiveJudgments: true,
      finalMeetingResolutions: true,
    },
    createdAt: new Date().toISOString(),
  }
}

/**
 * Build a ModelerContextEnvelope for a radar cycle.
 * Called at the start of the Modeler phase.
 */
export function buildModelerContextEnvelope(params: {
  intentId: string
  cycleId: string
  knowledgeBrief: KnowledgeBrief
  evidenceItems: Evidence[]
  referenceFacts: ReferenceFact[]
  existingFindings: ModelerContextEnvelope["existingFindings"]
  existingDecisionObjects: ModelerContextEnvelope["existingDecisionObjects"]
}): ModelerContextEnvelope {
  return {
    phase: "modeler",
    ...params,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Build a MeetingContextEnvelope for a Review Meeting.
 * Called when preparing DecisionObjects for governance review.
 */
export function buildMeetingContextEnvelope(params: {
  intentId: string
  cycleId: string
  meetingCharter: MeetingCharter
  decisionObjects: DecisionObject[]
  findingBundle: Record<string, Finding[]>
  evidenceBundle: Record<string, Evidence[]>
  referenceFacts: ReferenceFact[]
  metricsContext: Record<string, { arr?: number; nrr?: number; ndr?: number; notes?: string }>
  priorFeedback: HumanReviewFeedback[]
  retrospectiveContext?: MeetingContextEnvelope["retrospectiveContext"]
  mode?: MeetingContextMode
}): MeetingContextEnvelope {
  return {
    phase: "meeting",
    mode: params.retrospectiveContext ? "retrospective" : (params.mode ?? "review"),
    ...params,
    createdAt: new Date().toISOString(),
  }
}
