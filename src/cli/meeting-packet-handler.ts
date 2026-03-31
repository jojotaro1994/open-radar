import type { Projection, KnowledgePackage, ReferenceFact } from "../state/graph/types.js"

export interface MeetingPacketDeliberation {
  stance: "proceed" | "defer" | "needs_clarification"
  summary: string
  highlights: string[]
  evidenceGaps: string[]
  nextActions: string[]
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function clip(text: string, limit = 140): string {
  const normalized = compact(text)
  return normalized.length <= limit ? normalized : normalized.slice(0, limit - 1) + "…"
}

function isGapFact(statement: string): boolean {
  return /(evidence gap|open question|cannot determine|unclear|unknown|missing|not clear|unresolved)/i.test(statement)
}

export function deliberateMeetingPacket(
  projection: Projection,
  pkg: KnowledgePackage | null,
  facts: ReferenceFact[]
): MeetingPacketDeliberation {
  const uniqueFacts = Array.from(new Map(facts.map((fact) => [fact.id, fact])).values())
  const gapFacts = uniqueFacts.filter((fact) => isGapFact(fact.statement))
  const confirmedFacts = uniqueFacts.filter((fact) => !isGapFact(fact.statement))

  const highlights = confirmedFacts.slice(0, 5).map((fact) => clip(fact.statement))
  const evidenceGaps = gapFacts.slice(0, 5).map((fact) => clip(fact.statement))

  const stance: MeetingPacketDeliberation["stance"] =
    confirmedFacts.length === 0
      ? "needs_clarification"
      : gapFacts.length > confirmedFacts.length
      ? "defer"
      : "proceed"

  const scope = pkg?.package_path ?? projection.projection_key
  const summary =
    stance === "proceed"
      ? `Packet indicates usable meeting material for ${scope}; proceed with judgment using the confirmed facts and keep the listed gaps visible.`
      : stance === "defer"
      ? `Packet for ${scope} is gap-heavy; defer hard judgment until the evidence gaps are narrowed.`
      : `Packet for ${scope} is mostly unresolved; use it to frame questions rather than make a hard call.`

  const nextActions = [
    gapFacts.length > 0
      ? `Refresh scouting around the top gap: ${clip(gapFacts[0]!.statement, 110)}`
      : `Promote the current packet into downstream decision review for ${scope}`,
    `Trace one supporting fact from ${projection.id} before taking action`,
    `Re-run /meeting ${projection.projection_key} after the next scout refresh`,
  ]

  return {
    stance,
    summary,
    highlights,
    evidenceGaps,
    nextActions,
  }
}

export function renderMeetingPacketDeliberation(
  projection: Projection,
  pkg: KnowledgePackage | null,
  facts: ReferenceFact[],
  deliberation: MeetingPacketDeliberation
): string {
  const lines: string[] = []
  lines.push(`Using MeetingPacket: ${projection.id}`)
  lines.push(`Title:      ${projection.title}`)
  lines.push(`Key:        ${projection.projection_key}`)
  lines.push(`Freshness:  ${projection.freshness_status}`)
  if (pkg) lines.push(`Package:    ${pkg.package_path} [${pkg.package_kind}]`)
  lines.push(`Facts:      ${facts.length}`)
  lines.push(`Stance:     ${deliberation.stance}`)
  lines.push(`Summary:    ${deliberation.summary}`)

  if (deliberation.highlights.length > 0) {
    lines.push(`Highlights:`)
    for (const item of deliberation.highlights) lines.push(`  - ${item}`)
  }

  if (deliberation.evidenceGaps.length > 0) {
    lines.push(`Evidence gaps:`)
    for (const item of deliberation.evidenceGaps) lines.push(`  - ${item}`)
  }

  lines.push(`Next actions:`)
  for (const item of deliberation.nextActions) lines.push(`  - ${item}`)

  return lines.join("\n")
}
