/**
 * knowledge-base.ts — persistent inward knowledge store.
 *
 * Knowledge Base is the durable, curated knowledge layer.
 * It is NOT the same as the runtime Knowledge Pack:
 *   - Knowledge Base = inward accumulation / reusable business knowledge
 *   - Knowledge Pack = distilled working subset for the current intent/run
 */

export interface KnowledgeBaseEntry {
  title: string
  kind: "fact" | "constraint" | "decision" | "taxonomy"
  summary: string
  sourceIds?: string[]
}

export interface KnowledgeBase {
  id: string
  intentId: string
  sourceIds: string[]
  summary: string
  entries: KnowledgeBaseEntry[]
  createdAt: string
  updatedAt: string
}

export interface KnowledgeBaseSummary {
  sourceIds?: string[]
  entryCount?: number
  summary?: string
}
