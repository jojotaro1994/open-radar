export type ReferenceFactKind =
  | "product_truth"
  | "capability_boundary"
  | "known_limitation"
  | "terminology"
  | "pricing_packaging_constraint"

/**
 * ReferenceFact is baseline truth used to validate intelligence.
 * It does not directly generate business opportunities.
 */
export interface ReferenceFact {
  referenceFactId: string
  topic: string
  kind: ReferenceFactKind
  title: string
  statement: string
  sourceRefs: string[]
  freshness: string
  lastVerifiedAt: string
  createdAt: string
  updatedAt: string
}
