/**
 * EvidenceRequest — structured record of what evidence is still needed for a DecisionObject.
 *
 * Design:
 * - Evidence availability is first-class, not a footnote
 * - availabilityStatus captures: available_now | available_later | not_available | unknown
 * - Backlinks to DecisionObject
 */

export type EvidenceAvailabilityStatus =
  | "available_now"
  | "available_later"
  | "not_available"
  | "unknown"

export interface EvidenceRequest {
  requestId: string
  decisionObjectId: string
  requestedItem: string
  whyItMatters: string
  priority: "high" | "medium" | "low"
  availabilityStatus: EvidenceAvailabilityStatus
  humanNote?: string
  createdAt: string
  updatedAt: string
}
