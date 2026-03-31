/**
 * Agent Augmentation Stub
 * Adds relevance scoring, categorization, and duplicate detection.
 *
 * Attribution note: stamps attribution.modelId="rule-based" when using
 * the built-in scorer. Replace with LLM Worker Pool (Section 6 tasks)
 * to get real model attribution.
 */

import type { NormalizedSignal, ScoredSignal } from "../adapters/source-adapter.js"
import type { Attribution } from "../schemas/attribution.js"

function generateScore(id: string): number {
  // Deterministic score based on signal id for repeatability
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash = hash & 0x7fffffff  // keep within positive 32-bit range
  }
  const normalized = hash / 0x7fffffff
  return 0.3 + (normalized * 0.65)
}

function categorize(title: string, body: string): ScoredSignal["category"] {
  const text = (title + " " + body).toLowerCase()
  if (text.includes("crash") || text.includes("bug") || text.includes("error") || text.includes("broken") || text.includes("fix")) {
    return "bug_report"
  }
  if (text.includes("request") || text.includes("would be nice") || text.includes("feature") || text.includes("could we") || text.includes("add")) {
    return "feature_request"
  }
  if (text.includes("checkout") || text.includes("confusing") || text.includes("frustrat") || text.includes("complaint")) {
    return "general_feedback"
  }
  return "noise"
}

function detectDuplicates(signals: NormalizedSignal[]): Set<string> {
  const duplicates = new Set<string>()
  const titleLower = signals.map(s => s.title.toLowerCase())
  
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const title1 = titleLower[i]
      const title2 = titleLower[j]
      // Check if titles share significant overlap (substring of 10+ chars)
      if (title1.length >= 10 && title2.length >= 10) {
        const shorter = title1.length < title2.length ? title1 : title2
        const longer = title1.length < title2.length ? title2 : title1
        if (shorter.split(" ").slice(0, 3).every((word: string) => longer.includes(word))) {
          duplicates.add(signals[i].id)
          duplicates.add(signals[j].id)
        }
      }
    }
  }
  return duplicates
}

export function augment(signals: NormalizedSignal[], cycleId: string): ScoredSignal[] {
  const duplicates = detectDuplicates(signals)

  return signals.map(signal => {
    const score = generateScore(signal.id)
    const category = categorize(signal.title, signal.body)
    const isDuplicate = duplicates.has(signal.id)
    const agentNotes = `[Auto] Category: ${category}, Score: ${score.toFixed(2)}`

    // Build attribution: inherit from NormalizedSignal if present, else default
    const baseAttr: Partial<Attribution> = signal.attribution ?? {};
    const attribution: Attribution = {
      intentId: baseAttr.intentId ?? 'unknown',
      sourceAdapterId: baseAttr.sourceAdapterId ?? 'unknown',
      modelId: baseAttr.modelId ?? 'rule-based', // rule-based scorer (LLM pool in Section 6)
      analyzedAt: new Date().toISOString(),
    };

    return {
      ...signal,
      relevanceScore: score,
      category,
      isDuplicate,
      agentNotes,
      cycleId,
      attribution,
    }
  })
}