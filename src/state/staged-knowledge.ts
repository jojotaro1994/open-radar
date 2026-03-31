export type StagedKnowledgeBundleStatus = "draft" | "reviewed" | "approved" | "superseded"
export type StagedKnowledgeReviewStatus = "draft" | "approved" | "rejected"
export type GraphMappingStatus = "unplanned" | "drafted" | "approved" | "applied"

export interface StagedKnowledgeItem {
  itemId: string
  bundleId: string
  title: string
  summary: string
  domain: string
  subdomain: string
  topicTags: string[]
  sourceType: string
  sourceLocator: string
  collectedAt: string
  collector: string
  lastVerifiedAt: string
  freshnessWindowDays: number
  freshnessStatus: string
  packageHint: string
  sectionType: string
  suggestedNodeKind: string
  factCandidate: boolean
  projectionTargets: string[]
  knowledgeReviewStatus: StagedKnowledgeReviewStatus
  graphMappingStatus: GraphMappingStatus
}

export interface StagedKnowledgeBundle {
  bundleId: string
  scoutRunId: string
  intentProfile: string
  researchDirection: string
  sourceLocators: string[]
  status: StagedKnowledgeBundleStatus
  createdAt: string
  updatedAt: string
  items: StagedKnowledgeItem[]
}
