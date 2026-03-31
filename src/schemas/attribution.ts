/**
 * Attribution Schema
 * Records which intent, source adapter, and LLM model produced an artifact.
 */
export interface Attribution {
  /** RadarIntent ID used for this run */
  intentId: string;
  /** Which adapter produced the original signal */
  sourceAdapterId: string;
  /** LLM model that generated this artifact's content */
  modelId: string;
  /** ISO 8601 timestamp */
  analyzedAt: string;
}
