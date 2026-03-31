export type GraphMappingPlanStatus = "draft" | "reviewed" | "approved" | "applied" | "superseded"
export type GraphMappingEntryStatus = "draft" | "approved" | "rejected" | "applied"
export type GraphMappingTargetKind =
  | "ScoutTarget"
  | "KnowledgePackage"
  | "SourceArtifact"
  | "KnowledgeSection"
  | "Evidence"
  | "ReferenceFact"
  | "Projection"

export interface GraphMappingEntry {
  entryId: string
  planId: string
  itemId: string
  targetNodeKind: GraphMappingTargetKind
  targetKey: string
  rationale: string
  status: GraphMappingEntryStatus
}

export interface GraphMappingPlan {
  planId: string
  bundleId: string
  sourceLocators: string[]
  status: GraphMappingPlanStatus
  createdAt: string
  updatedAt: string
  summary: string
  entries: GraphMappingEntry[]
}
