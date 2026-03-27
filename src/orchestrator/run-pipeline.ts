/**
 * run-pipeline.ts — shared pipeline core.
 *
 * Runtime inputs (product model names → internal types):
 *   RadarIntent      — authoritative persistent intent
 *   Scout Brief      — how to search (source weights/suppressions); optional  [SearchContext]
 *   KnowledgePack    — what the system knows (opportunity heuristics); optional
 *   Meeting Goal     — how to discuss / frame judgment (primaryLens, requiredQuestions); optional  [MeetingCharter]
 *   ActiveStrategy   — optional session overlay (transitional compatibility)
 *
 * Scout Brief, KnowledgePack, and Meeting Goal are the authoritative long-lived inputs.
 * ActiveStrategy remains for session-level compatibility only.
 *
 * Callers pass strategy as-is; they never need to pre-apply it.
 */

import * as path from "path"
import * as fs from "fs"
import type { RadarIntent } from "../schemas/intent.js"
import type { ActiveStrategy } from "../state/active-strategy.js"
import type { SearchContext } from "../state/search-context.js"
import type { KnowledgePack } from "../state/knowledge-pack.js"
import type { KnowledgeBase } from "../state/knowledge-base.js"
import type { MeetingCharter } from "../state/meeting-charter.js"
import type { KnowledgeBrief } from "../state/knowledge-brief.js"
import { getSourceWorkflowType } from "../registry/source-taxonomy.js"
import { generateScoutPlan } from "../state/scout-commander.js"
import { ScoutPlanStore } from "../state/scout-plan-store.js"
import { RunContextStore } from "../state/run-context-store.js"
import { summarizeSearchContext, summarizeKnowledgeBase } from "../state/context-summary.js"
import { summarizeKnowledgePack } from "../state/context-summary.js"
import { summarizeMeetingCharter } from "../state/context-summary.js"
import { summarizeKnowledgeBrief } from "../state/context-summary.js"
import { MeetingRecordStore } from "../state/meeting-record-store.js"
import { evaluateWithMeetingRoom, evaluateDecisionObjectWithMeetingRoom } from "../state/ba-meeting-room.js"
import { EvidenceStore } from "../state/evidence-store.js"
import { FindingStore } from "../state/finding-store.js"
import { DecisionObjectStore } from "../state/decision-object-store.js"
import type { Evidence } from "../state/evidence.js"
import type { Finding } from "../state/finding.js"
import type { DecisionObject } from "../state/decision-object.js"

export interface PipelineOptions {
  intent: RadarIntent
  dataDir: string
  strategy?: ActiveStrategy        // session overlays; standalone runner does not pass this
  useCommercialAnalyst?: boolean
  searchContext?: SearchContext   // long-lived: how to search
  knowledgeBase?: KnowledgeBase   // long-lived: durable inward knowledge layer
  knowledgePack?: KnowledgePack   // long-lived: what the system knows
  meetingCharter?: MeetingCharter // long-lived: how to discuss / frame judgment
  knowledgeBrief?: KnowledgeBrief // long-lived: how inward knowledge exploration is directed
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

/**
 * Parse a dollar amount string like "$500K" or "$1.2M" into a numeric value in raw dollars.
 * Returns undefined if no dollar amount can be parsed.
 */
function parseDollarAmount(value: string): number | undefined {
  if (!value) return undefined
  // Remove currency symbols and whitespace
  const cleaned = value.replace(/[$,\s]/g, "")
  // Handle K (thousands), M (millions), B (billions)
  const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)K$/i)
  if (kMatch) return parseFloat(kMatch[1]!) * 1_000
  const mMatch = cleaned.match(/^(\d+(?:\.\d+)?)M$/i)
  if (mMatch) return parseFloat(mMatch[1]!) * 1_000_000
  const bMatch = cleaned.match(/^(\d+(?:\.\d+)?)B$/i)
  if (bMatch) return parseFloat(bMatch[1]!) * 1_000_000_000
  // Plain number
  const plain = parseFloat(cleaned)
  if (!isNaN(plain)) return plain
  return undefined
}

