/**
 * Qualification Filter
 *
 * A PLUGGABLE qualification layer that classifies signals by commercial relevance.
 *
 * This is NOT part of the core pipeline (which only scores/categorizes).
 * This layer answers: "Does this signal represent a REAL product opportunity?"
 *
 * It lives between ScoredSignal and human triage, as extra context for the reviewer.
 *
 * Qualification categories:
 *   bug             — clear defect, belongs in bug tracker not opportunity radar
 *   support_friction — known pain, existing gap, but not a new opportunity
 *   feature_request  — explicit new capability request
 *   workflow_friction — existing workflow is painful, potential improvement opportunity
 *   noise            — low value, unrelated, or too vague
 *
 * The metadata.signalType from the source adapter is the primary qualification hint.
 *
 * Optionally accepts a RadarIntent to apply commercial criteria:
 *   - excludeTags: signals with matching tags are disqualified
 *   - minRelevanceScore: signals below threshold are downgraded
 */

import type { ScoredSignal } from "../adapters/source-adapter.js"
import type { RadarIntent } from "../schemas/intent.js"

export type Qualification =
  | "bug"
  | "support_friction"
  | "feature_request"
  | "workflow_friction"
  | "noise"

export interface QualificationResult {
  qualification: Qualification
  reasoning: string
  commercialRelevance: boolean  // true = should enter opportunity radar
}

const BUG_KEYWORDS = ["crash", "not working", "broken", "data loss", "error", "fails to", "does not save", "unable to", "locked out"]
const NOISE_KEYWORDS = ["dark mode", "meme", "funny", "lol", "just curious", "quick question"]
const FRICTION_KEYWORDS = ["confusing", "frustrat", "hard to find", "don't understand", "too many", "silently"]

/**
 * Returns a QualificationResult for a scored signal.
 * Applies RadarIntent commercial criteria when provided.
 */
export function qualify(signal: ScoredSignal, intent?: RadarIntent): QualificationResult {
  const meta = (signal as any).metadata ?? {}
  const sourceType: string = meta.signalType ?? signal.category ?? "unknown"
  const text = `${signal.title} ${signal.body}`.toLowerCase()
  const signalTags: string[] = signal.tags ?? []

  // 1. Intent excludeTags: if signal has any excludeTag, disqualify
  if (intent?.commercialCriteria?.excludeTags?.length) {
    const hasExcludedTag = intent.commercialCriteria.excludeTags.some(
      (t: string) => signalTags.some(st => st.toLowerCase().includes(t.toLowerCase()))
    )
    if (hasExcludedTag) {
      return {
        qualification: "noise",
        reasoning: `Matched intent excludeTag: '${signal.title.slice(0, 40)}' — commercially irrelevant`,
        commercialRelevance: false,
      }
    }
  }

  // 2. Intent minRelevanceScore: if below threshold, downgrade to noise
  if (intent?.commercialCriteria?.minRelevanceScore != null) {
    if (signal.relevanceScore < intent.commercialCriteria.minRelevanceScore) {
      return {
        qualification: "noise",
        reasoning: `Below minRelevanceScore threshold (${signal.relevanceScore.toFixed(2)} < ${intent.commercialCriteria.minRelevanceScore}): '${signal.title.slice(0, 40)}'`,
        commercialRelevance: false,
      }
    }
  }

  // 3. If source says bug → bug
  if (sourceType === "bug") {
    return {
      qualification: "bug",
      reasoning: `Source classified as bug: '${signal.title.slice(0, 50)}...'`,
      commercialRelevance: false,
    }
  }

  // 4. If source says support_friction → support_friction
  if (sourceType === "support_friction") {
    return {
      qualification: "support_friction",
      reasoning: `Support friction: '${signal.title.slice(0, 50)}...' — known pain but not a new opportunity`,
      commercialRelevance: false,
    }
  }

  // 5. If source says feature_request → check for noise
  if (sourceType === "feature_request") {
    const isNoise = NOISE_KEYWORDS.some(k => text.includes(k))
    if (isNoise) {
      return {
        qualification: "noise",
        reasoning: `Tagged feature_request but contains noise keyword: '${signal.title.slice(0, 40)}'`,
        commercialRelevance: false,
      }
    }
    return {
      qualification: "feature_request",
      reasoning: `Explicit feature request: '${signal.title.slice(0, 60)}'`,
      commercialRelevance: true,
    }
  }

  // 6. If source says workflow_friction → check for bug contamination
  if (sourceType === "workflow_friction") {
    const isBuggy = BUG_KEYWORDS.some(k => text.includes(k))
    if (isBuggy) {
      return {
        qualification: "bug",
        reasoning: `Tagged workflow_friction but contains bug keyword: '${signal.title.slice(0, 50)}'`,
        commercialRelevance: false,
      }
    }
    return {
      qualification: "workflow_friction",
      reasoning: `Workflow friction: '${signal.title.slice(0, 60)}' — existing workflow is painful`,
      commercialRelevance: true,
    }
  }

  // 7. Keyword-based secondary checks for unknown/ambiguous cases
  if (BUG_KEYWORDS.some(k => text.includes(k))) {
    return {
      qualification: "bug",
      reasoning: `Bug keyword detected: '${signal.title.slice(0, 50)}'`,
      commercialRelevance: false,
    }
  }

  if (NOISE_KEYWORDS.some(k => text.includes(k))) {
    return {
      qualification: "noise",
      reasoning: `Noise keyword detected: '${signal.title.slice(0, 40)}'`,
      commercialRelevance: false,
    }
  }

  // 8. Default: treat as workflow_friction if general_feedback
  if (signal.category === "general_feedback") {
    return {
      qualification: "workflow_friction",
      reasoning: `General feedback treated as workflow friction: '${signal.title.slice(0, 60)}'`,
      commercialRelevance: true,
    }
  }

  // 9. Default: noise
  return {
    qualification: "noise",
    reasoning: `Could not qualify: '${signal.title.slice(0, 40)}' — defaulted to noise`,
    commercialRelevance: false,
  }
}

/**
 * Adds qualification results to scored signals.
 * Optionally applies RadarIntent commercial criteria (excludeTags, minRelevanceScore).
 * Does NOT drop signals — all advance. Qualification is metadata for the reviewer.
 */
export function addQualification(
  signals: ScoredSignal[],
  intent?: RadarIntent
): Array<ScoredSignal & { qualification: QualificationResult }> {
  return signals.map(signal => ({
    ...signal,
    qualification: qualify(signal, intent),
  }))
}
