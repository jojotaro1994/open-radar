/**
 * state-printer.ts — formats the /state output.
 *
 * Current 4-control-surface + 2-run model:
 *   Intent          — what the radar is trying to discover over time
 *   Scout Brief     — how the scout searches / weights / suppresses (outward radar lane)
 *   Knowledge Brief — how the inward knowledge exploration is directed (inward knowledge lane)
 *   Meeting Goal    — how the BA meeting room frames judgment
 *   Knowledge Base  — inward durable knowledge layer
 *   Knowledge Pack  — distilled working knowledge for current intent/run
 *   Last Run        — read-only summary of the most recent /run
 */

import type { RadarIntent } from "../schemas/intent.js"
import type { ActiveStrategy } from "./active-strategy.js"
import type { LastRunSummary } from "./last-run.js"
import type { SearchContextSummary } from "./search-context.js"
import type { KnowledgeBaseSummary } from "./knowledge-base.js"
import type { KnowledgePackSummary } from "./knowledge-pack.js"
import type { MeetingCharterSummary } from "./meeting-charter.js"
import type { KnowledgeBriefSummary } from "./knowledge-brief.js"
import { bucketSourcesByWorkflowType } from "../registry/source-taxonomy.js"

export type { SearchContextSummary, KnowledgeBaseSummary, KnowledgePackSummary, MeetingCharterSummary, KnowledgeBriefSummary }

function hasSearchContext(summary: SearchContextSummary): boolean {
  return Boolean(
    (summary.sourceWeights && Object.keys(summary.sourceWeights).length > 0) ||
    summary.topicBoosts?.length ||
    summary.topicSuppressions?.length ||
    summary.recallMode,
  )
}

function hasKnowledgeBase(summary: KnowledgeBaseSummary): boolean {
  return Boolean(summary.sourceIds?.length || summary.entryCount || summary.summary)
}

function hasKnowledgePack(summary: KnowledgePackSummary): boolean {
  return Boolean(summary.productCapabilities?.length || summary.knownLimitations?.length || summary.verticalContext)
}

function hasMeetingGoal(summary: MeetingCharterSummary): boolean {
  return Boolean(summary.objective || summary.primaryLens || summary.requiredQuestions?.length)
}

function hasKnowledgeBrief(summary: KnowledgeBriefSummary): boolean {
  return Boolean(summary.explorationFocus || summary.explorationQuestions?.length || summary.distillationMode)
}

