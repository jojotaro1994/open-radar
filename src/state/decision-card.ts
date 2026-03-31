export type DecisionCardKind = "opportunity" | "risk" | "gap"
export type DecisionCardStatus =
  | "pending_human_review"
  | "picked"
  | "rejected"
  | "deferred"
  | "watch"

export interface DecisionCard {
  cardId: string
  intentId: string
  topic: string
  decisionObjectId: string
  kind: DecisionCardKind
  title: string
  summary: string
  whyNow: string
  supportingFindingIds: string[]
  evidenceGapSummary: string[]
  meetingRecommendation: string
  status: DecisionCardStatus
  createdAt: string
  updatedAt: string
}
