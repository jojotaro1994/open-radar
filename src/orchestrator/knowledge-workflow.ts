/**
 * knowledge-workflow.ts — inward knowledge lane.
 *
 * Knowledge Run responsibilities:
 *   - Poll knowledge sources (Jira, Confluence) directed by Knowledge Brief
 *   - Update Knowledge Base with new curated entries
 *   - Produce a refreshed candidate Knowledge Pack (status: "candidate")
 *   - The candidate pack must be reviewed/accepted before Radar Run consumes it
 *
 * This is the inward lane counterpart to the outward Radar Run.
 * Knowledge Run does NOT produce opportunity signals — it refines what the
 * radar already knows.
 */

import type { RadarIntent } from "../schemas/intent.js"
import type { KnowledgeBrief } from "../state/knowledge-brief.js"
import type { KnowledgeBase, KnowledgeBaseEntry } from "../state/knowledge-base.js"
import type { KnowledgePack } from "../state/knowledge-pack.js"
import type { SearchContext } from "../state/search-context.js"
import type { MeetingCharter } from "../state/meeting-charter.js"
import { SourceRegistry } from "../registry/source-registry.js"
import { getSourceWorkflowType } from "../registry/source-taxonomy.js"
import { JiraMAAdapter } from "../adapters/jira-ma-adapter.js"
import { ConfluenceAdapter } from "../adapters/confluence-adapter.js"
import { KnowledgePackStore } from "../state/knowledge-pack-store.js"
import { KnowledgeBaseStore } from "../state/knowledge-base-store.js"
import { RunContextStore } from "../state/run-context-store.js"
import { summarizeSearchContext } from "../state/context-summary.js"
import { summarizeKnowledgeBase } from "../state/context-summary.js"
import { summarizeKnowledgePack } from "../state/context-summary.js"
import { summarizeMeetingCharter } from "../state/context-summary.js"
import { summarizeKnowledgeBrief } from "../state/context-summary.js"

