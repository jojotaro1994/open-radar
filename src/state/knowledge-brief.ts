/**
 * Knowledge Brief — persistent: how the inward knowledge exploration is directed.
 *
 * Product model name: Knowledge Brief (4th durable control surface)
 *
 * Knowledge Brief is responsible for:
 *   - what to explore during Knowledge Run (inward lane)
 *   - which knowledge questions to answer
 *   - which knowledge sources to prioritize for inward ingestion
 *   - what knowledge patterns to suppress
 *   - how aggressively to distill vs. preserve
 *
 * Knowledge Brief is NOT the same as:
 *   - Scout Brief (how the system searches — outward radar lane)
 *   - Knowledge Base (the durable inward knowledge itself)
 *   - Knowledge Pack (distilled working set for radar run)
 *   - Meeting Goal (how the system judges — BA Meeting Room)
 *
 * Lifecycle: persistent. Written via the preview-first change flow.
 */

export interface KnowledgeQuestion {
  question: string
  priority: "high" | "medium" | "low"
  whyItMatters: string
}

export interface KnowledgeBrief {
  /** Unique identifier */
  id: string

  /** Intent this Knowledge Brief belongs to */
  intentId: string

  /** High-level direction for inward knowledge exploration */
  explorationFocus: string

  /** Questions to answer during Knowledge Run */
  explorationQuestions: KnowledgeQuestion[]

  /** Knowledge source priorities for inward lane */
  knowledgeSourcePriorities: Array<{
    sourceId: string
    priority: "high" | "medium" | "low"
    reason?: string
  }>

  /** Knowledge patterns to suppress in inward exploration */
  suppressions: string[]

  /** Distillation aggressiveness: conservative = preserve more, aggressive = distill more */
  distillationMode: "conservative" | "balanced" | "aggressive"

  /** Human-readable notes about knowledge exploration direction */
  explorationNotes: string

  createdAt: string
  updatedAt: string
}

/**
 * Runtime summary of Knowledge Brief for /state display.
 */
export interface KnowledgeBriefSummary {
  explorationFocus?: string
  explorationQuestions?: string[]
  knowledgeSourcePriorities?: Record<string, string>
  suppressions?: string[]
  distillationMode?: string
  explorationNotes?: string
}
