/**
 * review-handler.ts — builds structured review confirmation for DecisionObject feedback.
 *
 * Produces a preview of HumanReviewFeedback + EvidenceRequest before applying.
 * Compatible with the preview-first change flow used by tell-handler.
 */

import type { HumanReviewFeedback, ReviewResolution, FeedbackClass } from "../state/human-review-feedback.js"
import type { EvidenceRequest, EvidenceAvailabilityStatus } from "../state/evidence-request.js"
import type { RetrospectiveCase } from "../state/retrospective-case.js"
import type { LearningMemory } from "../state/learning-memory.js"
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