export function printState(
  intent: RadarIntent,
  strategy: ActiveStrategy,
  lastRun: LastRunSummary | null,
  searchContext: SearchContextSummary = {},
  knowledgeBase: KnowledgeBaseSummary = {},
  knowledgePack: KnowledgePackSummary = {},
  meetingCharter: MeetingCharterSummary = {},
  knowledgeBrief: KnowledgeBriefSummary = {},
  /** If provided, this is the accepted pack (separate from the last-run pack, e.g. a candidate). */
  acceptedPack?: KnowledgePackSummary,
): void {
  console.log("\n═══ Intent ═══")
  console.log(`  ${intent.id}`)
  if (intent.goalStatement) console.log(`  Goal: ${intent.goalStatement}`)

  const buckets = bucketSourcesByWorkflowType(intent.sourcePriority ?? [])
  if (buckets.opportunity.length) {
    console.log("\n  Opportunity sources:")
    for (const source of buckets.opportunity) console.log(`    - ${source}`)
  }
  if (buckets.dualUse.length) {
    console.log("\n  Dual-use sources:")
    for (const source of buckets.dualUse) console.log(`    - ${source}`)
  }
  if (buckets.knowledge.length) {
    console.log("\n  Knowledge sources:")
    for (const source of buckets.knowledge) console.log(`    - ${source}`)
  }

  const commercialCriteria = intent.commercialCriteria
  if (commercialCriteria.includeTags?.length || commercialCriteria.excludeTags?.length || commercialCriteria.minRelevanceScore != null) {
    console.log("\n  Commercial focus:")
    if (commercialCriteria.includeTags?.length) console.log(`    Include: ${commercialCriteria.includeTags.join(", ")}`)
    if (commercialCriteria.excludeTags?.length) console.log(`    Exclude: ${commercialCriteria.excludeTags.join(", ")}`)
    if (commercialCriteria.minRelevanceScore != null) console.log(`    Min relevance: ${commercialCriteria.minRelevanceScore}`)
  }

  console.log("\n═══ Scout Brief ═══")
  if (searchContext.sourceWeights && Object.keys(searchContext.sourceWeights).length > 0) {
    console.log("  Source weights:")
    for (const [sourceId, weight] of Object.entries(searchContext.sourceWeights)) {
      console.log(`    - ${sourceId} = ${weight}`)
    }
  }
  if (searchContext.topicBoosts?.length) console.log(`  Boosts: ${searchContext.topicBoosts.join(", ")}`)
  if (searchContext.topicSuppressions?.length) console.log(`  Suppressed: ${searchContext.topicSuppressions.join(", ")}`)
  if (searchContext.recallMode) console.log(`  Recall mode: ${searchContext.recallMode}`)
  if (!hasSearchContext(searchContext)) console.log("  (not yet configured)")

  console.log("\n═══ Knowledge Brief ═══")
  if (knowledgeBrief.explorationFocus) console.log(`  Focus: ${knowledgeBrief.explorationFocus}`)
  if (knowledgeBrief.explorationQuestions?.length) {
    console.log("  Exploration questions:")
    for (const q of knowledgeBrief.explorationQuestions) console.log(`    - ${q}`)
  }
  if (knowledgeBrief.knowledgeSourcePriorities && Object.keys(knowledgeBrief.knowledgeSourcePriorities).length > 0) {
    console.log("  Knowledge source priorities:")
    for (const [sourceId, priority] of Object.entries(knowledgeBrief.knowledgeSourcePriorities)) {
      console.log(`    - ${sourceId} = ${priority}`)
    }
  }
  if (knowledgeBrief.distillationMode) console.log(`  Distillation: ${knowledgeBrief.distillationMode}`)
  if (knowledgeBrief.suppressions?.length) console.log(`  Suppressions: ${knowledgeBrief.suppressions.join(", ")}`)
  if (knowledgeBrief.explorationNotes) console.log(`  Notes: ${knowledgeBrief.explorationNotes}`)
  if (!hasKnowledgeBrief(knowledgeBrief)) console.log("  (not yet configured)")

  console.log("\n═══ Knowledge Base ═══")
  if (knowledgeBase.sourceIds?.length) console.log(`  Sources: ${knowledgeBase.sourceIds.join(", ")}`)
  if (knowledgeBase.entryCount != null) console.log(`  Curated entries: ${knowledgeBase.entryCount}`)
  if (knowledgeBase.summary) console.log(`  Summary: ${knowledgeBase.summary}`)
  if (!hasKnowledgeBase(knowledgeBase)) console.log("  (not yet curated)")

  console.log("\n═══ Knowledge Pack ═══")
  // When last run produced a candidate pack AND there is also an accepted pack,
  // show both: the candidate is what the last run produced, the accepted is what Radar Run will use.
  if (knowledgePack.status === "candidate" && acceptedPack && acceptedPack.status === "accepted") {
    console.log(`  Candidate from last Knowledge Run:`)
    console.log(`    Status: candidate  ← not yet accepted`)
    console.log(`    → Accept with: /tell pack accept <id>`)
    if (knowledgePack.verticalContext) console.log(`    ${knowledgePack.verticalContext.slice(0, 80)}...`)
    console.log(``)
    console.log(`  Accepted (active for next Radar Run):`)
    console.log(`    Status: accepted  ← next Radar Run will use this by default`)
    if (acceptedPack.productCapabilities?.length) {
      console.log(`    Product capabilities: ${acceptedPack.productCapabilities.length} items`)
    }
    if (acceptedPack.verticalContext) console.log(`    Vertical context: ${acceptedPack.verticalContext.slice(0, 80)}...`)
  } else if (knowledgePack.status === "accepted") {
    console.log(`  Status: accepted  ← next Radar Run will use this by default`)
    if (knowledgePack.productCapabilities?.length) {
      console.log("  Product capabilities:")
      for (const capability of knowledgePack.productCapabilities) console.log(`    - ${capability}`)
    }
    if (knowledgePack.knownLimitations?.length) {
      console.log("  Known limitations:")
      for (const limitation of knowledgePack.knownLimitations) console.log(`    - ${limitation}`)
    }
    if (knowledgePack.verticalContext) console.log(`  Vertical context: ${knowledgePack.verticalContext}`)
  } else if (knowledgePack.status === "candidate") {
    console.log(`  Status: candidate  ← not yet accepted; use /tell pack accept <id> to accept`)
    if (knowledgePack.productCapabilities?.length) {
      console.log("  Product capabilities:")
      for (const capability of knowledgePack.productCapabilities) console.log(`    - ${capability}`)
    }
    if (knowledgePack.knownLimitations?.length) {
      console.log("  Known limitations:")
      for (const limitation of knowledgePack.knownLimitations) console.log(`    - ${limitation}`)
    }
    if (knowledgePack.verticalContext) console.log(`  Vertical context: ${knowledgePack.verticalContext}`)
  } else if (hasKnowledgePack(knowledgePack)) {
    console.log(`  Status: ${knowledgePack.status ?? "unknown"}`)
    if (knowledgePack.productCapabilities?.length) {
      console.log("  Product capabilities:")
      for (const capability of knowledgePack.productCapabilities) console.log(`    - ${capability}`)
    }
    if (knowledgePack.verticalContext) console.log(`  Vertical context: ${knowledgePack.verticalContext}`)
  }
  if (!hasKnowledgePack(knowledgePack)) console.log("  (not yet configured — Radar Run will proceed without knowledge context)")

  console.log("\n═══ Meeting Goal ═══")
  if (meetingCharter.objective) console.log(`  Objective: ${meetingCharter.objective}`)
  if (meetingCharter.primaryLens) console.log(`  Primary lens: ${meetingCharter.primaryLens}`)
  if (meetingCharter.requiredQuestions?.length) {
    console.log("  Required questions:")
    for (const question of meetingCharter.requiredQuestions) console.log(`    - ${question}`)
  }
  if (!hasMeetingGoal(meetingCharter)) console.log("  (not yet configured)")

  console.log("\n── Active Strategy (session overlay) ──")
  if (!strategy.patches.length) {
    console.log("  (no session patches)")
  } else {
    if (strategy.focus !== undefined) console.log(`  Focus:              ${String(strategy.focus).padEnd(22)} ← session`)
    if (strategy.relevanceThreshold !== undefined) console.log(`  Relevance override: ${String(strategy.relevanceThreshold).padEnd(22)} ← session`)
    if (strategy.sourceBias !== undefined) console.log(`  Source bias:        ${`${strategy.sourceBias.action} ${strategy.sourceBias.sourceId}`.padEnd(22)} ← session`)

    console.log("\n  Session patches:")
    for (const patch of strategy.patches) {
      const value = typeof patch.value === "object" ? JSON.stringify(patch.value) : JSON.stringify(patch.value)
      console.log(`    #${patch.seq}  ${patch.field} → ${value.padEnd(20)}  \"${patch.trigger}\"`)
    }
  }

  console.log("\n═══ Last Run ═══")
  if (!lastRun) {
    console.log("  (no run in this session)")
  } else {
    const date = new Date(lastRun.timestamp)
    const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    const runType = lastRun.runType ?? "radar"
    console.log(`  ${timestamp}  [${runType}]`)

    if (runType === "knowledge") {
      const opportunityCount = lastRun.sources.filter(source => source.sourceType === "opportunity_source").length
      const dualUseCount = lastRun.sources.filter(source => source.sourceType === "dual_use").length
      const knowledgeCount = lastRun.sources.filter(source => source.sourceType === "knowledge_source").length
      console.log(`  Knowledge sources explored: ${lastRun.sources.length} (knowledge=${knowledgeCount}, dual-use=${dualUseCount})`)
      const pipeline = lastRun.pipeline
      console.log(`  Entries inspected: ${pipeline.ingested}  |  New entries: ${pipeline.scored}`)
    } else {
      const opportunityCount = lastRun.sources.filter(source => source.sourceType === "opportunity_source").length
      const dualUseCount = lastRun.sources.filter(source => source.sourceType === "dual_use").length
      const knowledgeCount = lastRun.sources.filter(source => source.sourceType === "knowledge_source").length
      console.log(`  Radar sources polled: ${lastRun.sources.length} (opportunity=${opportunityCount}, dual-use=${dualUseCount}, knowledge=${knowledgeCount})`)
      const pipeline = lastRun.pipeline
      console.log(`  Signals: ${pipeline.ingested} ingested → ${pipeline.scored} scored → ${pipeline.qualified} qualified`)
      console.log(`  Enqueued for triage: ${pipeline.enqueuedForTriage}`)
    }
  }

  console.log("")
}
