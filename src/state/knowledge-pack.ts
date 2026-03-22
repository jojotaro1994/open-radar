/**
 * knowledge-pack.ts — persistent: what the system knows about the business world.
 *
 * Part of the five-object radar context model.
 * Knowledge Pack is responsible for:
 *   - RIPlus product capabilities and boundaries
 *   - known limitations and facts
 *   - vertical workflow context (insurance, travel, etc.)
 *   - opportunity heuristics and signal interpretation
 *   - support taxonomy
 *
 * Knowledge Pack is NOT the same as:
 *   - Search Context (how the system searches)
 *   - Meeting Charter (how the system discusses/judges)
 *
 * Lifecycle: persistent. Written via the preview-first change flow.
 */

export interface ProductCapability {
  /** Capability name, e.g. "JIRA integration", "auto-triaging" */
  capability: string

  /** Maturity level */
  maturity: "experimental" | "beta" | "stable" | "deprecated"

  notes?: string
}

export interface OpportunityHeuristic {
  /** Pattern or rule that suggests a signal may be a real opportunity */
  pattern: string

  /** Why this pattern tends to indicate real opportunity */
  rationale: string

  confidence: "low" | "medium" | "high"
}

export interface KnowledgePack {
  /** Unique identifier */
  id: string

  /** Intent this Knowledge Pack belongs to */
  intentId: string

  /** Current RIPlus product capabilities */
  productCapabilities: ProductCapability[]

  /** Known limitations and constraints */
  knownLimitations: string[]

  /** Support taxonomy for interpreting signals */
  supportTaxonomy: string[]

  /** Vertical context (insurance workflow, travel workflow, etc.) */
  verticalContext: string

  /** Patterns that tend to indicate real opportunities */
  opportunityHeuristics: OpportunityHeuristic[]

  /** Human-readable notes about this Knowledge Pack */
  knowledgeNotes: string

  createdAt: string
  updatedAt: string
}

/**
 * Runtime summary of Knowledge Pack for /state display.
 */
export interface KnowledgePackSummary {
  productCapabilities?: string[]
  knownLimitations?: string[]
  verticalContext?: string
}
