/**
 * state-printer.ts — formats the /state output.
 *
 * Five-object state model:
 *   Current Intent   — persistent: what the radar is looking for and why
 *   Search Context   — persistent: how to search, source weights, topic boosts/suppressions
 *   Knowledge Pack   — persistent: what the system knows about the business world
 *   Meeting Charter  — persistent: how to discuss, frame judgment, required questions
 *   Last Run         — read-only: summary of most recent /run
 *
 * Active Strategy (session patches) is a transitional compatibility overlay only.
 * It is displayed subordinate to the five persistent objects.
 */

import type { RadarIntent } from "../schemas/intent.js"
import type { ActiveStrategy } from "./active-strategy.js"
import type { LastRunSummary } from "./last-run.js"
import type { SearchContextSummary } from "./search-context.js"
import type { KnowledgePackSummary } from "./knowledge-pack.js"
import type { MeetingCharterSummary } from "./meeting-charter.js"
import { inferDefaultSourceRole } from "./source-role.js"

export type { SearchContextSummary, KnowledgePackSummary, MeetingCharterSummary }

export function printState(
  intent: RadarIntent,
  strategy: ActiveStrategy,
  lastRun: LastRunSummary | null,
  searchContext: SearchContextSummary = {},
  knowledgePack: KnowledgePackSummary = {},
  meetingCharter: MeetingCharterSummary = {}
): void {
  // ── Current Intent ────────────────────────────────────────────────────────
  console.log("\n═══ Current Intent ═══")
  console.log(`Name:    ${intent.name}`)
  if (intent.goalStatement) {
    console.log(`Goal:    ${intent.goalStatement}`)
  }

  console.log("\n── Sources ──")
  const sources = intent.sourcePriority ?? []
  for (const s of sources) {
    console.log(`  ${s.padEnd(28)} ${inferDefaultSourceRole(s)}`)
  }

  console.log("\n── Commercial Focus ──")
  const cc = intent.commercialCriteria
  if (cc.includeTags?.length) console.log(`  Include: ${cc.includeTags.join(", ")}`)
  if (cc.excludeTags?.length) console.log(`  Exclude: ${cc.excludeTags.join(", ")}`)
  if (cc.minRelevanceScore != null) console.log(`  Min relevance: ${cc.minRelevanceScore}`)

  // ── Search Context ────────────────────────────────────────────────────────
  console.log("\n═══ Search Context ═══")
  if (searchContext.sourceWeights && Object.keys(searchContext.sourceWeights).length > 0) {
    for (const [src, w] of Object.entries(searchContext.sourceWeights)) {
      console.log(`  ${src.padEnd(28)} weight=${w}`)
    }
  }
  if (searchContext.topicBoosts?.length) console.log(`  Boosts:  ${searchContext.topicBoosts.join(", ")}`)
  if (searchContext.topicSuppressions?.length) console.log(`  Suppressed: ${searchContext.topicSuppressions.join(", ")}`)
  if (searchContext.recallMode) console.log(`  Recall mode: ${searchContext.recallMode}`)
  const hasSearchContext = (searchContext.sourceWeights && Object.keys(searchContext.sourceWeights).length > 0)
    || (searchContext.topicBoosts?.length) || (searchContext.topicSuppressions?.length) || searchContext.recallMode
  if (!hasSearchContext) console.log("  (not yet configured)")

  // ── Knowledge Pack ───────────────────────────────────────────────────────
  console.log("\n═══ Knowledge Pack ═══")
  if (knowledgePack.productCapabilities?.length) {
    console.log(`  Product capabilities:`)
    for (const c of knowledgePack.productCapabilities) console.log(`    - ${c}`)
  }
  if (knowledgePack.knownLimitations?.length) {
    console.log(`  Known limitations:`)
    for (const l of knowledgePack.knownLimitations) console.log(`    - ${l}`)
  }
  if (knowledgePack.verticalContext) console.log(`  Vertical context: ${knowledgePack.verticalContext}`)
  const hasKnowledgePack = (knowledgePack.productCapabilities?.length)
    || (knowledgePack.knownLimitations?.length) || knowledgePack.verticalContext
  if (!hasKnowledgePack) console.log("  (not yet configured)")

  // ── Meeting Charter ───────────────────────────────────────────────────────
  console.log("\n═══ Meeting Charter ═══")
  if (meetingCharter.objective) console.log(`  Objective: ${meetingCharter.objective}`)
  if (meetingCharter.primaryLens) console.log(`  Primary lens: ${meetingCharter.primaryLens}`)
  if (meetingCharter.requiredQuestions?.length) {
    console.log(`  Required questions:`)
    for (const q of meetingCharter.requiredQuestions) console.log(`    - ${q}`)
  }
  const hasMeetingCharter = meetingCharter.objective || meetingCharter.primaryLens || meetingCharter.requiredQuestions?.length
  if (!hasMeetingCharter) console.log("  (not yet configured)")

  // ── Active Strategy (transitional session overlay — subordinate) ─────────
  console.log("\n── Active Strategy (session overlay) ──")
  if (!strategy.patches.length) {
    console.log("  (no session patches)")
  } else {
    if (strategy.focus !== undefined) {
      console.log(`  Focus:              ${String(strategy.focus).padEnd(22)} ← session`)
    }
    if (strategy.relevanceThreshold !== undefined) {
      console.log(`  Relevance override: ${String(strategy.relevanceThreshold).padEnd(22)} ← session`)
    }
    if (strategy.sourceBias !== undefined) {
      const b = strategy.sourceBias
      console.log(`  Source bias:        ${`${b.action} ${b.sourceId}`.padEnd(22)} ← session`)
    }

    console.log("\n  Session patches:")
    for (const p of strategy.patches) {
      const valStr = typeof p.value === "object" ? JSON.stringify(p.value) : JSON.stringify(p.value)
      console.log(`    #${p.seq}  ${p.field} → ${valStr.padEnd(20)}  "${p.trigger}"`)
    }
  }

  // ── Last Run ──────────────────────────────────────────────────────────────
  console.log("\n═══ Last Run ═══")
  if (!lastRun) {
    console.log("  (no run in this session)")
  } else {
    const d = new Date(lastRun.timestamp)
    const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    console.log(`  ${ts}`)
    const contextCount = lastRun.sources.filter(s => s.role === "context").length
    const directCount = lastRun.sources.filter(s => s.role === "direct_signal").length
    console.log(`  Sources polled: ${lastRun.sources.length} (${contextCount} context, ${directCount} direct_signal)`)
    const p = lastRun.pipeline
    console.log(`  Signals: ${p.ingested} ingested → ${p.scored} scored → ${p.qualified} qualified`)
    console.log(`  Enqueued for triage: ${p.enqueuedForTriage}`)
  }

  console.log("")
}
