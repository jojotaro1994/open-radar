/**
 * SourceAdapter Interface
 * Adapters fetch raw signals from external sources.
 *
 * The optional scoutEnvelope parameter is passed through for Scout weak-awareness
 * context. At this interface level, the envelope is informational — adapters are
 * not required to act on any of its fields. Specifically:
 *
 * - coverageAware/gapAware/watchRules/antiPatterns: informational context from Scout.
 *   Deduplication against previously-searched topics/sources is handled upstream
 *   via scoutPlan exclusions, not by the adapter.
 *
 * - excluded (acceptedDecisions, retrospectiveJudgments, finalMeetingResolutions):
 *   Phase 4 concern. None of the current adapters carry DecisionObject IDs in raw
 *   signals, so there is nothing at the adapter layer to filter. Full enforcement
 *   requires Phase 4 boundary work (loading DecisionObject statements into Scout
 *   context and checking Finding→DecisionObject candidates).
 */

export type { RawSignal } from '../schemas/raw-signal.js';
export type { NormalizedSignal } from '../schemas/normalized-signal.js';
export type { ScoredSignal } from '../schemas/scored-signal.js';
export type { Attribution } from '../schemas/attribution.js';
export type { RadarIntent, IntentScopeFilters } from '../schemas/intent.js';

import type { RawSignal, NormalizedSignal } from '../schemas/index.js';
import type { Attribution } from '../schemas/attribution.js';
import type { ScoutContextEnvelope } from '../state/context-envelopes.js';

export interface AdapterCapabilities {
  authType: 'none' | 'basic' | 'bearer' | 'api-key' | 'oauth';
  rateLimit?: number;
  supportsStreaming?: boolean;
}

export interface SourceAdapter {
  name: string
  capabilities?: AdapterCapabilities
  connect(): Promise<void>
  /**
   * Poll for new raw signals.
   * @param scoutEnvelope Optional Scout context envelope. When present, adapters
   *                      receive coverage/gap/watch/anti-pattern context from Scout.
   *                      The excluded field is a Phase 4 concern — see interface-level
   *                      comment for details.
   */
  poll(scoutEnvelope?: ScoutContextEnvelope): Promise<RawSignal[]>
  normalize(raw: RawSignal): NormalizedSignal
  disconnect(): Promise<void>
}