/**
 * RadarIntent Schema
 * Represents a radar scan intent — defines scope, priorities, and criteria for a run.
 */
export interface RadarIntent {
  id: string;
  name: string;
  /** One-sentence goal statement (user-facing natural language) */
  goalStatement?: string;
  /** Full-text product context for LLM system prompts */
  productContext: string;
  /** Commercial relevance criteria */
  commercialCriteria: {
    excludeTags?: string[];
    includeTags?: string[];
    minRelevanceScore?: number;
  };
  /** Source priority order for this intent */
  sourcePriority?: string[];
  /** Scope filters for qualification */
  scopeFilters?: IntentScopeFilters;
}

export interface IntentScopeFilters {
  /** Only include signals from these sources */
  sources?: string[];
  /** Only include signals created after this date */
  createdAfter?: string;
  /** Only include signals matching these tags */
  requiredTags?: string[];
  /** Exclude signals matching these tags */
  excludeTags?: string[];
}
