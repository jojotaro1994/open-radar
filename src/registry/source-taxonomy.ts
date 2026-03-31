import { getCatalog } from "./adapter-catalog.js"

export type SourceWorkflowType = "opportunity_source" | "knowledge_source" | "dual_use"

export interface SourceWorkflowBuckets {
  opportunity: string[]
  knowledge: string[]
  dualUse: string[]
}

function fallbackFromLegacyHints(sourceId: string): SourceWorkflowType {
  if (sourceId.startsWith("jira") || sourceId === "confluence") return "knowledge_source"
  return "opportunity_source"
}

export function getSourceWorkflowType(sourceId: string): SourceWorkflowType {
  try {
    const catalog = getCatalog()
    const entry = catalog.adapters.find(adapter => adapter.id === sourceId)
    if (entry?.sourceType) return entry.sourceType
    return fallbackFromLegacyHints(sourceId)
  } catch {
    return fallbackFromLegacyHints(sourceId)
  }
}

export function bucketSourcesByWorkflowType(sourceIds: string[]): SourceWorkflowBuckets {
  const buckets: SourceWorkflowBuckets = {
    opportunity: [],
    knowledge: [],
    dualUse: [],
  }

  for (const sourceId of sourceIds) {
    const type = getSourceWorkflowType(sourceId)
    if (type === "opportunity_source") buckets.opportunity.push(sourceId)
    else if (type === "knowledge_source") buckets.knowledge.push(sourceId)
    else buckets.dualUse.push(sourceId)
  }

  return buckets
}
