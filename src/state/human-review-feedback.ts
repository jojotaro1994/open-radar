/**
 * HumanReviewFeedback — structured human review input for a DecisionObject.
 *
 * Design:
 * - Replaces free-text `reason?: string` in ReviewQueue triage
 * - Enforces structured resolution + feedback class + human reason
 * - Backlinks to DecisionObject, not to raw signal
 * - reject is NOT truth — reject means "not approved for activation under current model"
 */

export type ReviewResolution =
  | "approve"
  | "reject"
  | "defer"
  | "watch"
  | "escalate"

export type FeedbackClass =
  | "not_real_opportunity"
  | "insufficient_evidence"
  | "wrong_timing"
  | "not_strategic_now"
  | "duplicate"
  | "already_known"
  | "cannot_execute_now"
  | "other"

export interface HumanReviewFeedback {
  feedbackId: string
  decisionObjectId: string
  /** What the human decided */
  resolution: ReviewResolution
  /** Why they decided it */
  feedbackClass: FeedbackClass
  /** Free-text human reason (supplementary) */
  humanReason: string
  reviewedBy: string
  reviewedAt: string
  createdAt: string
  updatedAt: string
}