async function triageWithCommercialAnalyst(
  signals: any[],
  scored: any[],
  intent: any,
  cycleId: string,
  knowledgePack?: any,
  meetingCharter?: any
): Promise<Map<string, { decision: TriageDecision; reason: string; assessment: any }>> {
  const { CommercialAnalyst } = await import("../agents/commercial-analyst.js")
  const analyst = new CommercialAnalyst()

  console.log(`[CommercialAnalyst] Assessing ${signals.length} signals with LLM...`)

  const toAssess = signals.filter((s: any) => {
    const q = s.qualification?.qualification
    return q !== "bug" && q !== "noise"
  })

  console.log(`[CommercialAnalyst] ${toAssess.length} signals pass first-pass filter (non-bug, non-noise)`)

  const assessments = await analyst.batchAssess(toAssess, intent, knowledgePack, meetingCharter)

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

  // ── Scout Commander: Generate Scout Plan (auditable planner) ───────────────
  const scoutPlanStore = new ScoutPlanStore(options.dataDir)
  const scoutPlan = generateScoutPlan(cycleId, intent, options.searchContext, options.knowledgePack, options.knowledgeBase)
  scoutPlanStore.save(scoutPlan)
  console.log(`[Scout Commander] ScoutPlan generated: ${scoutPlan.totalAssignments} assignment(s)`)
  for (const a of scoutPlan.assignments) {
    console.log(`  [${a.assignmentId}] ${a.objective} — sources: ${a.allowedSources.join(", ") || "(all)"}`)
  }
  console.log("")

  // Import and register adapters
  await import("../registry/register-all.js")
  const { SourceRegistry } = await import("../registry/source-registry.js")

  // Begin from all sources configured on the intent, then split by workflow.
  const configuredSourceNames = SourceRegistry.listForIntent(intent.id, intent.sourcePriority)
  const knowledgeOnlySourceNames = configuredSourceNames.filter(name => getSourceWorkflowType(name) === "knowledge_source")
  let adapterNames = configuredSourceNames.filter(name => getSourceWorkflowType(name) !== "knowledge_source")

  if (knowledgeOnlySourceNames.length > 0) {
    console.log(`[Flow boundary] Knowledge workflow sources configured but not polled in radar run: ${knowledgeOnlySourceNames.join(", ")}`)
  }

  // Apply Scout Brief sourceWeights (long-lived suppression/boost) to radar-capable sources only.
  if (options.searchContext?.sourceWeights?.length) {
    const weights = options.searchContext.sourceWeights
    const suppressSet = new Set(
      weights.filter(w => w.weight === 0).map(w => w.sourceId)
    )
    const suppressedNames = [...suppressSet]
    if (suppressedNames.length > 0) {
      adapterNames = adapterNames.filter(n => !suppressSet.has(n))
      console.log(`[Scout Brief] Suppressed radar sources: ${suppressedNames.join(", ")}`)
    }
  }

  if (strategy?.sourceBias?.action === "pause") {
    adapterNames = adapterNames.filter(n => n !== strategy.sourceBias!.sourceId)
    console.log(`[Strategy] Paused radar source: ${strategy.sourceBias.sourceId}`)
  }
  console.log(`[Registry] Active radar adapters for "${intent.id}": ${adapterNames.join(", ")}\n`)

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

  // ── Step 4b: Create Evidence objects from scored signals ────────────────────
  // Evidence is the first-class evidence unit in the intelligence operating model.
  // Every scored signal becomes an Evidence with explicit lineage back to source.
  console.log("[3b] INTELLIGENCE EVIDENCE CREATION")
  const evidenceStore = new EvidenceStore(options.dataDir)
  const intelligenceTopic = intent.id as any  // topic = intentId for now
  const evidenceCount = { created: 0 }
  for (const sig of scored) {
    // Avoid duplicate evidence for the same signal in the same cycle
    const existing = evidenceStore.load(intelligenceTopic, sig.id)
    if (existing) continue

    const evidence: Evidence = {
      evidenceId: sig.id,
      sourceId: sig.attribution?.sourceAdapterId ?? sig.sourceType ?? "unknown",
      topic: intelligenceTopic,
      locator: `scored-signal:${sig.id}`,
      capturedAt: sig.createdAt ?? new Date().toISOString(),
      normalizedText: `${sig.title ?? ""} ${sig.body ?? ""}`.trim(),
      entityRefs: sig.tags ?? [],
      confidence: sig.relevanceScore,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    evidenceStore.save(intelligenceTopic, evidence)
    evidenceCount.created++
  }
  console.log(`  Evidence objects created: ${evidenceCount.created}\n`)

  // ── Step 4b: Topic suppression (SearchContext) ────────────────────────────
  // Apply topicSuppressions from SearchContext BEFORE qualification scoring.
  // Suppressed signals are filtered out and do not enter the triage queue.
  let afterTopicFilter = scored
  if (options.searchContext?.topicSuppressions?.length) {
    const suppressTerms = options.searchContext.topicSuppressions.map(t => t.toLowerCase())
    afterTopicFilter = scored.filter(sig => {
      const text = `${sig.title ?? ""} ${sig.body ?? ""} ${(sig.tags ?? []).join(" ")}`.toLowerCase()
      return !suppressTerms.some(term => text.includes(term))
    })
    const removed = scored.length - afterTopicFilter.length
    if (removed > 0) {
      console.log(`[Scout Brief] topicSuppressions filtered ${removed} signals: ${suppressTerms.join(", ")}`)
    }
  } else {
    afterTopicFilter = scored
  }

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
  const qualified = addQualification(afterTopicFilter, effectiveIntent)
  const qualCounts: Record<string, number> = {}
  for (const sig of qualified) {
    const q = sig.qualification?.qualification ?? "unknown"
    qualCounts[q] = (qualCounts[q] ?? 0) + 1
  }
  console.log(`  Summary: ${JSON.stringify(qualCounts)}\n`)

  // ── Step 5b: Commercial Analyst (LLM) ─────────────────────────────────
  const triageResults = options.useCommercialAnalyst
    ? await triageWithCommercialAnalyst(qualified, scored, intent, cycleId, options.knowledgePack, options.meetingCharter)
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
  const meetingRecordStore = new MeetingRecordStore(options.dataDir)
  const findingStore = new FindingStore(options.dataDir)
  const decisionObjectStore = new DecisionObjectStore(options.dataDir)
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

    // ── Intelligence model: create Finding for approved signals ───────────────
    if (decision === "approved") {
      const sig = signal
      const assessment = triageResults?.get(signal.id)?.assessment ?? null
      const findingId = `finding-${sig.id}`
      const existingFinding = findingStore.load(intelligenceTopic, findingId)
      if (!existingFinding) {
        // Infer finding kind from signal category and commercial assessment
        let findingKind: Finding["findingKind"] = "observation"
        if (assessment?.category === "feature_request" || assessment?.category === "cross-sell") {
          findingKind = "interpretation"
        } else if (assessment?.category === "bug_report") {
          findingKind = "contradiction"
        }
        const decisionRelevance: Finding["decisionRelevance"] =
          assessment?.category === "renewal" ? "opportunity"
          : assessment?.confidence != null && assessment.confidence >= 0.5 ? "opportunity"
          : "execution"

        const finding: Finding = {
          findingId,
          topic: intelligenceTopic,
          findingKind,
          aggregationLevel: "single_evidence",
          decisionRelevance,
          statement: assessment?.reasoning ?? `Signal approved: ${sig.title ?? sig.id}`,
          supportedByEvidenceIds: [sig.id],
          metricsContext: assessment?.opportunityScore != null ? {
            arr: assessment.arrImpact ? parseDollarAmount(assessment.arrImpact) : undefined,
            nrr: assessment.nrrImpact ? parseDollarAmount(assessment.nrrImpact) : undefined,
            ndr: assessment.ndrImpact ? parseDollarAmount(assessment.ndrImpact) : undefined,
            notes: [
              `opportunityScore=${assessment.opportunityScore}`,
              `confidence=${assessment.confidence}`,
              ...(assessment.arrImpact ? [`arrImpact=${assessment.arrImpact}`] : []),
              ...(assessment.nrrImpact ? [`nrrImpact=${assessment.nrrImpact}`] : []),
              ...(assessment.ndrImpact ? [`ndrImpact=${assessment.ndrImpact}`] : []),
            ],
          } : undefined,
          conflictsWithReferenceFactIds: [],
          freshness: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        findingStore.save(intelligenceTopic, finding)
      }
    }

    // ── BA Meeting Room: Generate MeetingRecord for each triage decision ──────
    const assessment = triageResults?.get(signal.id)?.assessment ?? null
    const meetingRecord = evaluateWithMeetingRoom(
      signal.id,
      cycleId,
      decision,
      assessment,
      options.meetingCharter,
      options.knowledgePack,
    )
    meetingRecordStore.save(meetingRecord)
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

  // ── Step 7b: Create DecisionObjects from opportunities ─────────────────────
  // Each approved opportunity becomes a DecisionObject for meeting governance.
  // DecisionObject back-links to Finding(s), which back-link to Evidence.
  console.log("[7b] DECISION OBJECT CREATION")
  let decisionObjectCount = 0
  for (const opp of opportunities) {
    const existingDO = decisionObjectStore.load(intelligenceTopic, opp.id)
    if (existingDO) continue

    // Find the finding IDs that correspond to signals in this opportunity
    // Use the pain card to get signal IDs (synchronously)
    const painCardIds: string[] = (opp as any).painCardIds ?? []
    const signalIds: string[] = []
    for (const pcId of painCardIds) {
      const pcPath = path.join(options.dataDir, "pain-cards", `${pcId}.json`)
      if (fs.existsSync(pcPath)) {
        const pc = JSON.parse(fs.readFileSync(pcPath, "utf-8")) as any
        if (pc?.signalIds) signalIds.push(...pc.signalIds)
      }
    }

    // Map signal IDs to finding IDs (finding-{signalId})
    const supportedByFindingIds: string[] = []
    for (const sigId of signalIds) {
      const fid = `finding-${sigId}`
      if (findingStore.load(intelligenceTopic, fid)) {
        supportedByFindingIds.push(fid)
      }
    }

    // If no findings exist yet, create them now from the scored signals
    if (supportedByFindingIds.length === 0) {
      for (const sigId of signalIds) {
        const fid = `finding-${sigId}`
        if (!findingStore.load(intelligenceTopic, fid)) {
          const sig = scored.find((s: any) => s.id === sigId)
          if (sig) {
            const finding: Finding = {
              findingId: fid,
              topic: intelligenceTopic,
              findingKind: "interpretation",
              aggregationLevel: "single_evidence",
              decisionRelevance: "opportunity",
              statement: sig.title ?? sig.id,
              supportedByEvidenceIds: [sigId],
              metricsContext: undefined,
              conflictsWithReferenceFactIds: [],
              freshness: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            findingStore.save(intelligenceTopic, finding)
            supportedByFindingIds.push(fid)
          }
        } else {
          supportedByFindingIds.push(fid)
        }
      }
    }

    // Infer priority band from pain card severity and commercial assessment opportunityScore
    let priorityBand: DecisionObject["priorityBand"] = "medium"
    let bestOpportunityScore: number | null = null
    let bestArrImpact: string | undefined
    let bestNrrImpact: string | undefined
    let bestNdrImpact: string | undefined
    // Find the highest opportunityScore and collect any arr/nrr/ndr impacts
    if (triageResults) {
      for (const sigId of opp.evidenceIds) {
        const result = triageResults.get(sigId)
        if (!result) continue
        if (result.assessment?.opportunityScore != null) {
          if (bestOpportunityScore === null || result.assessment.opportunityScore > bestOpportunityScore) {
            bestOpportunityScore = result.assessment.opportunityScore
          }
        }
        // Collect dollar impacts — prefer the first non-undefined value
        if (!bestArrImpact && result.assessment?.arrImpact) bestArrImpact = result.assessment.arrImpact
        if (!bestNrrImpact && result.assessment?.nrrImpact) bestNrrImpact = result.assessment.nrrImpact
        if (!bestNdrImpact && result.assessment?.ndrImpact) bestNdrImpact = result.assessment.ndrImpact
      }
      // Upgrade priority band based on opportunityScore
      if (bestOpportunityScore !== null) {
        if (bestOpportunityScore >= 0.8) priorityBand = "high"
        else if (bestOpportunityScore <= 0.3) priorityBand = "low"
      }
    }
    for (const pcId of painCardIds) {
      const pcPath = path.join(options.dataDir, "pain-cards", `${pcId}.json`)
      if (fs.existsSync(pcPath)) {
        const pc = JSON.parse(fs.readFileSync(pcPath, "utf-8")) as any
        if (pc?.severity === "high") { priorityBand = "high"; break }
        if (pc?.severity === "medium") priorityBand = "medium"
      }
    }

    const decisionObject: DecisionObject = {
      decisionObjectId: opp.id,
      topic: intelligenceTopic,
      kind: "opportunity",
      statement: opp.title ?? opp.summary ?? opp.id,
      supportedByFindingIds,
      priorityBand,
      metricsImpact: bestOpportunityScore !== null ? {
        direction: "expansion",
        strength: bestOpportunityScore >= 0.7 ? "direct" : bestOpportunityScore >= 0.4 ? "indirect" : "speculative",
        context: {
          arr: bestArrImpact ? parseDollarAmount(bestArrImpact) : undefined,
          nrr: bestNrrImpact ? parseDollarAmount(bestNrrImpact) : undefined,
          ndr: bestNdrImpact ? parseDollarAmount(bestNdrImpact) : undefined,
          notes: [
            `opportunityScore=${bestOpportunityScore}`,
            ...(bestArrImpact ? [`arr=${bestArrImpact}`] : []),
            ...(bestNrrImpact ? [`nrr=${bestNrrImpact}`] : []),
            ...(bestNdrImpact ? [`ndr=${bestNdrImpact}`] : []),
          ],
        },
      } : undefined,
      ownerSuggestion: undefined,
      freshness: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    decisionObjectStore.save(intelligenceTopic, decisionObject)
    decisionObjectCount++

    // ── DecisionObject-level meeting governance (second pass) ─────────────────
    // Build assessment map for all signals in this opportunity's evidence bundle
    const bundleAssessments = new Map<string, import("../schemas/commercial-assessment.js").CommercialAssessment>()
    for (const sigId of opp.evidenceIds) {
      const result = triageResults?.get(sigId)
      if (result?.assessment) {
        bundleAssessments.set(sigId, result.assessment)
      }
    }
    if (bundleAssessments.size > 0) {
      const meetingRecord = evaluateDecisionObjectWithMeetingRoom(
        opp.id,
        cycleId,
        bundleAssessments,
        options.meetingCharter,
        options.knowledgePack,
      )
      meetingRecordStore.save(meetingRecord)
    }
  }
  console.log(`  DecisionObjects created: ${decisionObjectCount}\n`)

  // ── Step 9: Prototype briefs ──────────────────────────────────────────
  console.log("[8] PROTOTYPE BRIEFS")
  const { PrototypeBriefConsumer } = await import("../consumers/prototype-brief.js")
  const { StitchProjectConsumer } = await import("../consumers/stitch-project.js")
  const { StorageHelper } = await import("../infrastructure/storage-helper.js")
  const storage = new StorageHelper(options.dataDir)
  const protoBrief = new PrototypeBriefConsumer(eventBus, storage)
  const stitchProject = new StitchProjectConsumer(eventBus, storage)
  ensureDir(path.join(options.dataDir, "briefs", "prototype"))

  for (const opp of opportunities) {
    try {
      const payload = {
        opportunityId: opp.id,
        productContext: intent.productContext,
        intentId: intent.id,
        sourceAdapterId: opp.attribution?.sourceAdapterId ?? "pipeline",
      };
      await protoBrief.process("opportunity.created", payload);
      await stitchProject.process("opportunity.created", payload);
    } catch (err) {
      console.warn(`  Brief generation error for ${opp.id}: ${err}`)
    }
  }

  // Save RunContext snapshot for /review and /audit
  const runContextStore = new RunContextStore(options.dataDir)
  runContextStore.save({
    cycleId,
    timestamp: new Date().toISOString(),
    intentId: intent.id,
    runType: "radar",
    searchContext: summarizeSearchContext(options.searchContext),
    knowledgeBase: summarizeKnowledgeBase(options.knowledgeBase),
    knowledgePack: summarizeKnowledgePack(options.knowledgePack),
    meetingCharter: summarizeMeetingCharter(options.meetingCharter),
    knowledgeBrief: summarizeKnowledgeBrief(options.knowledgeBrief),
    pipelineStats: {
      ingested: allRawSignals.length,
      scored: scored.length,
      qualified: qualified.length,
      enqueuedForTriage: qualifiedForTriage.length,
      approved: approvedItems.length,
      rejected: rejectedItems.length,
      deferred: deferredItems.length,
      themes: themes.length,
      opportunities: opportunities.length,
    },
  })

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
