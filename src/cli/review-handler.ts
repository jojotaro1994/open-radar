/**
 * review-handler.ts — builds structured review confirmation for DecisionObject feedback.
 *
 * Produces a preview of HumanReviewFeedback + EvidenceRequest + RetrospectiveCase + LearningMemory
 * before applying. Compatible with the preview-first change flow used by tell-handler.
 */

import type { HumanReviewFeedback, ReviewResolution, FeedbackClass } from "../state/human-review-feedback.js"
import type { EvidenceRequest, EvidenceAvailabilityStatus } from "../state/evidence-request.js"
import type { RetrospectiveCase, MisjudgmentType } from "../state/retrospective-case.js"
import type { LearningMemory, LearningMemoryType } from "../state/learning-memory.js"
import crypto from "crypto"

// ── Resolution + Feedback class labels ─────────────────────────────────────────

export const RESOLUTION_LABELS: Record<ReviewResolution, string> = {
  approve: "approve — promote to activation",
  reject: "reject — decline this opportunity",
  defer: "defer — revisit when conditions change",
  watch: "watch — monitor but don't act now",
  escalate: "escalate — raise to human decision-maker",
}

export const FEEDBACK_CLASS_LABELS: Record<FeedbackClass, string> = {
  not_real_opportunity: "not a real opportunity",
  insufficient_evidence: "insufficient evidence to decide",
  wrong_timing: "wrong timing for this action",
  not_strategic_now: "not strategic at this time",
  duplicate: "duplicate of existing opportunity",
  already_known: "already known/internal",
  cannot_execute_now: "cannot execute under current constraints",
  other: "other (specify in reason)",
}

export const AVAILABILITY_LABELS: Record<EvidenceAvailabilityStatus, string> = {
  available_now: "available now",
  available_later: "available later",
  not_available: "not available",
  unknown: "unknown availability",
}

// ── ID generators ─────────────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export function newFeedbackId(): string {
  return genId("feedback")
}

export function newEvidenceRequestId(): string {
  return genId("evidreq")
}

export function newRetrospectiveCaseId(): string {
  return genId("retro")
}

export function newLearningMemoryId(): string {
  return genId("mem")
}

// ── Misjudgment type labels ───────────────────────────────────────────────────

export const MISJUDGMENT_LABELS: Record<MisjudgmentType, string> = {
  interpretation_error: "interpretation error — evidence was read incorrectly",
  missing_evidence: "missing evidence — relevant data was not collected",
  timing_error: "timing error — action was too early or too late",
  priority_error: "priority error — importance was miscalibrated",
  reference_conflict_missed: "reference conflict missed — known contradicting facts were ignored",
}

// ── Learning memory type labels ────────────────────────────────────────────────

export const LEARNING_MEMORY_TYPE_LABELS: Record<LearningMemoryType, string> = {
  decision_heuristic: "decision heuristic — a rule for future decisions",
  evidence_policy: "evidence policy — a rule for what evidence to collect",
  anti_pattern: "anti-pattern — a pattern to avoid",
  blind_spot: "blind spot — a category the system failed to consider",
  watch_rule: "watch rule — a condition requiring ongoing monitoring",
}

// ── Preview builders ──────────────────────────────────────────────────────────

export interface ReviewConfirmResult {
  feedback: HumanReviewFeedback
  evidenceRequests: EvidenceRequest[]
  preview: string
  onConfirm: () => void
  onCancel: () => string
}

export function buildReviewConfirm(params: {
  decisionObjectId: string
  decisionObjectStatement: string
  resolution: ReviewResolution
  feedbackClass: FeedbackClass
  humanReason: string
  reviewedBy: string
  evidenceRequests?: { requestedItem: string; whyItMatters: string; priority: "high" | "medium" | "low"; availabilityStatus: EvidenceAvailabilityStatus; humanNote?: string }[]
  onApply: (feedback: HumanReviewFeedback, requests: EvidenceRequest[]) => void
}): ReviewConfirmResult {
  const now = new Date().toISOString()
  const feedbackId = newFeedbackId()

  const feedback: HumanReviewFeedback = {
    feedbackId,
    decisionObjectId: params.decisionObjectId,
    resolution: params.resolution,
    feedbackClass: params.feedbackClass,
    humanReason: params.humanReason,
    reviewedBy: params.reviewedBy,
    reviewedAt: now,
    createdAt: now,
    updatedAt: now,
  }

  const evidenceRequests: EvidenceRequest[] = (params.evidenceRequests ?? []).map(req => ({
    requestId: newEvidenceRequestId(),
    decisionObjectId: params.decisionObjectId,
    requestedItem: req.requestedItem,
    whyItMatters: req.whyItMatters,
    priority: req.priority,
    availabilityStatus: req.availabilityStatus,
    humanNote: req.humanNote,
    createdAt: now,
    updatedAt: now,
  }))

  const lines: string[] = []
  lines.push(`Decision Object: ${params.decisionObjectId}`)
  lines.push(`Statement: ${params.decisionObjectStatement.slice(0, 80)}`)
  lines.push(``)
  lines.push(`Resolution: ${RESOLUTION_LABELS[params.resolution]}`)
  lines.push(`Feedback class: ${FEEDBACK_CLASS_LABELS[params.feedbackClass]}`)
  lines.push(`Reason: ${params.humanReason || "(no free-text reason given)"}`)
  if (evidenceRequests.length > 0) {
    lines.push(``)
    lines.push(`Evidence Requests (${evidenceRequests.length}):`)
    for (const req of evidenceRequests) {
      lines.push(`  [${req.requestId}] ${req.requestedItem}`)
      lines.push(`    priority: ${req.priority}  |  availability: ${AVAILABILITY_LABELS[req.availabilityStatus]}`)
      lines.push(`    why it matters: ${req.whyItMatters.slice(0, 60)}`)
    }
  }
  lines.push(``)
  lines.push(`Type 'y' to confirm, 'n' to cancel`)

  return {
    feedback,
    evidenceRequests,
    preview: lines.join("\n"),
    onConfirm: () => { params.onApply(feedback, evidenceRequests) },
    onCancel: () => `Review for ${params.decisionObjectId} cancelled. No changes written.`,
  }
}

