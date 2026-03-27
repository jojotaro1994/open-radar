/**
 * Commercial Assessment Schema
 *
 * LLM-powered commercial judgment for a ScoredSignal.
 * Produced by CommercialAnalyst — replaces rule-based qualification as the primary
 * commercial relevance decision layer.
 *
 * Unlike rule-based qualification (which is keyword matching),
 * CommercialAssessment uses LLM reasoning to evaluate:
 *   - Is this signal a real growth opportunity for the product?
 *   - Which verticals/segments does it affect?
 *   - How compelling is the commercial argument?
 *   - What evidence is missing?
 */

import type { Attribution } from "./attribution.js"

export type AssessmentCategory =
  | "growth_opportunity"  // clear market opportunity with commercial rationale
  | "feature_request"   // explicit new capability request
  | "workflow_friction"  // existing workflow is painful, improvement opportunity
  | "support_friction"   // known pain, existing gap, not a new opportunity
  | "bug"               // defect, belongs in bug tracker
  | "noise"             // low value, unrelated, or too vague

export interface CommercialAssessment {
  /** ID of the signal being assessed */
  signalId: string
  /** Is this a genuine commercial opportunity worth pursuing? */
  commercialRelevance: boolean
  /** Category of the signal from a commercial perspective */
  category: AssessmentCategory
  /** LLM reasoning for why this is or isn't a commercial opportunity */
  reasoning: string
  /** Confidence in the assessment: 0.0-1.0 */
  confidence: number
  /** How compelling is this opportunity: 0.0-1.0 */
  opportunityScore: number
  /** Applicable verticals (e.g., ["insurance", "travel"]) */
  verticalTags: string[]
  /** Evidence that would strengthen this assessment */
  missingEvidence: string[]
  /** Model attribution for this assessment */
  attribution: Attribution
  /** Approximate ARR impact in USD if mentioned in LLM reasoning (e.g. "~$500K ARR uplift") */
  arrImpact?: string
  /** Approximate NRR impact if mentioned in LLM reasoning */
  nrrImpact?: string
  /** Approximate NDR impact if mentioned in LLM reasoning */
  ndrImpact?: string
}
