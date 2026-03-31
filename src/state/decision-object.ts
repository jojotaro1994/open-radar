import type { MetricsContext } from "./finding.js"

export type DecisionObjectKind = "opportunity" | "risk" | "gap" | "watch_item" | "decision_needed"
export type PriorityBand = "high" | "medium" | "low"
export type MetricsImpactDirection =
  | "expansion"
  | "retention"
  | "churn_prevention"
  | "packaging_leverage"
  | "sales_efficiency"
export type MetricsImpactStrength = "direct" | "indirect" | "speculative"

export interface MetricsImpact {
  direction: MetricsImpactDirection
  strength: MetricsImpactStrength
  context?: MetricsContext
}

export interface DecisionObject {
  decisionObjectId: string
  topic: string
  kind: DecisionObjectKind
  statement: string
  supportedByFindingIds: string[]
  priorityBand: PriorityBand
  metricsImpact?: MetricsImpact
  ownerSuggestion?: string
  freshness: string
  createdAt: string
  updatedAt: string
}
