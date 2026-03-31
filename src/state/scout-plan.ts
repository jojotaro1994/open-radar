/**
 * Scout Plan — an auditable plan produced by the Scout Commander before each radar run.
 *
 * This is the core artifact of the Scout Organization operating model.
 * It is NOT a freeform agent plan — it is a structured, human-readable assignment map.
 *
 * The Scout Commander (planner) reads:
 *   - Current Intent
 *   - Scout Brief (source weights, topic boosts/suppressions)
 *   - Knowledge Base (durable inward knowledge)
 *   - Knowledge Pack (current working knowledge, distilled from Knowledge Base)
 *
 * And produces:
 *   - Scout Assignments (slices of the problem space)
 *   - Rationale for each slice
 *   - Dispatch/budget weights inferred from Scout Brief keyword matches
 *   - Explicit overlap/exclusion decisions
 *   - Stop conditions
 *
 * Lifecycle: written at the start of each radar cycle; read-only thereafter.
 * Survives as part of the audit trail for /plan and /audit.
 *
 * Weight semantics:
 *   - dispatchWeight: how much radar capacity this slice gets, inferred from how many
 *     Scout Brief boost keywords match this assignment's objective keywords.
 *     Baseline 1.0; +0.25 per matched keyword; max 2.0.
 *   - budgetWeight: how deep this scout searches, also inferred from keyword match.
 *     Baseline 0.8; +0.3 per matched keyword; max 2.0.
 *   - escalationWeight: typed but not yet wired in Scout Commander v1.
 *
 * Note: Knowledge Base is the durable inward layer; Knowledge Pack is the distilled
 * runtime subset. The Scout Commander uses Knowledge Pack for objective inference,
 * but Knowledge Base is also snapshotted for full auditability.
 */

export type ScoutSliceObjective =
  | "renewal_opportunity"
  | "claims_notification"
  | "broker_workflow"
  | "apac_channel"
  | "cross_sell"
  | "multi_policy"
  | "general"

export type OverlapPolicy = "none" | "allowed" | "required"

export interface ScoutAssignment {
  /** Unique assignment identifier within the plan */
  assignmentId: string

  /** Which scout slice this assignment covers */
  objective: ScoutSliceObjective

  /** Human-readable description of this slice */
  description: string

  /** Sources this scout is allowed to use */
  allowedSources: string[]

  /** Sources explicitly excluded from this scout */
  excludedSources: string[]

  /** Topics this scout should prioritize */
  topicFocus: string[]

  /** Topics this scout should suppress beyond the global suppressions */
  additionalSuppressions: string[]

  /** Overlap policy with other scouts */
  overlapPolicy: OverlapPolicy

  /** Rationale for why this slice was created */
  rationale: string

  /** Why this slice was separated from other slices */
  separationRationale: string

  /** Stop conditions for this scout */
  stopConditions: string[]

  /** Dispatch weight — how much radar capacity this slice gets (relative) */
  dispatchWeight: number

  /** Budget weight — how deep this scout searches (relative) */
  budgetWeight: number
}

export interface ScoutPlan {
  /** Cycle this plan was generated for */
  cycleId: string

  /** Timestamp of plan generation */
  generatedAt: string

  /** Intent ID this plan was generated for */
  intentId: string

  /** How many scout assignments were created */
  totalAssignments: number

  /** All scout assignments */
  assignments: ScoutAssignment[]

  /** Overall rationale for the plan structure */
  planRationale: string

  /** What this plan chose NOT to search and why */
  exclusions: Array<{ reason: string }>

  /** What was intentionally allowed to overlap and why */
  overlaps: Array<{ assignmentIds: string[]; reason: string }>

  /** The Scout Brief (SearchContext) used to generate this plan */
  scoutBriefSnapshot: Record<string, unknown>

  /** The Knowledge Pack used to generate this plan */
  knowledgePackSnapshot: Record<string, unknown>

  /**
   * The Knowledge Base snapshot at time of plan generation.
   * Captures the durable inward knowledge layer for auditability.
   * Full distillation pipeline (Knowledge Base -> Knowledge Pack) is a
   * subsequent phase capability.
   */
  knowledgeBaseSnapshot: Record<string, unknown>
}
