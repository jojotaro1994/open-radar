import type { NormalizedSignal } from './normalized-signal.js';

export interface ScoredSignal extends NormalizedSignal {
  /** Agent relevance score 0.0-1.0 */
  relevanceScore: number;
  /** Classification category */
  category: 'feature_request' | 'bug_report' | 'general_feedback' | 'noise';
  /** Whether this is a duplicate of another signal */
  isDuplicate: boolean;
  /** Agent reasoning notes */
  agentNotes: string;
  /** Cycle ID when this signal was scored */
  cycleId: string;
}
