import type { DecisionCard } from "../state/decision-card.js"

export interface InboxFilters {
  topic?: string
  kind?: string
  status?: string
}

export function renderPendingSummary(cards: DecisionCard[], topic?: string): string {
  const scoped = topic ? cards.filter(c => c.topic === topic) : cards
  const staleCount = scoped.filter(c => {
    const ageMs = Date.now() - new Date(c.updatedAt).getTime()
    return ageMs > 3 * 24 * 60 * 60 * 1000
  }).length
  const byKind = scoped.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1
    return acc
  }, {})
  return [
    "Pending cards summary:",
    `  total: ${scoped.length}`,
    `  by kind: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`,
    `  stale (>3d): ${staleCount}`,
  ].join("\n")
}

export function renderInbox(cards: DecisionCard[], filters: InboxFilters = {}): string {
  const filtered = cards.filter(card => {
    if (filters.topic && card.topic !== filters.topic) return false
    if (filters.kind && card.kind !== filters.kind) return false
    if (filters.status && card.status !== filters.status) return false
    return true
  })
  const lines: string[] = []
  lines.push(`\n── Decision Inbox ─────────────────────`)
  lines.push(`Cards: ${filtered.length}`)
  lines.push(``)
  for (const card of filtered) {
    lines.push(`[${card.cardId}] ${card.kind.toUpperCase()} | ${card.status}`)
    lines.push(`  ${card.title}`)
    lines.push(`  why now: ${card.whyNow}`)
    lines.push(`  topic: ${card.topic} | decision: ${card.decisionObjectId}`)
  }
  if (filtered.length === 0) lines.push(`(no cards)`)
  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}
