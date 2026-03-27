/**
 * Meeting Record — structured evaluation output from the BA Meeting Room.
 *
 * This is the artifact of the BA Meeting Room operating model.
 * It is NOT a freeform conversation log — it is a structured evaluation record.
 *
 * The BA Meeting Room produces one MeetingRecord per opportunity/signal cluster.
 * Each record contains structured outputs from the four evaluation lenses:
 *   - Chair (orchestration + final decision framing)
 *   - Opportunity Lens (commercial opportunity case)
 *   - Skeptic Lens (critical review + evidence gaps)
 *   - Product Fit Lens (product capability alignment)
 *
 * Lifecycle: written during triage/evaluation; read-only thereafter.
 */

export interface LensOutput {
  /** The structured output from this lens */
  conclusion: string
  /** Evidence supporting this conclusion */
  supportingEvidence: string[]
  /** Gaps in evidence for this lens */
  evidenceGaps: string[]
}

export interface OpportunityLensOutput extends LensOutput {
  /** Category of opportunity */
  category: "renewal" | "claims" | "channel" | "cross_sell" | "broker" | "general"
  /** Vertical relevance */
  verticals: string[]
  /** Estimated commercial impact */
  commercialImpact: "high" | "medium" | "low"
}

export interface SkepticLensOutput extends LensOutput {
  /** Key weaknesses */
  weaknesses: string[]
  /** Risk factors */
  riskFactors: string[]
}

export interface ProductFitLensOutput extends LensOutput {
  /** Fit level */
  fitLevel: "strong" | "moderate" | "weak"
  /** What would improve fit */
  improvementPaths: string[]
}

export interface MeetingRecord {
  /** Cycle this meeting record belongs to */
  cycleId: string

  /** Signal or opportunity this record evaluates */
  signalId?: string
  /** Decision object this record evaluates (set when evaluated at DecisionObject level) */
  decisionObjectId?: string
  opportunityId?: string

  /** Timestamp of evaluation */
  evaluatedAt: string

  /** Meeting Goal used for this evaluation */
  meetingGoalSnapshot: Record<string, unknown>

  /** Structured lens outputs */
  lenses: {
    /** Orchestration + decision framing */
    chair: {
      summary: string
      finalDecision: "approved" | "rejected" | "deferred"
      decisionRationale: string
    }
    opportunity: OpportunityLensOutput
    skeptic: SkepticLensOutput
    productFit: ProductFitLensOutput
  }

  /** What evidence is still missing to make a more definitive call */
  nextEvidenceNeeded: string[]

  /** Tags summarizing this opportunity */
  tags: string[]
}
