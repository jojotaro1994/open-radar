import type { Attribution } from './attribution.js';

export interface NormalizedSignal {
  /** Unique identifier */
  id: string;
  /** Reference to source RawSignal id */
  rawSignalId: string;
  /** Signal title */
  title: string;
  /** Signal body/content */
  body: string;
  /** Source type (e.g., 'confluence', 'slack', 'jira') */
  sourceType: string;
  /** Author name or identifier */
  author: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** Optional tags */
  tags?: string[];
  /** Optional key-value metadata */
  metadata?: Record<string, unknown>;
  /** Attribution record (set by orchestrator after normalization) */
  attribution?: Attribution;
}
