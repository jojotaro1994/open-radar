/**
 * SourceAdapter Interface
 * Adapters fetch raw signals from external sources
 *
 * The optional scoutEnvelope parameter enables Scout weak-awareness enforcement:
 * when present, the adapter SHOULD filter out signals matching the envelope's
 * excluded list (topics/sources the Scout phase has already covered or been
 * told to skip).
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
   * @param scoutEnvelope Optional Scout context envelope for weak-awareness enforcement.
   *                      Adapters SHOULD filter signals matching scoutEnvelope.excluded topics/sources.
   */
  poll(scoutEnvelope?: ScoutContextEnvelope): Promise<RawSignal[]>
  normalize(raw: RawSignal): NormalizedSignal
  disconnect(): Promise<void>
}