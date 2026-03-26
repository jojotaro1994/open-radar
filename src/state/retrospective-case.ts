/**
 * RetrospectiveCase — formal reopen + review of a previously resolved DecisionObject.
 *
 * Design:
 * - Only created when reopen rules match or manual escalation triggers
 * - Not every reject becomes a retrospective — explicit reopen required
 * - Tracks what changed (new evidence, new metrics, timing shift)
 * - Classifies the misjudgment type for learning extraction
 */

export type MisjudgmentType =
  | "interpretation_error"
  | "missing_evidence"
  | "timing_error"
  | "priority_error"
  | "reference_conflict_missed"

export interface RetrospectiveCase {
  retrospectiveCaseId: string
  originalDecisionObjectId: string
  originalResolution: string
  reopenReason: string
  whatChanged: string
  misjudgmentType: MisjudgmentType
  lessons: string[]
  recommendedPolicyUpdate?: string
  createdAt: string
  updatedAt: string
}