// ── Retrospective confirmation builder ────────────────────────────────────────

export interface RetrospectiveConfirmResult {
  retrospective: RetrospectiveCase
  preview: string
  onConfirm: () => void
  onCancel: () => string
}

export function buildRetrospectiveConfirm(params: {
  originalDecisionObjectId: string
  originalResolution: string
  reopenReason: string
  whatChanged: string
  misjudgmentType: MisjudgmentType
  lessons: string[]
  recommendedPolicyUpdate?: string
  onApply: (retro: RetrospectiveCase) => void
}): RetrospectiveConfirmResult {
  const now = new Date().toISOString()
  const retrospectiveCaseId = newRetrospectiveCaseId()

  const retrospective: RetrospectiveCase = {
    retrospectiveCaseId,
    originalDecisionObjectId: params.originalDecisionObjectId,
    originalResolution: params.originalResolution,
    reopenReason: params.reopenReason,
    whatChanged: params.whatChanged,
    misjudgmentType: params.misjudgmentType,
    lessons: params.lessons,
    recommendedPolicyUpdate: params.recommendedPolicyUpdate,
    createdAt: now,
    updatedAt: now,
  }

  const lines: string[] = []
  lines.push(`Retrospective Case: ${retrospectiveCaseId}`)
  lines.push(`Original Decision: ${params.originalDecisionObjectId}`)
  lines.push(`Original Resolution: ${params.originalResolution}`)
  lines.push(``)
  lines.push(`Reopen Reason: ${params.reopenReason}`)
  lines.push(`What Changed: ${params.whatChanged}`)
  lines.push(`Misjudgment Type: ${MISJUDGMENT_LABELS[params.misjudgmentType]}`)
  lines.push(`Lessons (${params.lessons.length}):`)
  for (const l of params.lessons) {
    lines.push(`  - ${l}`)
  }
  if (params.recommendedPolicyUpdate) {
    lines.push(`Recommended Policy Update: ${params.recommendedPolicyUpdate}`)
  }
  lines.push(``)
  lines.push(`Type 'y' to confirm, 'n' to cancel`)

  return {
    retrospective,
    preview: lines.join("\n"),
    onConfirm: () => { params.onApply(retrospective) },
    onCancel: () => `Retrospective for ${params.originalDecisionObjectId} cancelled. No changes written.`,
  }
}

// ── Learning memory confirmation builder ───────────────────────────────────────

export interface LearningMemoryConfirmResult {
  memory: LearningMemory
  preview: string
  onConfirm: () => void
  onCancel: () => string
}

export function buildLearningMemoryConfirm(params: {
  derivedFromRetrospectiveCaseIds: string[]
  memoryType: LearningMemoryType
  statement: string
  confidence: "high" | "medium" | "low"
  reviewAfter: string
  supersedesMemoryId?: string
  onApply: (memory: LearningMemory) => void
}): LearningMemoryConfirmResult {
  const now = new Date().toISOString()
  const memoryId = newLearningMemoryId()

  const memory: LearningMemory = {
    memoryId,
    memoryType: params.memoryType,
    statement: params.statement,
    derivedFromRetrospectiveCaseIds: params.derivedFromRetrospectiveCaseIds,
    status: "candidate",
    reviewAfter: params.reviewAfter,
    supersedesMemoryId: params.supersedesMemoryId,
    confidence: params.confidence,
    freshness: now,
    createdAt: now,
    updatedAt: now,
  }

  const lines: string[] = []
  lines.push(`Learning Memory: ${memoryId}`)
  lines.push(`Type: ${LEARNING_MEMORY_TYPE_LABELS[params.memoryType]}`)
  lines.push(`Statement: ${params.statement.slice(0, 80)}`)
  lines.push(`Confidence: ${params.confidence}`)
  lines.push(`Status: candidate (pending review)`)
  lines.push(`Review After: ${params.reviewAfter}`)
  lines.push(`Derived from: ${params.derivedFromRetrospectiveCaseIds.join(", ")}`)
  if (params.supersedesMemoryId) {
    lines.push(`Supersedes: ${params.supersedesMemoryId}`)
  }
  lines.push(``)
  lines.push(`Type 'y' to confirm, 'n' to cancel`)

  return {
    memory,
    preview: lines.join("\n"),
    onConfirm: () => { params.onApply(memory) },
    onCancel: () => `Learning memory creation cancelled. No changes written.`,
  }
}
