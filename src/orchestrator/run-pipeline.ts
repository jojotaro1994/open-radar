/**
 * run-pipeline.ts — shared pipeline core.
 *
 * Current runtime inputs:
 *   RadarIntent    — the authoritative persistent intent for this run
 *   ActiveStrategy — optional session overlay (transitional; NOT the main model)
 *
 * ActiveStrategy is applied as a compatibility overlay only (source pause,
 * relevance threshold override, focus narrowing). The authoritative long-lived
 * inputs (Search Context, Knowledge Pack, Meeting Charter) are not yet wired
 * as runtime parameters — see design.md for the target object model.
 *
 * Callers pass strategy as-is; they never need to pre-apply it.
 */

import * as path from "path"
import * as fs from "fs"
import type { RadarIntent } from "../schemas/intent.js"
import type { ActiveStrategy } from "../state/active-strategy.js"

export interface PipelineOptions {
  intent: RadarIntent
  dataDir: string
  strategy?: ActiveStrategy        // session overlays; standalone runner does not pass this
  useCommercialAnalyst?: boolean
}

export interface PipelineResult {
  cycleId: string
  sourceCounts: Record<string, number>
  ingested: number
  scored: number
  qualifiedCount: number         // count after addQualification (before focus narrowing)
  enqueuedForTriage: number      // count enqueued into ReviewQueue (after focus narrowing)
  approved: number               // approved in this cycleId only
  rejected: number               // rejected in this cycleId only
  deferred: number               // deferred in this cycleId only
  themes: number
  opportunities: number
}

// ── Minimal triage (heuristic fallback) ──────────────────────────────────────
type TriageDecision = "approved" | "rejected" | "deferred"

async function triage(signal: any): Promise<{ decision: TriageDecision; reason: string }> {
  const title = (signal.title ?? "").trim()
  const body = (signal.body ?? "").trim()
  const text = `${title} ${body}`.toLowerCase()
  const score = signal.relevanceScore ?? 0.5

  if (title.length < 12) return { decision: "rejected", reason: "Title too short" }
  if (text.includes("announcing") || text.includes("release notes")) return { decision: "rejected", reason: "Announcement" }
  if (text.includes("dark mode") || text.includes("meme") || text.includes("lol")) return { decision: "rejected", reason: "Noise" }

  const hasBenefit = body.includes("would help") || body.includes("would be nice") || body.includes("should support") || body.includes("want") || body.includes("need")
  const hasSubstantive = body.length > 30

  if (score > 0.6 && hasBenefit && hasSubstantive) return { decision: "approved", reason: "Feature request with benefit language" }
  if (score > 0.5 && body.length > 50) return { decision: "approved", reason: "Above-threshold signal" }
  if (score > 0.65 && hasBenefit) return { decision: "approved", reason: "High-score feature request" }
  return { decision: "deferred", reason: "Below threshold" }
}

