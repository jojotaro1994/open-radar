export type FindingKind = "observation" | "pattern" | "interpretation" | "contradiction"
export type FindingAggregationLevel = "single_evidence" | "multi_evidence" | "cross_source" | "cross_run"
export type FindingDecisionRelevance = "opportunity" | "risk" | "gap" | "execution" | "monitoring"

export interface MetricsContext {
  arr?: number
  nrr?: number
  ndr?: number
  notes?: string[]
}

export interface Finding {
  findingId: string
  topic: string
  findingKind: FindingKind
  aggregationLevel: FindingAggregationLevel
  decisionRelevance: FindingDecisionRelevance
  statement: string
  supportedByEvidenceIds: string[]
  metricsContext?: MetricsContext
  conflictsWithReferenceFactIds: string[]
  freshness: string
  createdAt: string
  updatedAt: string
}
