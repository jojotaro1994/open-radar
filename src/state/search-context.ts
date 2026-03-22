/**
 * search-context.ts — persistent: how the system searches.
 *
 * Part of the five-object radar context model.
 * Search Context is responsible for:
 *   - which sources to weight / suppress
 *   - which topics to boost / suppress
 *   - recall bias and noise tolerance
 *   - search notes and prioritization
 *
 * Search Context is NOT the same as:
 *   - Knowledge Pack (what the system knows)
 *   - Meeting Charter (how the system discusses/judges)
 *
 * Lifecycle: persistent. Written via the preview-first change flow.
 * During transition, ActiveStrategy session overlay may still apply
 * as a subordinate compatibility layer.
 */

export interface SourceWeight {
  sourceId: string
  weight: number       // 0 = suppressed, 1 = neutral, >1 = boosted
  reason?: string
}

export interface TopicBoost {
  term: string
  boost: number        // multiplier
  reason?: string
}

export interface SearchContext {
  /** Unique identifier for this Search Context */
  id: string

  /** Intent this Search Context belongs to */
  intentId: string

  /** Per-source weight adjustments */
  sourceWeights: SourceWeight[]

  /** Topics to boost in retrieval/scoring */
  topicBoosts: TopicBoost[]

  /** Topics to suppress in retrieval/scoring */
  topicSuppressions: string[]

  /** Recall bias: "broad" | "normal" | "narrow" */
  recallMode: "broad" | "normal" | "narrow"

  /** How much noise to tolerate: 0 = strict, 1 = permissive */
  noiseTolerance: number

  /** Human-readable notes about this Search Context */
  searchNotes: string

  createdAt: string
  updatedAt: string
}

/**
 * Runtime summary of Search Context for /state display.
 * Full SearchContext object may be large; this is the CLI-visible subset.
 */
export interface SearchContextSummary {
  sourceWeights?: Record<string, number>
  topicBoosts?: string[]
  topicSuppressions?: string[]
  recallMode?: string
}
