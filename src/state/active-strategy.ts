/**
 * ActiveStrategy — session-level overlay on top of Current Intent.
 *
 * Lifecycle: current session only. Discarded on exit. Never written to intent config.
 *
 * Fields:
 *   focus             — session scope narrowing (does not modify intent includeTags)
 *   relevanceThreshold — overrides intent.commercialCriteria.minRelevanceScore
 *   sourceBias        — temporary source adjustment (pause / boost)
 *   patches           — ordered list of all session patches applied this session
 */

export interface SessionPatch {
  seq: number
  field: "focus" | "relevanceThreshold" | "sourceBias"
  value: unknown
  trigger: string  // user's original text
}

export interface ActiveStrategy {
  focus?: string
  relevanceThreshold?: number
  sourceBias?: { action: "pause" | "boost"; sourceId: string }
  patches: SessionPatch[]
}

export class ActiveStrategyManager {
  private strategy: ActiveStrategy = { patches: [] }
  private seq = 0

  get(): ActiveStrategy {
    return this.strategy
  }

  applyFocus(value: string, trigger: string): void {
    this.seq++
    this.strategy.focus = value
    this.strategy.patches.push({ seq: this.seq, field: "focus", value, trigger })
  }

  applyRelevanceThreshold(value: number, trigger: string): void {
    this.seq++
    this.strategy.relevanceThreshold = value
    this.strategy.patches.push({ seq: this.seq, field: "relevanceThreshold", value, trigger })
  }

  applySourceBias(value: { action: "pause" | "boost"; sourceId: string }, trigger: string): void {
    this.seq++
    this.strategy.sourceBias = value
    this.strategy.patches.push({ seq: this.seq, field: "sourceBias", value, trigger })
  }

  undoLast(): SessionPatch | null {
    const last = this.strategy.patches.pop()
    if (!last) return null
    this.recompute()
    return last
  }

  private recompute(): void {
    this.strategy.focus = undefined
    this.strategy.relevanceThreshold = undefined
    this.strategy.sourceBias = undefined
    for (const patch of this.strategy.patches) {
      if (patch.field === "focus") this.strategy.focus = patch.value as string
      if (patch.field === "relevanceThreshold") this.strategy.relevanceThreshold = patch.value as number
      if (patch.field === "sourceBias") this.strategy.sourceBias = patch.value as { action: "pause" | "boost"; sourceId: string }
    }
  }

  clear(): void {
    this.strategy = { patches: [] }
    this.seq = 0
  }

  hasPatches(): boolean {
    return this.strategy.patches.length > 0
  }
}
