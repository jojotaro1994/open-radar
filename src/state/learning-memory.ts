/**
 * LearningMemory — bounded, revisable, policy-level memory derived from RetrospectiveCase.
 *
 * Design:
 * - NOT a second knowledge base
 * - Lifecycle: candidate → active → superseded → expired
 * - Explicit reviewAfter for bounded staleness
 * - supersedesMemoryId for explicit supersession chain
 * - Derived from RetrospectiveCase, not standalone
 */

export type LearningMemoryType =
  | "decision_heuristic"
  | "evidence_policy"
  | "anti_pattern"
  | "blind_spot"
  | "watch_rule"

export type LearningMemoryStatus =
  | "candidate"
  | "active"
  | "superseded"
  | "expired"

export interface LearningMemory {
  memoryId: string
  memoryType: LearningMemoryType
  statement: string
  derivedFromRetrospectiveCaseIds: string[]
  status: LearningMemoryStatus
  /** When to next review this memory */
  reviewAfter: string
  /** If set, this memory supersedes the named memory */
  supersedesMemoryId?: string
  confidence: "high" | "medium" | "low"
  freshness: string
  createdAt: string
  updatedAt: string
}