export interface KnowledgeWorkflowResult {
  cycleId: string
  sourcesPolled: string[]
  knowledgeBaseUpdated: boolean
  candidatePackId: string
  entriesInspected: number
  newEntriesCount: number
  totalKbEntries: number
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}`
}

function inferSourceId(name: string): string {
  if (name.includes("jira")) return "jira-ma"
  if (name.includes("confluence")) return "confluence"
  return name
}

async function pollKnowledgeSource(sourceName: string, intentId: string): Promise<Array<{ title: string; body: string; source: string }>> {
  try {
    // Use SourceRegistry if available, otherwise instantiate known adapters directly
    let adapter: InstanceType<typeof JiraMAAdapter> | InstanceType<typeof ConfluenceAdapter> | null = null

    if (sourceName === "jira-ma" || sourceName.includes("jira")) {
      adapter = new JiraMAAdapter()
    } else if (sourceName === "confluence") {
      adapter = new ConfluenceAdapter()
    } else {
      // Try SourceRegistry for other knowledge sources
      const sourceAdapter = await SourceRegistry.get(sourceName)
      if (!sourceAdapter) return []
      const raw = await sourceAdapter.poll()
      return raw.map((r: any) => ({
        title: r.title ?? "(no title)",
        body: r.body ?? r.description ?? "",
        source: sourceName,
      }))
    }

    if (!adapter) return []
    await adapter.connect()
    const raw = await adapter.poll()
    await adapter.disconnect()

    return raw.map((r: any) => ({
      title: r.title ?? r.summary ?? "(no title)",
      body: r.body ?? r.description ?? "",
      source: inferSourceId(sourceName),
    }))
  } catch (err) {
    console.warn(`  [KnowledgeWorkflow] Failed to poll ${sourceName}: ${err}`)
    return []
  }
}

function extractKnowledgeEntries(
  items: Array<{ title: string; body: string; source: string }>,
  suppressionTerms: string[],
  focusKeywords: string[],
): KnowledgeBaseEntry[] {
  const entries: KnowledgeBaseEntry[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const text = `${item.title} ${item.body}`.toLowerCase()
    if (suppressionTerms.some(t => text.includes(t))) continue

    // Dedupe by title
    const key = item.title.toLowerCase().trim()
    if (seen.has(key) || key.length < 5) continue
    seen.add(key)

    const kind: KnowledgeBaseEntry["kind"] = item.body.includes("constraint") || item.body.includes("must")
      ? "constraint"
      : item.body.includes("decision") || item.body.includes("decided")
      ? "decision"
      : item.body.includes("taxonomy") || item.body.includes("classification")
      ? "taxonomy"
      : "fact"

    entries.push({
      title: item.title.trim().slice(0, 120),
      kind,
      summary: item.body.trim().slice(0, 300),
      sourceIds: [item.source],
    })
  }

  // Sort by focus relevance (highest first), then return all
  if (focusKeywords.length > 0) {
    entries.sort((a, b) => {
      const aText = `${a.title} ${a.summary}`.toLowerCase()
      const bText = `${b.title} ${b.summary}`.toLowerCase()
      const aScore = focusKeywords.filter(kw => aText.includes(kw.toLowerCase())).length
      const bScore = focusKeywords.filter(kw => bText.includes(kw.toLowerCase())).length
      return bScore - aScore
    })
  }

  return entries
}

function buildCandidatePack(
  intentId: string,
  existingPack: KnowledgePack | null,
  newEntries: KnowledgeBaseEntry[],
  distillationMode: "conservative" | "balanced" | "aggressive",
  explorationQuestions: string[],
): KnowledgePack {
  // Build a summary of the new entries for the candidate pack
  const newEntrySummaries = newEntries.map(e => `[${e.kind}] ${e.title}: ${e.summary.slice(0, 100)}`).join("\n")

  // distillationMode controls how much existing product knowledge carries forward
  const keepCapabilities = distillationMode !== "conservative"
  const keepLimitations = distillationMode === "aggressive"
  const keepHeuristics = distillationMode === "aggressive"

  const capabilities = keepCapabilities
    ? (existingPack?.productCapabilities ?? [])
    : []
  const limitations = keepLimitations
    ? (existingPack?.knownLimitations ?? [])
    : []
  const heuristics = keepHeuristics
    ? (existingPack?.opportunityHeuristics ?? [])
    : []

  const questionsSection = explorationQuestions.length > 0
    ? `\nExploration questions:\n${explorationQuestions.map(q => `  • ${q}`).join("\n")}`
    : ""

  const notes = newEntrySummaries
    ? `Distilled from Knowledge Run (mode=${distillationMode}):${questionsSection}\n\nEntry summaries:\n${newEntrySummaries}`
    : `Candidate pack from Knowledge Run (mode=${distillationMode}).${questionsSection}\n\nNo new entries extracted.`

  return {
    id: makeId("candidate-kpack"),
    intentId,
    productCapabilities: capabilities,
    knownLimitations: limitations,
    supportTaxonomy: existingPack?.supportTaxonomy ?? [],
    verticalContext: existingPack?.verticalContext ?? "",
    opportunityHeuristics: heuristics,
    knowledgeNotes: notes,
    status: "candidate",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export async function runKnowledgeWorkflow(options: {
  intent: RadarIntent
  dataDir: string
  configDir: string
  knowledgeBrief?: KnowledgeBrief
  knowledgeBase?: KnowledgeBase
  knowledgePack?: KnowledgePack | null
  runContextStore?: RunContextStore
  meetingCharter?: MeetingCharter
  searchContext?: SearchContext
}): Promise<KnowledgeWorkflowResult> {
  const { intent, knowledgeBrief, knowledgeBase, knowledgePack } = options
  const cycleId = `knowledge-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`

  console.log(`\n=== KNOWLEDGE WORKFLOW | cycle=${cycleId} | intent=${intent.id} ===\n`)

  // Use Knowledge Brief source priorities to determine which sources to explore
  const briefPriorities = knowledgeBrief?.knowledgeSourcePriorities ?? []
  const allConfiguredSources = intent.sourcePriority ?? []
  const knowledgeSourceNames = allConfiguredSources
    .filter(name => getSourceWorkflowType(name) === "knowledge_source")

  // Sort by Knowledge Brief priority (high first), then by configured order
  const sourcePriority = new Map(briefPriorities.map(p => [p.sourceId, p.priority]))
  const sortedSources = [...knowledgeSourceNames].sort((a, b) => {
    const pa = sourcePriority.get(a) ?? "medium"
    const pb = sourcePriority.get(b) ?? "medium"
    const order = { high: 0, medium: 1, low: 2 }
    return (order[pa] ?? 1) - (order[pb] ?? 1)
  })

  console.log(`[KnowledgeWorkflow] Sources (by Knowledge Brief priority): ${sortedSources.join(", ") || "(none)"}`)
  if (knowledgeBrief?.explorationFocus) {
    console.log(`[KnowledgeWorkflow] Exploration focus: ${knowledgeBrief.explorationFocus}`)
  }

  // Derive focus keywords for entry scoring
  const focusKeywords = (knowledgeBrief?.explorationFocus ?? "")
    .split(/[,\s]+/)
    .map(k => k.toLowerCase().trim())
    .filter(k => k.length > 2)

  // Poll each knowledge source
  const allItems: Array<{ title: string; body: string; source: string }> = []
  for (const sourceName of sortedSources) {
    const items = await pollKnowledgeSource(sourceName, intent.id)
    console.log(`  [${sourceName}] polled ${items.length} items`)
    allItems.push(...items)
  }

  // Extract entries, respecting Knowledge Brief suppressions and focus scoring
  const suppressions = knowledgeBrief?.suppressions ?? []
  const newEntries = extractKnowledgeEntries(allItems, suppressions, focusKeywords)
  console.log(`[KnowledgeWorkflow] Extracted ${newEntries.length} entries after suppressions (focus matched entries sorted first)\n`)

  // Merge new entries into existing Knowledge Base
  const kbStore = new KnowledgeBaseStore(options.configDir)
  const existingEntries = new Map(
    (knowledgeBase?.entries ?? []).map(e => [e.title.toLowerCase(), e])
  )
  let addedCount = 0
  for (const entry of newEntries) {
    const key = entry.title.toLowerCase()
    if (!existingEntries.has(key)) {
      existingEntries.set(key, entry)
      addedCount++
    }
  }
  const updatedKnowledgeBase: KnowledgeBase = {
    id: knowledgeBase?.id ?? `${intent.id}-knowledge-base`,
    intentId: intent.id,
    sourceIds: sortedSources.length > 0 ? sortedSources : (knowledgeBase?.sourceIds ?? []),
    summary: knowledgeBase?.summary ??
      `Inward knowledge for ${intent.id}. Updated ${new Date().toISOString().slice(0, 10)}.`,
    entries: [...existingEntries.values()],
    createdAt: knowledgeBase?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  kbStore.save(intent.id, updatedKnowledgeBase)
  console.log(`[KnowledgeWorkflow] Knowledge Base updated: ${updatedKnowledgeBase.entries.length} total entries (${addedCount} new)`)

  // Build candidate pack — derived from updated KB and distillation mode
  const distillationMode = knowledgeBrief?.distillationMode ?? "balanced"
  const explorationQuestions = knowledgeBrief?.explorationQuestions.map(q => q.question) ?? []
  const candidatePack = buildCandidatePack(
    intent.id,
    knowledgePack ?? null,
    newEntries,
    distillationMode,
    explorationQuestions,
  )
  console.log(`[KnowledgeWorkflow] Candidate pack: ${candidatePack.id} (status=candidate, distillation=${distillationMode})`)

  // Save candidate pack
  const packStore = new KnowledgePackStore(options.configDir)
  packStore.save(candidatePack.id, candidatePack)
  console.log(`[KnowledgeWorkflow] Candidate pack saved`)
  console.log(`  Accept with: /tell pack accept ${candidatePack.id}\n`)

  // Persist a real RunContext snapshot for explainability
  if (options.runContextStore) {
    const ctx = {
      cycleId,
      timestamp: new Date().toISOString(),
      intentId: intent.id,
      runType: "knowledge" as const,
      searchContext: options.searchContext ? summarizeSearchContext(options.searchContext) : {},
      knowledgeBase: summarizeKnowledgeBase(updatedKnowledgeBase),
      knowledgePack: summarizeKnowledgePack(candidatePack),
      meetingCharter: options.meetingCharter ? summarizeMeetingCharter(options.meetingCharter) : {},
      knowledgeBrief: knowledgeBrief ? summarizeKnowledgeBrief(knowledgeBrief) : {},
      pipelineStats: {
        ingested: allItems.length,
        scored: newEntries.length,
        qualified: 0,
        enqueuedForTriage: 0,
        approved: 0,
        rejected: 0,
        deferred: 0,
        themes: 0,
        opportunities: 0,
      },
    }
    options.runContextStore.save(ctx)
    console.log(`[KnowledgeWorkflow] RunContext saved: ${cycleId}`)
  }

  return {
    cycleId,
    sourcesPolled: sortedSources,
    knowledgeBaseUpdated: addedCount > 0,
    candidatePackId: candidatePack.id,
    entriesInspected: allItems.length,
    newEntriesCount: addedCount,
    totalKbEntries: updatedKnowledgeBase.entries.length,
  }
}