async function triageWithCommercialAnalyst(
  signals: any[],
  scored: any[],
  intent: any,
  cycleId: string
): Promise<Map<string, { decision: TriageDecision; reason: string; assessment: any }>> {
  const { CommercialAnalyst } = await import("../agents/commercial-analyst.js")
  const analyst = new CommercialAnalyst()

  console.log(`[CommercialAnalyst] Assessing ${signals.length} signals with LLM...`)

  const toAssess = signals.filter((s: any) => {
    const q = s.qualification?.qualification
    return q !== "bug" && q !== "noise"
  })

  console.log(`[CommercialAnalyst] ${toAssess.length} signals pass first-pass filter (non-bug, non-noise)`)

  const assessments = await analyst.batchAssess(toAssess, intent)

  const results = new Map<string, { decision: TriageDecision; reason: string; assessment: any }>()

  for (const signal of signals) {
    const assessment = assessments.find((a: any) => a.signalId === signal.id)
    if (!assessment) {
      results.set(signal.id, {
        decision: "rejected",
        reason: `Rule-based qualification: ${signal.qualification?.qualification ?? "unknown"}`,
        assessment: null,
      })
      continue
    }

    const decision: TriageDecision = assessment.commercialRelevance
      ? (assessment.confidence >= 0.5 ? "approved" : "deferred")
      : "rejected"

    const reason = `[${assessment.category}] ${assessment.reasoning}`.slice(0, 200)

    results.set(signal.id, { decision, reason, assessment })

    const scoredSignal = scored.find((s: any) => s.id === signal.id)
    if (scoredSignal) {
      ;(scoredSignal as any).commercialAssessment = assessment
    }
  }

  return results
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// Private helper: build searchable text for focus matching
function buildSearchableText(sig: any): string {
  const tags = (sig.tags ?? []).join(" ")
  return `${sig.title ?? ""} ${sig.body ?? ""} ${tags}`.toLowerCase()
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { intent, strategy } = options

  // ThemeEngine / OpportunityAssembly read this env var during dynamic import
  process.env.RADAR_DATA_DIR = options.dataDir

  const cycleId = `riplus-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`
  console.log(`\n=== PIPELINE | cycle=${cycleId} | intent=${intent.id} ===\n`)

  ensureDir(options.dataDir)

  // Import and register adapters
  await import("../registry/register-all.js")
  const { SourceRegistry } = await import("../registry/source-registry.js")

  // sourceBias pause: filter out paused sources before polling
  let adapterNames = SourceRegistry.listForIntent(intent.id, intent.sourcePriority)
  if (strategy?.sourceBias?.action === "pause") {
    adapterNames = adapterNames.filter(n => n !== strategy.sourceBias!.sourceId)
    console.log(`[Strategy] Paused source: ${strategy.sourceBias.sourceId}`)
  }
  console.log(`[Registry] Active adapters for "${intent.id}": ${adapterNames.join(", ")}\n`)

  // Connect all adapters
  const adapters: Map<string, Awaited<ReturnType<typeof SourceRegistry.get>>> = new Map()
  for (const name of adapterNames) {
    const adapter = await SourceRegistry.get(name)
    if (adapter) adapters.set(name, adapter)
  }
  console.log(`[Adapters] Connected: ${adapters.size}/${adapterNames.length}\n`)

  // ── Step 1: Poll all sources ─────────────────────────────────────────────
  console.log("[1] SOURCE INGESTION")
  const allRawSignals: any[] = []
  const sourceCounts: Record<string, number> = {}

  for (const [name, adapter] of adapters) {
    if (!adapter) continue
    try {
      const raw = await adapter.poll()
      sourceCounts[name] = raw.length
      allRawSignals.push(...raw)
      console.log(`  [${name}] polled ${raw.length} signals`)
    } catch (err) {
      console.warn(`  [${name}] poll error: ${err}`)
      sourceCounts[name] = 0
    }
  }
  console.log(`  TOTAL: ${allRawSignals.length} signals\n`)

  if (allRawSignals.length === 0) {
    console.log("=== NO SIGNALS — ABORTING ===")
    return {
      cycleId, sourceCounts,
      ingested: 0, scored: 0, qualifiedCount: 0, enqueuedForTriage: 0,
      approved: 0, rejected: 0, deferred: 0,
      themes: 0, opportunities: 0,
    }
  }

  // ── Step 2: Normalize ──────────────────────────────────────────────────
  console.log("[2] NORMALIZATION")
  ensureDir(path.join(options.dataDir, "normalized-signals"))
  const normalized: any[] = []

  for (const raw of allRawSignals) {
    const adapter = adapters.get(raw.sourceId)
    if (!adapter) {
      console.warn(`  No adapter for sourceId=${raw.sourceId}, skipping`)
      continue
    }
    const norm = adapter.normalize(raw)
    norm.attribution = { intentId: intent.id, sourceAdapterId: raw.sourceId, modelId: "adapter-only", analyzedAt: new Date().toISOString() }
    normalized.push(norm)
    fs.writeFileSync(path.join(options.dataDir, "normalized-signals", `${norm.id}.json`), JSON.stringify(norm, null, 2))
  }
  console.log(`  Normalized: ${normalized.length}\n`)

  // ── Step 3: Save raw signals ───────────────────────────────────────────
  ensureDir(path.join(options.dataDir, "raw-signals"))
  for (const raw of allRawSignals) {
    fs.writeFileSync(path.join(options.dataDir, "raw-signals", `${raw.id}.json`), JSON.stringify(raw, null, 2))
  }

  // ── Step 4: Augment ────────────────────────────────────────────────────
  console.log("[3] AGENT AUGMENTATION (OpenRouter)")
  const { augment } = await import("../filters/agent-filter.js")
  const scored = augment(normalized, cycleId)
  ensureDir(path.join(options.dataDir, "scored-signals"))
  for (const sig of scored) {
    fs.writeFileSync(path.join(options.dataDir, "scored-signals", `${sig.id}.json`), JSON.stringify(sig, null, 2))
  }
  console.log(`  Scored: ${scored.length}`)

  const modelAttr = scored[0]?.attribution?.modelId ?? "unknown"
  console.log(`  Attribution modelId: ${modelAttr}\n`)

  // ── Step 5: Qualification ──────────────────────────────────────────────
  console.log("[4] QUALIFICATION FILTER")
  // relevanceThreshold overlay: clone intent with overridden minRelevanceScore
  const effectiveIntent = strategy?.relevanceThreshold != null
    ? {
        ...intent,
        commercialCriteria: {
          ...intent.commercialCriteria,
          minRelevanceScore: strategy.relevanceThreshold,
        },
      }
    : intent
  const { addQualification } = await import("../filters/qualification-filter.js")
  const qualified = addQualification(scored, effectiveIntent)
  const qualCounts: Record<string, number> = {}
  for (const sig of qualified) {
    const q = sig.qualification?.qualification ?? "unknown"
    qualCounts[q] = (qualCounts[q] ?? 0) + 1
  }
  console.log(`  Summary: ${JSON.stringify(qualCounts)}\n`)

  // ── Step 5b: Commercial Analyst (LLM) ─────────────────────────────────
  const triageResults = options.useCommercialAnalyst
    ? await triageWithCommercialAnalyst(qualified, scored, intent, cycleId)
    : null

  // ── Step 5c: Focus narrowing (post-qualification) ──────────────────────
  // Does NOT affect ingestion/scoring/qualification counts.
  // Affects: triage queue, theme clustering, opportunity assembly.
  let qualifiedForTriage = qualified
  if (strategy?.focus) {
    const term = strategy.focus.toLowerCase()
    qualifiedForTriage = qualified.filter(sig => buildSearchableText(sig).includes(term))
    console.log(`[Strategy focus="${strategy.focus}"] post-qualification narrowing: ${qualified.length} → ${qualifiedForTriage.length}`)
  }

  // ── Step 6: Triage ────────────────────────────────────────────────────
  console.log("[5] TRIAGE")
  const reviewQueueModule = await import("../engine/review-queue.js")
  const ReviewQueue = reviewQueueModule.ReviewQueue
  const reviewQueue = new ReviewQueue(options.dataDir)
  await reviewQueue.enqueueAll(qualifiedForTriage, cycleId)

  const pending = await reviewQueue.getPending()
  for (const item of pending) {
    const signal = qualifiedForTriage.find((s: any) => s.id === item.signalId)
    if (!signal) continue

    let decision: TriageDecision
    let reason: string

    if (triageResults) {
      const result = triageResults.get(signal.id)
      decision = result?.decision ?? "deferred"
      reason = result?.reason ?? "No assessment available"
    } else {
      const r = await triage(signal)
      decision = r.decision
      reason = r.reason
    }

    await reviewQueue.triage(item.signalId, decision, "riplus-ma-agent", reason)
  }

  const approvedItems = await reviewQueue.getApproved(cycleId)
  const rejectedItems = await reviewQueue.getRejected(cycleId)
  const deferredItems = await reviewQueue.getDeferred(cycleId)

  if (triageResults) {
    const byCategory: Record<string, number> = {}
    const byVertical: Record<string, number> = {}
    let approvedWithLLM = 0
    for (const [, result] of triageResults) {
      if (result.assessment) {
        const cat = result.assessment.category
        byCategory[cat] = (byCategory[cat] ?? 0) + 1
        for (const v of result.assessment.verticalTags ?? []) {
          byVertical[v] = (byVertical[v] ?? 0) + 1
        }
        if (result.decision === "approved") approvedWithLLM++
      }
    }
    console.log(`  [Commercial Analyst] Approved=${approvedWithLLM} | By category: ${JSON.stringify(byCategory)} | By vertical: ${JSON.stringify(byVertical)}`)
  }

  console.log(`  Approved=${approvedItems.length} Rejected=${rejectedItems.length} Deferred=${deferredItems.length}\n`)

  // ── Step 7: Theme clustering ──────────────────────────────────────────
  console.log("[6] THEME CLUSTERING")
  const { ThemeEngine } = await import("../engine/theme-engine.js")
  const { OpportunityAssembly } = await import("../engine/opportunity-assembly.js")
  const { EventBus } = await import("../infrastructure/event-bus.js")
  const eventBus = new EventBus()
  const themeEngine = new ThemeEngine()
  const oppAssembly = new OpportunityAssembly(eventBus)

  const approvedSignals = approvedItems.map((item: any) => scored.find((s: any) => s.id === item.signalId)).filter((s: any): s is any => !!s)
  const themes = themeEngine.cluster(approvedSignals, cycleId)
  console.log(`  Themes: ${themes.length}\n`)

  // ── Step 8: Opportunity assembly ──────────────────────────────────────
  console.log("[7] OPPORTUNITY ASSEMBLY")
  const opportunities = await oppAssembly.assemble(themes, intent.id)
  ensureDir(path.join(options.dataDir, "opportunities"))
  for (const opp of opportunities) {
    fs.writeFileSync(path.join(options.dataDir, "opportunities", `${opp.id}.json`), JSON.stringify(opp, null, 2))
    opp.attribution = { intentId: intent.id, sourceAdapterId: "pipeline", modelId: modelAttr, analyzedAt: new Date().toISOString() }
  }
  console.log(`  Opportunities: ${opportunities.length}\n`)

  // ── Step 9: Prototype briefs ──────────────────────────────────────────
  console.log("[8] PROTOTYPE BRIEFS")
  const { PrototypeBriefConsumer } = await import("../consumers/prototype-brief.js")
  const { StorageHelper } = await import("../infrastructure/storage-helper.js")
  const storage = new StorageHelper(options.dataDir)
  const protoBrief = new PrototypeBriefConsumer(eventBus, storage)
  ensureDir(path.join(options.dataDir, "briefs", "prototype"))

  for (const opp of opportunities) {
    try {
      await protoBrief.process("opportunity.created", {
        opportunityId: opp.id,
        productContext: intent.productContext,
        intentId: intent.id,
        sourceAdapterId: opp.attribution?.sourceAdapterId ?? "pipeline",
      })
    } catch (err) {
      console.warn(`  Brief generation error for ${opp.id}: ${err}`)
    }
  }

  return {
    cycleId,
    sourceCounts,
    ingested: allRawSignals.length,
    scored: scored.length,
    qualifiedCount: qualified.length,
    enqueuedForTriage: qualifiedForTriage.length,
    approved: approvedItems.length,
    rejected: rejectedItems.length,
    deferred: deferredItems.length,
    themes: themes.length,
    opportunities: opportunities.length,
  }
}
