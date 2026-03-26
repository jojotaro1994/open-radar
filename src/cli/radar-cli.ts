/**
 * radar-cli.ts — interactive CLI for the Prototype Radar.
 *
 * CLI-first agent. Current persistent model:
 *   Intent          — persistent truth: what the radar is looking for and why
 *   Scout Brief    — persistent: how the scout searches, weights, suppresses (outward radar lane)
 *   Knowledge Brief — persistent: how inward knowledge exploration is directed (inward knowledge lane)
 *   Knowledge Base  — persistent inward knowledge layer
 *   Knowledge Pack  — persistent distilled working knowledge for current intent
 *   Meeting Goal    — persistent: how the BA meeting room frames judgment
 *   Last Run        — read-only projection of most recent /run
 *
 * ActiveStrategy (session patches) is a transitional compatibility overlay only.
 * It is NOT the authoritative long-lived product model.
 *
 * Change flow: draft -> structured preview -> refine/rewrite -> confirm (y/n) -> apply
 *
 * Run: npx tsx src/cli/radar-cli.ts [--intent=riplus-ma]
 */

import * as path from "path"
import * as fs from "fs"
import * as readline from "readline"
import type { RadarIntent } from "../schemas/intent.js"
import type { LastRunSummary } from "../state/last-run.js"
import { ActiveStrategyManager } from "../state/active-strategy.js"
import { LastRunStore } from "../state/last-run.js"
import { SearchContextStore } from "../state/search-context-store.js"
import { ScoutPlanStore } from "../state/scout-plan-store.js"
import { KnowledgeBaseStore } from "../state/knowledge-base-store.js"
import { KnowledgePackStore } from "../state/knowledge-pack-store.js"
import { MeetingCharterStore } from "../state/meeting-charter-store.js"
import { KnowledgeBriefStore } from "../state/knowledge-brief-store.js"
import { ModelConfigStore } from "../state/model-config-store.js"
import { RunContextStore } from "../state/run-context-store.js"
import { MeetingRecordStore } from "../state/meeting-record-store.js"
import { DecisionObjectStore } from "../state/decision-object-store.js"
import { FindingStore } from "../state/finding-store.js"
import { EvidenceStore } from "../state/evidence-store.js"
import { HumanReviewFeedbackStore } from "../state/human-review-feedback-store.js"
import { EvidenceRequestStore } from "../state/evidence-request-store.js"
import { RetrospectiveCaseStore } from "../state/retrospective-case-store.js"
import { LearningMemoryStore } from "../state/learning-memory-store.js"
import { buildReviewConfirm, buildRetrospectiveConfirm, buildLearningMemoryConfirm, RESOLUTION_LABELS, FEEDBACK_CLASS_LABELS, MISJUDGMENT_LABELS, LEARNING_MEMORY_TYPE_LABELS } from "./review-handler.js"
import type { IntelligenceTopic } from "../state/intelligence-layout.js"
import type { ReviewResolution, FeedbackClass } from "../state/human-review-feedback.js"
import type { EvidenceAvailabilityStatus } from "../state/evidence-request.js"
import { printState } from "../state/state-printer.js"
import { summarizeKnowledgeBase, summarizeKnowledgePack, summarizeMeetingCharter, summarizeSearchContext, summarizeKnowledgeBrief } from "../state/context-summary.js"
import { buildPatchAction } from "./patch-handler.js"
import { runPipeline } from "../orchestrator/run-pipeline.js"
import { runKnowledgeWorkflow } from "../orchestrator/knowledge-workflow.js"
import { buildScoutBriefConfirm, buildKnowledgeBriefConfirm, buildMeetingGoalConfirm } from "./tell-handler.js"
import { inferDefaultSourceRole } from "../state/source-role.js"
import { getSourceWorkflowType } from "../registry/source-taxonomy.js"
import {
  MODEL_LAYERS,
  createDefaultModelConfig,
  getLayerSelection,
  setLayerSelection,
  type ModelConfig,
  type ModelLayer,
} from "../state/model-config.js"
import { isTextCapableModel, listOpenRouterModels, type OpenRouterModelSummary } from "../providers/openrouter.js"
import { loadOpenRouterProviderConfig, maskSecret } from "../config/provider-config.js"

const DATA_DIR = process.env.RADAR_DATA_DIR ?? path.join(process.cwd(), "data")
const CONFIG_DIR = path.join(process.cwd(), "config")

function isModelLayer(value: string): value is ModelLayer {
  return (MODEL_LAYERS as readonly string[]).includes(value)
}

function selectedLayersForModel(config: ModelConfig, modelId: string): string[] {
  return MODEL_LAYERS.filter(layer => getLayerSelection(config, layer)?.model === modelId)
}

function renderModelConfig(intentId: string, config: ModelConfig, persisted: boolean): string {
  const provider = loadOpenRouterProviderConfig()
  const lines: string[] = []
  lines.push(`\n── Model Config ─────────────────────`)
  lines.push(`Intent:   ${intentId}`)
  lines.push(`Provider: ${config.defaultProvider}  (key=${maskSecret(provider.apiKey)})`)
  lines.push(`Status:   ${persisted ? "persisted" : "using defaults (not yet saved)"}`)
  lines.push(``)
  lines.push(`Layers:`)
  lines.push(`  search:                  ${getLayerSelection(config, "search")?.model ?? "(unset)"}`)
  lines.push(`  meeting:                 ${getLayerSelection(config, "meeting")?.model ?? "(unset)"}`)
  lines.push(`  consumer.prototypeBrief: ${getLayerSelection(config, "consumer.prototypeBrief")?.model ?? "(unset)"}`)
  lines.push(``)
  lines.push(`Note: meeting currently stores its own model slot, but current runtime may still share the CommercialAnalyst/search execution path.`)
  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

function renderOpenRouterModels(models: OpenRouterModelSummary[], config: ModelConfig, freeOnly: boolean): string {
  const textModels = models.filter(isTextCapableModel).filter(model => (freeOnly ? model.isFree : true))
  const sorted = [...textModels].sort((a, b) => {
    const aSelected = selectedLayersForModel(config, a.id).length > 0 ? 1 : 0
    const bSelected = selectedLayersForModel(config, b.id).length > 0 ? 1 : 0
    if (aSelected !== bSelected) return bSelected - aSelected
    return a.id.localeCompare(b.id)
  })

  const lines: string[] = []
  lines.push(`\n── OpenRouter Models (${freeOnly ? "free text-capable" : "all text-capable"}) ──`)
  if (sorted.length === 0) {
    lines.push(`No matching models found.`)
  } else {
    for (const model of sorted) {
      const layers = selectedLayersForModel(config, model.id)
      const suffix = layers.length > 0 ? `  [selected: ${layers.join(", ")}]` : ""
      lines.push(`- ${model.id}`)
      lines.push(`  vendor=${model.vendor}  free=${model.isFree ? "yes" : "no"}  context=${model.contextLength}${suffix}`)
    }
  }
  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

function loadIntent(intentId: string): RadarIntent {
  const intentPath = path.join(process.cwd(), "config", "intents", `${intentId}.json`)
  if (!fs.existsSync(intentPath)) throw new Error(`Intent not found: ${intentPath}`)
  return JSON.parse(fs.readFileSync(intentPath, "utf-8")) as RadarIntent
}

function intentPath(intentId: string): string {
  return path.join(process.cwd(), "config", "intents", `${intentId}.json`)
}

/**
 * reviewRun — shows what happened in the last pipeline run.
 *
 * Uses:
 *   LastRunSummary  — latest run stats and source breakdown
 *   RunContext      — latest cycle context snapshot (SearchContext, KnowledgePack, MeetingCharter)
 *
 * Always shows the most recent run. There is no historical cycle traversal.
 */
function reviewRun(
  dataDir: string,
  runContextStore: RunContextStore,
  lastRunStore: LastRunStore,
  intentId: string
): string {
  const lastRun = lastRunStore.load()

  // Use lastRun.cycleId to load the correct context — this ensures /review shows
  // the run that actually produced lastRun, not the alphabetically latest context file
  const targetCycleId = lastRun?.cycleId ?? null

  if (!targetCycleId) return `No run history found. Run /run first.`

  const ctx = runContextStore.load(targetCycleId)
  const runType = lastRun?.runType ?? "radar"
  const isKnowledgeRun = runType === "knowledge"

  const lines: string[] = []
  const runLabel = isKnowledgeRun ? "Knowledge Review" : "Radar Review"
  lines.push(`\n── ${runLabel} ──────────────────────`)
  lines.push(`Cycle:    ${targetCycleId}`)
  lines.push(`Intent:   ${ctx?.intentId ?? intentId}`)
  lines.push(`Run type: ${runType}`)

  if (ctx?.pipelineStats) {
    const ps = ctx.pipelineStats
    lines.push(``)
    lines.push(`Pipeline:`)
    if (isKnowledgeRun) {
      lines.push(`  entriesInspected:   ${ps.ingested}`)
      lines.push(`  newEntries:        ${ps.scored}`)
      lines.push(`  totalKbEntries:    ${ctx.knowledgeBase?.entryCount ?? "?"}`)
    } else {
      lines.push(`  ingested:           ${ps.ingested}`)
      lines.push(`  scored:             ${ps.scored}`)
      lines.push(`  qualified:          ${ps.qualified}`)
      lines.push(`  enqueuedForTriage:  ${ps.enqueuedForTriage}`)
      lines.push(`  approved:           ${ps.approved}`)
      lines.push(`  rejected:           ${ps.rejected}`)
      lines.push(`  deferred:           ${ps.deferred}`)
      lines.push(`  themes:             ${ps.themes}`)
      lines.push(`  opportunities:      ${ps.opportunities}`)
    }
  } else {
    lines.push(`(pipeline stats not available for this cycle)`)
  }

  if (lastRun?.sources?.length) {
    lines.push(``)
    if (isKnowledgeRun) {
      lines.push(`Knowledge sources polled:`)
      for (const source of lastRun.sources) {
        lines.push(`  ${source.name} (${source.sourceType}): ${source.signalCount} items inspected`)
      }
    } else {
      lines.push(`Radar sources polled:`)
      for (const source of lastRun.sources) {
        lines.push(`  ${source.name} (${source.sourceType}): ${source.signalCount} signals`)
      }
    }
  }

  // Scout Brief — only relevant for radar runs
  if (!isKnowledgeRun && ctx?.searchContext && Object.keys(ctx.searchContext).length > 0) {
    lines.push(``)
    lines.push(`Scout Brief:`)
    if (ctx.searchContext.recallMode) lines.push(`  recallMode:     ${ctx.searchContext.recallMode}`)
    if (ctx.searchContext.topicBoosts?.length) lines.push(`  topicBoosts:    ${ctx.searchContext.topicBoosts.join(", ")}`)
    if (ctx.searchContext.topicSuppressions?.length) lines.push(`  suppressions:   ${ctx.searchContext.topicSuppressions.join(", ")}`)
    if (ctx.searchContext.sourceWeights && Object.keys(ctx.searchContext.sourceWeights).length > 0) {
      const entries = Object.entries(ctx.searchContext.sourceWeights).map(([key, value]) => `${key}=${value}`).join(", ")
      lines.push(`  sourceWeights:  ${entries}`)
    }
  }

  // Knowledge Brief — only relevant for knowledge runs
  if (isKnowledgeRun && ctx?.knowledgeBrief && Object.keys(ctx.knowledgeBrief).length > 0) {
    lines.push(``)
    lines.push(`Knowledge Brief:`)
    if (ctx.knowledgeBrief.explorationFocus) lines.push(`  focus: ${ctx.knowledgeBrief.explorationFocus}`)
    if (ctx.knowledgeBrief.distillationMode) lines.push(`  distillationMode: ${ctx.knowledgeBrief.distillationMode}`)
    if (ctx.knowledgeBrief.knowledgeSourcePriorities && Object.keys(ctx.knowledgeBrief.knowledgeSourcePriorities).length > 0) {
      const entries = Object.entries(ctx.knowledgeBrief.knowledgeSourcePriorities).map(([k, v]) => `${k}=${v}`).join(", ")
      lines.push(`  sourcePriorities: ${entries}`)
    }
    if (ctx.knowledgeBrief.suppressions?.length) lines.push(`  suppressions: ${ctx.knowledgeBrief.suppressions.join(", ")}`)
  }

  // Knowledge Pack — show the pack that was active in this run
  if (ctx?.knowledgePack && Object.keys(ctx.knowledgePack).length > 0) {
    lines.push(``)
    lines.push(`Knowledge Pack:`)
    const status = ctx.knowledgePack.status ?? "unknown"
    if (isKnowledgeRun && status === "candidate") {
      // This IS the latest knowledge run's candidate — clear call to action
      lines.push(`  status: candidate  ← this is the latest; accept with /tell pack accept <id>`)
    } else {
      lines.push(`  status: ${status}  (use /tell pack accept <id> to accept a candidate)`)
    }
    if (ctx.knowledgePack.productCapabilities?.length) {
      lines.push(`  productCapabilities: ${ctx.knowledgePack.productCapabilities.length} items`)
    }
    if (ctx.knowledgePack.verticalContext) {
      const verticalContext = ctx.knowledgePack.verticalContext as string
      lines.push(`  verticalContext: ${verticalContext.slice(0, 80)}${verticalContext.length > 80 ? "..." : ""}`)
    }
  }

  // Knowledge Base — primary artifact of knowledge runs
  if (ctx?.knowledgeBase && Object.keys(ctx.knowledgeBase).length > 0) {
    lines.push(``)
    lines.push(`Knowledge Base:`)
    if (ctx.knowledgeBase.entryCount !== undefined) lines.push(`  curated entries: ${ctx.knowledgeBase.entryCount}`)
    if (ctx.knowledgeBase.sourceIds?.length) lines.push(`  sources: ${ctx.knowledgeBase.sourceIds.join(", ")}`)
    if (ctx.knowledgeBase.summary) {
      const kbSummary = ctx.knowledgeBase.summary as string
      lines.push(`  summary: ${kbSummary.slice(0, 80)}${kbSummary.length > 80 ? "..." : ""}`)
    }
  }

  // Meeting Goal — only for radar runs (BA Meeting Room output)
  if (!isKnowledgeRun && ctx?.meetingCharter && Object.keys(ctx.meetingCharter).length > 0) {
    lines.push(``)
    lines.push(`Meeting Goal:`)
    if (ctx.meetingCharter.objective) lines.push(`  objective:        ${ctx.meetingCharter.objective}`)
    if (ctx.meetingCharter.primaryLens) lines.push(`  primaryLens:      ${ctx.meetingCharter.primaryLens}`)
    if (ctx.meetingCharter.requiredQuestions?.length) {
      lines.push(`  requiredQuestions:`)
      for (const question of ctx.meetingCharter.requiredQuestions) lines.push(`    - ${question}`)
    }
  }

  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

/**
 * explainSignal — reconstructs why a signal was triaged the way it was.
 *
 * Reads:
 *   data/review-queue/{signalId}/meta.json      — cycleId, enqueuedAt
 *   data/review-queue/{signalId}/status.json    — current status
 *   data/review-queue/{signalId}/triage.json    — triage decision + reason
 *   data/scored-signals/{signalId}.json        — signal title, relevanceScore, qualification
 *   data/run-contexts/{cycleId}.json            — context at time of triage (if available)
 */
function explainSignal(
  signalId: string,
  dataDir: string,
  runContextStore: RunContextStore
): string {
  const queueDir = path.join(dataDir, "review-queue", signalId)

  const meta = readJsonOrNull(path.join(queueDir, "meta.json")) as
    | { signalId: string; cycleId: string; enqueuedAt: string }
    | null
  const status = readJsonOrNull(path.join(queueDir, "status.json")) as
    | { status: string }
    | null
  const triage = readJsonOrNull(path.join(queueDir, "triage.json")) as
    | { decision: string; reviewedBy: string; reviewedAt: string; reason?: string }
    | null
  const signal = readJsonOrNull(path.join(dataDir, "scored-signals", `${signalId}.json`)) as Record<string, unknown> | null

  if (!meta || !status) return `Signal "${signalId}" not found in review queue.`

  const lines: string[] = []
  lines.push(`\n── Signal: ${signalId} ──`)

  if (signal) {
    const title = (signal.title as string) ?? "(no title)"
    const score = (signal.relevanceScore as number)?.toFixed(3) ?? "unknown"
    const qual = (signal.qualification as { qualification?: string })?.qualification ?? "unknown"
    lines.push(`Title:   ${title}`)
    lines.push(`Score:   ${score}  |  Qualification: ${qual}`)
  } else {
    lines.push(`(scored signal not found — run may be older)`)
  }

  lines.push(`Status:  ${status.status}`)
  if (triage) {
    lines.push(`Triage:  ${triage.decision}  by ${triage.reviewedBy}  at ${triage.reviewedAt}`)
    if (triage.reason) lines.push(`Reason:  ${triage.reason}`)
  }
  lines.push(`Cycle:   ${meta.cycleId}  enqueued ${meta.enqueuedAt}`)

  const ctx = runContextStore.load(meta.cycleId)
  if (ctx) {
    if (ctx.searchContext && Object.keys(ctx.searchContext).length > 0) {
      lines.push(``)
      lines.push(`Scout Brief at time:`)
      if (ctx.searchContext.recallMode) lines.push(`  recallMode: ${ctx.searchContext.recallMode}`)
      if (ctx.searchContext.topicSuppressions?.length) lines.push(`  suppressions: ${ctx.searchContext.topicSuppressions.join(", ")}`)
      if (ctx.searchContext.sourceWeights && Object.keys(ctx.searchContext.sourceWeights).length > 0) {
        lines.push(`  sourceWeights: ${JSON.stringify(ctx.searchContext.sourceWeights)}`)
      }
    }

    if (ctx.knowledgeBrief && Object.keys(ctx.knowledgeBrief).length > 0) {
      lines.push(``)
      lines.push(`Knowledge Brief at time:`)
      if (ctx.knowledgeBrief.explorationFocus) lines.push(`  focus: ${ctx.knowledgeBrief.explorationFocus}`)
      if (ctx.knowledgeBrief.explorationQuestions?.length) lines.push(`  explorationQuestions: ${ctx.knowledgeBrief.explorationQuestions.join("; ")}`)
    }

    if (ctx.meetingCharter && Object.keys(ctx.meetingCharter).length > 0) {
      lines.push(``)
      lines.push(`Meeting Goal at time:`)
      if (ctx.meetingCharter.objective) lines.push(`  objective: ${ctx.meetingCharter.objective}`)
      if (ctx.meetingCharter.primaryLens) lines.push(`  primaryLens: ${ctx.meetingCharter.primaryLens}`)
    }

    if (ctx.knowledgePack && Object.keys(ctx.knowledgePack).length > 0) {
      lines.push(``)
      lines.push(`Knowledge Pack at time:`)
      if (ctx.knowledgePack.verticalContext) {
        const verticalContext = ctx.knowledgePack.verticalContext as string
        lines.push(`  verticalContext: ${verticalContext.slice(0, 80)}${verticalContext.length > 80 ? "..." : ""}`)
      }
    }

    if (ctx.knowledgeBase && Object.keys(ctx.knowledgeBase).length > 0) {
      lines.push(``)
      lines.push(`Knowledge Base at time:`)
      if (ctx.knowledgeBase.entryCount !== undefined) lines.push(`  curated entries: ${ctx.knowledgeBase.entryCount}`)
      if (ctx.knowledgeBase.summary) {
        const kbSummary = ctx.knowledgeBase.summary as string
        lines.push(`  summary: ${kbSummary.slice(0, 80)}${kbSummary.length > 80 ? "..." : ""}`)
      }
    }
  } else {
    lines.push(`(run-context not available for this cycle)`)
  }

  lines.push("─────────────────────────────\n")
  return lines.join("\n")
}

function readJsonOrNull(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

// ── Scout Plan display ────────────────────────────────────────────────────────

function showPlan(
  scoutPlanStore: ScoutPlanStore,
  targetCycleId: string | undefined,
  runContextStore: RunContextStore,
  intentId: string,
): string {
  const cycles = scoutPlanStore.list().sort()
  const planCycleId = targetCycleId ?? (cycles[cycles.length - 1] ?? null)

  if (!planCycleId) return `\nNo Scout Plan found. Run /run first to generate a plan.\n`

  const plan = scoutPlanStore.load(planCycleId)
  if (!plan) return `\nScout Plan for "${planCycleId}" not found.\n`

  const ctx = runContextStore.load(planCycleId)

  const lines: string[] = []
  lines.push(`\n── Scout Plan ───────────────────────────`)
  lines.push(`Cycle:    ${plan.cycleId}`)
  lines.push(`Intent:   ${plan.intentId}`)
  lines.push(`Generated: ${new Date(plan.generatedAt).toISOString()}`)
  lines.push(``)
  lines.push(`Assignments: ${plan.totalAssignments}`)
  lines.push(`Plan rationale: ${plan.planRationale}`)

  for (const assignment of plan.assignments) {
    lines.push(``)
    lines.push(`  [${assignment.assignmentId.toUpperCase()}] ${assignment.objective.replace(/_/g, " ")}`)
    lines.push(`  Description: ${assignment.description}`)
    lines.push(`  Sources:     ${assignment.allowedSources.join(", ") || "(all eligible)"}`)
    lines.push(`  Excluded:    ${assignment.excludedSources.join(", ") || "(none)"}`)
    lines.push(`  Topic focus: ${assignment.topicFocus.join(", ") || "(none)"}`)
    lines.push(`  Overlap:     ${assignment.overlapPolicy}`)
    lines.push(`  Dispatch:    weight=${assignment.dispatchWeight}`)
    lines.push(`  Rationale:   ${assignment.rationale}`)
    lines.push(`  Stop:        ${assignment.stopConditions.join(" | ")}`)
  }

  if (plan.exclusions.length > 0) {
    lines.push(``)
    lines.push(`Exclusions:`)
    for (const ex of plan.exclusions) lines.push(`  — ${ex.reason}`)
  }

  if (plan.overlaps.length > 0) {
    lines.push(``)
    lines.push(`Allowed overlaps:`)
    for (const ov of plan.overlaps) lines.push(`  — [${ov.assignmentIds.join(", ")}]: ${ov.reason}`)
  }

  if (ctx) {
    lines.push(``)
    lines.push(`Knowledge Base at time:`)
    if (ctx.knowledgeBase?.entryCount !== undefined) lines.push(`  curated entries: ${ctx.knowledgeBase.entryCount}`)
    if (ctx.knowledgeBase?.sourceIds?.length) lines.push(`  sources: ${ctx.knowledgeBase.sourceIds.join(", ")}`)
    if (!ctx.knowledgeBase?.entryCount && !ctx.knowledgeBase?.sourceIds?.length) lines.push(`  (present in run context)`)

    lines.push(``)
    lines.push(`Knowledge Pack at time:`)
    if (ctx.knowledgePack?.verticalContext) {
      const vc = ctx.knowledgePack.verticalContext as string
      lines.push(`  verticalContext: ${vc.slice(0, 80)}${vc.length > 80 ? "..." : ""}`)
    }
    lines.push(``)
    lines.push(`Knowledge Brief at time:`)
    if (ctx.knowledgeBrief?.explorationFocus) lines.push(`  focus: ${(ctx.knowledgeBrief.explorationFocus as string).slice(0, 80)}...`)
    lines.push(``)
    lines.push(`Meeting Goal at time:`)
    if (ctx.meetingCharter?.primaryLens) lines.push(`  primaryLens: ${ctx.meetingCharter.primaryLens}`)
    if (ctx.meetingCharter?.objective) lines.push(`  objective: ${(ctx.meetingCharter.objective as string).slice(0, 80)}...`)
  }

  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

// ── Audit trail display ──────────────────────────────────────────────────────

function showAudit(
  target: string,
  dataDir: string,
  scoutPlanStore: ScoutPlanStore,
  runContextStore: RunContextStore,
  meetingRecordStore: MeetingRecordStore,
): string {
  // Determine if target is a cycleId or signalId
  const cycleIds = scoutPlanStore.list()
  const isCycleId = target.includes("riplus-") || target.includes("full-") || cycleIds.includes(target)

  if (isCycleId) {
    const plan = scoutPlanStore.load(target)
    const ctx = runContextStore.load(target)

    const lines: string[] = []
    lines.push(`\n── Audit Record ───────────────────────`)
    lines.push(`Cycle:   ${target}`)

    if (plan) {
      lines.push(``)
      lines.push(`Plan:`)
      lines.push(`  ${plan.totalAssignments} scout assignment(s) created`)
      lines.push(`  rationale: ${plan.planRationale}`)
      for (const a of plan.assignments) {
        lines.push(`  [${a.assignmentId}] ${a.objective} — dispatch=${a.dispatchWeight} — ${a.rationale}`)
      }
      if (plan.exclusions.length) {
        lines.push(`  Exclusions: ${plan.exclusions.map(e => e.reason).join("; ")}`)
      }
    } else {
      lines.push(`  (Scout Plan not available for this cycle)`)
    }

    if (ctx?.pipelineStats) {
      lines.push(``)
      lines.push(`Execution:`)
      lines.push(`  ingested=${ctx.pipelineStats.ingested} scored=${ctx.pipelineStats.scored} qualified=${ctx.pipelineStats.qualified}`)
      lines.push(`  approved=${ctx.pipelineStats.approved} rejected=${ctx.pipelineStats.rejected} deferred=${ctx.pipelineStats.deferred}`)
      lines.push(`  themes=${ctx.pipelineStats.themes} opportunities=${ctx.pipelineStats.opportunities}`)
    }

    if (ctx?.searchContext && Object.keys(ctx.searchContext).length > 0) {
      lines.push(``)
      lines.push(`Scout Brief at time:`)
      if (ctx.searchContext.recallMode) lines.push(`  recallMode: ${ctx.searchContext.recallMode}`)
      if ((ctx.searchContext as any).topicBoosts?.length) lines.push(`  topicBoosts: ${(ctx.searchContext as any).topicBoosts.join(", ")}`)
      if ((ctx.searchContext as any).topicSuppressions?.length) lines.push(`  suppressions: ${(ctx.searchContext as any).topicSuppressions.join(", ")}`)
    }

    if (ctx?.knowledgeBase && Object.keys(ctx.knowledgeBase).length > 0) {
      lines.push(``)
      lines.push(`Knowledge Base at time:`)
      if ((ctx.knowledgeBase as any).entryCount !== undefined) lines.push(`  curated entries: ${(ctx.knowledgeBase as any).entryCount}`)
      if ((ctx.knowledgeBase as any).sourceIds?.length) lines.push(`  sources: ${(ctx.knowledgeBase as any).sourceIds.join(", ")}`)
    }

    if (ctx?.knowledgePack && Object.keys(ctx.knowledgePack).length > 0) {
      lines.push(``)
      lines.push(`Knowledge Pack at time:`)
      if ((ctx.knowledgePack as any).verticalContext) {
        const vc = (ctx.knowledgePack as any).verticalContext as string
        lines.push(`  verticalContext: ${vc.slice(0, 100)}${vc.length > 100 ? "..." : ""}`)
      }
    }

    if (ctx?.meetingCharter) {
      lines.push(``)
      lines.push(`Meeting:`)
      lines.push(`  primaryLens: ${(ctx.meetingCharter.primaryLens as string) ?? "(none)"}`)
      if (ctx.meetingCharter.requiredQuestions?.length) {
        lines.push(`  requiredQuestions: ${(ctx.meetingCharter.requiredQuestions as string[]).length}`)
      }
    }

    lines.push(`─────────────────────────────────\n`)
    return lines.join("\n")
  }

  // signalId audit
  const queueDir = path.join(dataDir, "review-queue", target)
  const meta = readJsonOrNull(path.join(queueDir, "meta.json")) as
    | { signalId: string; cycleId: string; enqueuedAt: string }
    | null
  const triage = readJsonOrNull(path.join(queueDir, "triage.json")) as
    | { decision: string; reviewedBy: string; reviewedAt: string; reason?: string }
    | null
  const signal = readJsonOrNull(path.join(dataDir, "scored-signals", `${target}.json`)) as Record<string, unknown> | null

  if (!meta) return `\nSignal "${target}" not found.\n`

  const plan = scoutPlanStore.load(meta.cycleId)
  const ctx = runContextStore.load(meta.cycleId)

  const lines: string[] = []
  lines.push(`\n── Audit Record ───────────────────────`)
  lines.push(`Signal:  ${target}`)

  if (signal) {
    lines.push(`Title:   ${(signal.title as string) ?? "(no title)"}`)
    lines.push(`Score:   ${((signal.relevanceScore as number) ?? 0).toFixed(3)}`)
  }

  lines.push(`Cycle:   ${meta.cycleId}`)

  if (triage) {
    lines.push(``)
    lines.push(`Decision: ${triage.decision}  by ${triage.reviewedBy}  at ${triage.reviewedAt}`)
    if (triage.reason) lines.push(`Reason:  ${triage.reason}`)
  }

  if (plan) {
    lines.push(``)
    lines.push(`Plan:`)
    lines.push(`  ${plan.totalAssignments} scout assignment(s) created`)
    lines.push(`  rationale: ${plan.planRationale}`)
  }

  if (ctx) {
    lines.push(``)
    lines.push(`Scout Brief at time:`)
    if (ctx.searchContext?.recallMode) lines.push(`  recallMode: ${ctx.searchContext.recallMode}`)
    if (ctx.searchContext?.topicBoosts?.length) lines.push(`  topicBoosts: ${(ctx.searchContext.topicBoosts as string[]).join(", ")}`)
    if (ctx.searchContext?.topicSuppressions?.length) lines.push(`  suppressions: ${(ctx.searchContext.topicSuppressions as string[]).join(", ")}`)

    lines.push(``)
    lines.push(`Knowledge Pack at time:`)
    if (ctx.knowledgePack?.verticalContext) {
      const vc = ctx.knowledgePack.verticalContext as string
      lines.push(`  verticalContext: ${vc.slice(0, 80)}${vc.length > 80 ? "..." : ""}`)
    }

    lines.push(``)
    lines.push(`Meeting Goal at time:`)
    if (ctx.meetingCharter?.primaryLens) lines.push(`  primaryLens: ${ctx.meetingCharter.primaryLens}`)
    if (ctx.meetingCharter?.objective) lines.push(`  objective: ${(ctx.meetingCharter.objective as string).slice(0, 80)}...`)
  }

  // ── BA Meeting Room: Show Meeting Record ───────────────────────────────
  const mr = meetingRecordStore.loadForSignal(target)
  if (mr) {
    lines.push(``)
    lines.push(`── BA Meeting Room ──────────────────`)
    lines.push(`Chair:`)
    lines.push(`  ${mr.lenses.chair.summary}`)
    lines.push(`  Decision:    ${mr.lenses.chair.finalDecision}`)
    lines.push(`  Rationale:   ${mr.lenses.chair.decisionRationale.slice(0, 120)}`)
    lines.push(`Opportunity Lens:`)
    lines.push(`  category:     ${mr.lenses.opportunity.category}`)
    lines.push(`  impact:       ${mr.lenses.opportunity.commercialImpact}`)
    lines.push(`  verticals:    ${mr.lenses.opportunity.verticals.join(", ") || "(none)"}`)
    lines.push(`  conclusion:   ${mr.lenses.opportunity.conclusion.slice(0, 120)}`)
    lines.push(`Skeptic Lens:`)
    lines.push(`  conclusion:   ${mr.lenses.skeptic.conclusion.slice(0, 120)}`)
    if (mr.lenses.skeptic.weaknesses.length) lines.push(`  weaknesses:   ${mr.lenses.skeptic.weaknesses.slice(0, 2).join("; ")}`)
    if (mr.lenses.skeptic.riskFactors.length) lines.push(`  riskFactors:  ${mr.lenses.skeptic.riskFactors.slice(0, 2).join("; ")}`)
    lines.push(`Product Fit Lens:`)
    lines.push(`  fitLevel:     ${mr.lenses.productFit.fitLevel}`)
    lines.push(`  conclusion:   ${mr.lenses.productFit.conclusion.slice(0, 120)}`)
    if (mr.nextEvidenceNeeded.length) lines.push(`  nextEvidence: ${mr.nextEvidenceNeeded.slice(0, 2).join("; ")}`)
    lines.push(`  tags:         ${mr.tags.join(", ")}`)
  }

  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

// ── Intelligence Model CLI displays ─────────────────────────────────────────────

function showDecisions(
  dataDir: string,
  intentId: string,
  decisionObjectStore: DecisionObjectStore,
  findingStore: FindingStore,
  evidenceStore: EvidenceStore,
): string {
  const topic = intentId as IntelligenceTopic
  const ids = decisionObjectStore.list(topic)
  if (ids.length === 0) {
    return `\n── Decision Objects ─────────────────────\n  (no decision objects yet — run /run radar first)\n─────────────────────────────────\n`
  }

  const lines: string[] = []
  lines.push(`\n── Decision Objects ─────────────────────`)
  lines.push(`Topic: ${topic}  |  Count: ${ids.length}`)
  lines.push(``)

  for (const id of ids) {
    const dObj = decisionObjectStore.load(topic, id)
    if (!dObj) continue
    lines.push(`[${dObj.decisionObjectId}] ${dObj.kind} | ${dObj.priorityBand}`)
    lines.push(`  ${dObj.statement.slice(0, 80)}${dObj.statement.length > 80 ? "..." : ""}`)
    lines.push(`  findings=${dObj.supportedByFindingIds.length}  freshness=${dObj.freshness?.slice(0, 10)}`)
    if (dObj.metricsImpact) {
      lines.push(`  metrics: ${dObj.metricsImpact.direction} (${dObj.metricsImpact.strength})`)
    }
    lines.push(``)
  }
  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

function showFindings(
  dataDir: string,
  intentId: string,
  findingStore: FindingStore,
  evidenceStore: EvidenceStore,
): string {
  const topic = intentId as IntelligenceTopic
  const ids = findingStore.list(topic)
  if (ids.length === 0) {
    return `\n── Findings ────────────────────────────\n  (no findings yet — run /run radar first)\n─────────────────────────────────\n`
  }

  const lines: string[] = []
  lines.push(`\n── Findings ────────────────────────────`)
  lines.push(`Topic: ${topic}  |  Count: ${ids.length}`)
  lines.push(``)

  for (const id of ids.slice(0, 20)) {
    const finding = findingStore.load(topic, id)
    if (!finding) continue
    lines.push(`[${finding.findingId}] ${finding.findingKind} | ${finding.decisionRelevance}`)
    lines.push(`  ${finding.statement.slice(0, 80)}${finding.statement.length > 80 ? "..." : ""}`)
    lines.push(`  evidence=${finding.supportedByEvidenceIds.length}  agg=${finding.aggregationLevel}`)
    if (finding.conflictsWithReferenceFactIds.length) {
      lines.push(`  conflictsWithReference=${finding.conflictsWithReferenceFactIds.length}`)
    }
    lines.push(``)
  }
  if (ids.length > 20) lines.push(`  ... and ${ids.length - 20} more`)
  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

function showEvidence(
  dataDir: string,
  intentId: string,
  evidenceStore: EvidenceStore,
): string {
  const topic = intentId as IntelligenceTopic
  const ids = evidenceStore.list(topic)
  if (ids.length === 0) {
    return `\n── Evidence ────────────────────────────\n  (no evidence yet — run /run radar first)\n─────────────────────────────────\n`
  }

  const lines: string[] = []
  lines.push(`\n── Evidence ────────────────────────────`)
  lines.push(`Topic: ${topic}  |  Count: ${ids.length}`)
  lines.push(``)

  for (const id of ids.slice(0, 15)) {
    const ev = evidenceStore.load(topic, id)
    if (!ev) continue
    lines.push(`[${ev.evidenceId}] source=${ev.sourceId} conf=${ev.confidence?.toFixed(2)}`)
    lines.push(`  ${ev.normalizedText.slice(0, 80)}${ev.normalizedText.length > 80 ? "..." : ""}`)
    lines.push(``)
  }
  if (ids.length > 15) lines.push(`  ... and ${ids.length - 15} more`)
  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

function showDecisionDetail(
  dataDir: string,
  decisionId: string,
  intentId: string,
  decisionObjectStore: DecisionObjectStore,
  findingStore: FindingStore,
  evidenceStore: EvidenceStore,
  feedbackStore: HumanReviewFeedbackStore,
  evidenceRequestStore: EvidenceRequestStore,
): string {
  const topic = intentId as IntelligenceTopic
  const dObj = decisionObjectStore.load(topic, decisionId)
  if (!dObj) {
    return `\nDecision object "${decisionId}" not found.\n`
  }

  const lines: string[] = []
  lines.push(`\n── Decision Object: ${decisionId} ───`)
  lines.push(`Kind:     ${dObj.kind}`)
  lines.push(`Priority: ${dObj.priorityBand}`)
  lines.push(`Statement:`)
  lines.push(`  ${dObj.statement}`)
  lines.push(`Freshness: ${dObj.freshness}`)
  if (dObj.metricsImpact) {
    lines.push(`Metrics impact: ${dObj.metricsImpact.direction} / ${dObj.metricsImpact.strength}`)
  }

  // Show linked findings
  lines.push(``)
  lines.push(`Linked Findings (${dObj.supportedByFindingIds.length}):`)
  for (const fid of dObj.supportedByFindingIds) {
    const finding = findingStore.load(topic, fid)
    if (!finding) {
      lines.push(`  ${fid} — (not found)`)
      continue
    }
    lines.push(`  [${finding.findingId}] ${finding.findingKind} | ${finding.decisionRelevance}`)
    lines.push(`    ${finding.statement.slice(0, 80)}`)
    lines.push(`    evidence=${finding.supportedByEvidenceIds.length}`)
  }

  // Show structured feedback
  lines.push(``)
  const feedbacks = feedbackStore.listByDecisionObject(decisionId)
  if (feedbacks.length > 0) {
    lines.push(`Review Feedback (${feedbacks.length}):`)
    for (const fb of feedbacks) {
      lines.push(`  [${fb.feedbackId}] ${fb.resolution} by ${fb.reviewedBy} at ${fb.reviewedAt}`)
      lines.push(`    class: ${fb.feedbackClass}`)
      if (fb.humanReason) lines.push(`    reason: ${fb.humanReason.slice(0, 100)}`)
    }
  } else {
    lines.push(`Review Feedback: (none — use /review decision ${decisionId} to add)`)
  }

  // Show evidence requests
  lines.push(``)
  const requests = evidenceRequestStore.listByDecisionObject(decisionId)
  if (requests.length > 0) {
    lines.push(`Evidence Requests (${requests.length}):`)
    for (const req of requests) {
      lines.push(`  [${req.requestId}] ${req.requestedItem}`)
      lines.push(`    availability: ${req.availabilityStatus}  priority: ${req.priority}`)
      if (req.whyItMatters) lines.push(`    why it matters: ${req.whyItMatters.slice(0, 80)}`)
    }
  }

  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

function showRetrospectives(
  dataDir: string,
  retrospectiveStore: RetrospectiveCaseStore,
): string {
  const ids = retrospectiveStore.list()
  if (ids.length === 0) {
    return `\n── Retrospective Cases ──────────────────\n  (no retrospective cases yet)\n─────────────────────────────────\n`
  }

  const lines: string[] = []
  lines.push(`\n── Retrospective Cases ──────────────────`)
  lines.push(`Total: ${ids.length}`)
  lines.push(``)
  for (const id of ids) {
    const r = retrospectiveStore.load(id)
    if (!r) continue
    lines.push(`[${r.retrospectiveCaseId}] ${r.originalDecisionObjectId}`)
    lines.push(`  reopenReason: ${r.reopenReason}`)
    lines.push(`  misjudgment: ${r.misjudgmentType}`)
    lines.push(`  lessons: ${r.lessons.length}`)
    lines.push(``)
  }
  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

function showLearningMemory(
  dataDir: string,
  learningMemoryStore: LearningMemoryStore,
): string {
  const all = learningMemoryStore.list()
  if (all.length === 0) {
    return `\n── Learning Memory ─────────────────────\n  (no learning memory yet)\n─────────────────────────────────\n`
  }

  const lines: string[] = []
  lines.push(`\n── Learning Memory ─────────────────────`)
  lines.push(`Total: ${all.length}`)
  lines.push(``)

  const active = learningMemoryStore.listActive()
  if (active.length > 0) {
    lines.push(`Active (${active.length}):`)
    for (const m of active) {
      lines.push(`  [${m.memoryId}] ${m.memoryType} | ${m.confidence}`)
      lines.push(`    ${m.statement.slice(0, 80)}`)
      lines.push(`    reviewAfter: ${m.reviewAfter}  supersedes: ${m.supersedesMemoryId ?? "(none)"}`)
    }
    lines.push(``)
  }

  const candidate = learningMemoryStore.listCandidate()
  if (candidate.length > 0) {
    lines.push(`Candidate (${candidate.length}):`)
    for (const m of candidate) {
      lines.push(`  [${m.memoryId}] ${m.memoryType}`)
      lines.push(`    ${m.statement.slice(0, 80)}`)
    }
    lines.push(``)
  }

  const superseded = learningMemoryStore.listByStatus("superseded")
  const expired = learningMemoryStore.listByStatus("expired")
  lines.push(`Superseded: ${superseded.length}  |  Expired: ${expired.length}`)
  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

async function main(): Promise<void> {
  const intentArg = process.argv.find(a => a.startsWith("--intent="))
  const intentId = intentArg ? intentArg.split("=")[1]! : "riplus-ma"

  let intent = loadIntent(intentId)
  const strategyManager = new ActiveStrategyManager()
  const lastRunStore = new LastRunStore(DATA_DIR)
  const searchContextStore = new SearchContextStore(CONFIG_DIR)
  const knowledgeBaseStore = new KnowledgeBaseStore(CONFIG_DIR)
  const knowledgePackStore = new KnowledgePackStore(CONFIG_DIR)
  const meetingCharterStore = new MeetingCharterStore(CONFIG_DIR)
  const knowledgeBriefStore = new KnowledgeBriefStore(CONFIG_DIR)
  const modelConfigStore = new ModelConfigStore(CONFIG_DIR)
  const runContextStore = new RunContextStore(DATA_DIR)
  const scoutPlanStore = new ScoutPlanStore(DATA_DIR)
  const meetingRecordStore = new MeetingRecordStore(DATA_DIR)
  const decisionObjectStore = new DecisionObjectStore(DATA_DIR)
  const findingStore = new FindingStore(DATA_DIR)
  const evidenceStore = new EvidenceStore(DATA_DIR)
  const feedbackStore = new HumanReviewFeedbackStore(DATA_DIR)
  const evidenceRequestStore = new EvidenceRequestStore(DATA_DIR)
  const retrospectiveStore = new RetrospectiveCaseStore(DATA_DIR)
  const learningMemoryStore = new LearningMemoryStore(DATA_DIR)
  let running = false

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  })

  console.log(`\nRadar CLI — intent: ${intentId}`)
  console.log(`Commands: /state  /model  /models  /undo  /reset  /review  /why <signalId>  /plan [cycleId]  /audit <cycleId|signalId>  /decisions  /findings  /evidence  /review decision <id>  /review feedback  /retrospective  /learning  /run radar  /run knowledge  /help  /exit`)
  console.log(`Natural language: describe what you want to adjust\n`)

  // Pending persistent-change confirmation state
  type PendingConfirm = { onConfirm: () => string; onCancel: () => string }
  let pendingConfirm: PendingConfirm | null = null

  rl.prompt()

  rl.on("line", async (rawLine: string) => {
    const line = rawLine.trim()

    if (!line) {
      rl.prompt()
      return
    }

    // ── Pending confirmation (y/n for persistent change) ──────────────────
    if (pendingConfirm) {
      const answer = line.toLowerCase()
      if (answer === "y" || answer === "yes") {
        console.log(pendingConfirm.onConfirm())
        // Reload intent so subsequent /state shows updated truth
        intent = loadIntent(intentId)
      } else {
        console.log(pendingConfirm.onCancel())
      }
      pendingConfirm = null
      rl.prompt()
      return
    }

    // ── Built-in commands ─────────────────────────────────────────────────
    if (line === "/exit" || line === "/quit") {
      console.log("Exiting.")
      rl.close()
      return
    }

    if (line === "/state") {
      const searchCtx = searchContextStore.load(intentId)
      const knowledgeBase = knowledgeBaseStore.load(intentId)
      const kpack = knowledgePackStore.load(intentId)
      const charter = meetingCharterStore.load(intentId)
      const kbrief = knowledgeBriefStore.load(intentId)
      const lastRun = lastRunStore.load()

      // For knowledge runs, the Knowledge Pack / Knowledge Base from the last run
      // may differ from the accepted-pack / pre-run state. Show the last-run version.
      const effectiveKb = lastRun?.runType === "knowledge" && lastRun.knowledgeBase
        ? lastRun.knowledgeBase
        : summarizeKnowledgeBase(knowledgeBase)
      const effectivePack = lastRun?.runType === "knowledge" && lastRun.knowledgePack
        ? lastRun.knowledgePack
        : summarizeKnowledgePack(kpack)

      // When last run was a knowledge run, pass the accepted pack separately so printState
      // can show both the candidate (effectivePack) and the accepted pack context.
      const acceptedPack = lastRun?.runType === "knowledge" && kpack
        ? summarizeKnowledgePack(kpack)
        : undefined

      printState(
        intent,
        strategyManager.get(),
        lastRun,
        summarizeSearchContext(searchCtx),
        effectiveKb,
        effectivePack,
        summarizeMeetingCharter(charter),
        summarizeKnowledgeBrief(kbrief),
        acceptedPack,
      )
      rl.prompt()
      return
    }

    if (line === "/model") {
      const persistedConfig = modelConfigStore.load(intentId)
      const config = persistedConfig ?? createDefaultModelConfig(intentId)
      console.log(renderModelConfig(intentId, config, Boolean(persistedConfig)))
      rl.prompt()
      return
    }

    if (line === "/models" || line === "/models all") {
      const freeOnly = line !== "/models all"
      try {
        const config = modelConfigStore.loadOrDefault(intentId)
        const models = await listOpenRouterModels()
        console.log(renderOpenRouterModels(models, config, freeOnly))
      } catch (err) {
        console.error(`Failed to load OpenRouter models: ${err}`)
      }
      rl.prompt()
      return
    }

    if (line.startsWith("/model ")) {
      const [, rawLayer = "", ...modelParts] = line.split(/\s+/)
      const modelId = modelParts.join(" ").trim()

      if (!isModelLayer(rawLayer) || !modelId) {
        console.log("Usage: /model <search|meeting|consumer.prototypeBrief> <openrouter-model-id>")
        rl.prompt()
        return
      }

      try {
        const models = await listOpenRouterModels()
        const model = models.find(item => item.id === modelId)
        if (!model) {
          console.log(`Model not found in OpenRouter catalog: ${modelId}`)
          rl.prompt()
          return
        }
        if (!isTextCapableModel(model)) {
          console.log(`Model is not text-capable and cannot be used for this layer: ${modelId}`)
          rl.prompt()
          return
        }
        if (!model.isFree) {
          console.log(`Only free OpenRouter models are supported in this phase. Rejected: ${modelId}`)
          rl.prompt()
          return
        }

        const currentConfig = modelConfigStore.loadOrDefault(intentId)
        const nextConfig = setLayerSelection(currentConfig, rawLayer, {
          provider: "openrouter",
          model: model.id,
          freeOnly: true,
        })
        modelConfigStore.save(intentId, nextConfig)

        console.log(`Saved ${rawLayer} model → ${model.id}`)
        if (rawLayer === "meeting") {
          console.log(`Note: meeting model slot is persisted now, but current runtime may still share the CommercialAnalyst/search execution path.`)
        }
      } catch (err) {
        console.error(`Failed to set model: ${err}`)
      }

      rl.prompt()
      return
    }

    if (line === "/undo") {
      const undone = strategyManager.undoLast()
      if (undone) {
        console.log(`已撤销: patch #${undone.seq}  ${undone.field} ← "${undone.trigger}"`)
      } else {
        console.log("没有可撤销的 session patch。")
      }
      rl.prompt()
      return
    }

    if (line === "/reset") {
      strategyManager.clear()
      console.log("已清除所有 session patches。Active Strategy 已重置。")
      rl.prompt()
      return
    }

    // ── /review — show last run summary ─────────────────────────────────────
    if (line === "/review") {
      const output = reviewRun(DATA_DIR, runContextStore, lastRunStore, intentId)
      console.log(output)
      rl.prompt()
      return
    }

    // ── /why {signalId} — explain a signal's triage decision ─────────────────
    if (line.startsWith("/why ")) {
      const signalId = line.slice(4).trim()
      if (!signalId) {
        console.log("Usage: /why <signalId>")
        rl.prompt()
        return
      }
      const output = explainSignal(signalId, DATA_DIR, runContextStore)
      console.log(output)
      rl.prompt()
      return
    }

    // ── /plan [cycleId] — show Scout Plan for a cycle ─────────────────────────
    if (line.startsWith("/plan")) {
      const parts = line.split(/\s+/)
      const targetCycleId = parts[1]?.trim()
      const planOutput = showPlan(scoutPlanStore, targetCycleId, runContextStore, intentId)
      console.log(planOutput)
      rl.prompt()
      return
    }

    // ── /audit {cycleId|signalId} — audit trail for a cycle or signal ─────────
    if (line.startsWith("/audit ")) {
      const target = line.slice(7).trim()
      if (!target) {
        console.log("Usage: /audit <cycleId|signalId>")
        rl.prompt()
        return
      }
      const output = showAudit(target, DATA_DIR, scoutPlanStore, runContextStore, meetingRecordStore)
      console.log(output)
      rl.prompt()
      return
    }

    // ── /decisions — show all DecisionObjects ────────────────────────────────
    if (line === "/decisions") {
      const output = showDecisions(DATA_DIR, intentId, decisionObjectStore, findingStore, evidenceStore)
      console.log(output)
      rl.prompt()
      return
    }

    // ── /findings — show all Findings ───────────────────────────────────────
    if (line === "/findings") {
      const output = showFindings(DATA_DIR, intentId, findingStore, evidenceStore)
      console.log(output)
      rl.prompt()
      return
    }

    // ── /evidence — show all Evidence ───────────────────────────────────────
    if (line === "/evidence") {
      const output = showEvidence(DATA_DIR, intentId, evidenceStore)
      console.log(output)
      rl.prompt()
      return
    }

    // ── /review decision {id} — show detail for a DecisionObject ───────────────
    if (line.startsWith("/review decision ")) {
      const parts = line.slice("/review decision ".length).trim().split(/\s+/)
      const decisionId = parts[0]
      if (!decisionId) {
        console.log("Usage: /review decision <decisionObjectId>")
        console.log("       /review decision <decisionObjectId> <resolution> [feedback-class] [reason]")
        console.log("Resolutions: approve | reject | defer | watch | escalate")
        console.log("Feedback classes: not_real_opportunity | insufficient_evidence | wrong_timing | not_strategic_now | duplicate | already_known | cannot_execute_now | other")
        rl.prompt()
        return
      }

      // If no resolution argument, just show the detail
      if (parts.length < 2) {
        const output = showDecisionDetail(
          DATA_DIR, decisionId, intentId,
          decisionObjectStore, findingStore, evidenceStore,
          feedbackStore, evidenceRequestStore,
        )
        console.log(output)
        rl.prompt()
        return
      }

      // Parse structured review arguments
      const resolutionArg = parts[1]!.toLowerCase()
      const validResolutions = ["approve", "reject", "defer", "watch", "escalate"]
      if (!validResolutions.includes(resolutionArg)) {
        console.log(`Invalid resolution "${resolutionArg}". Valid: ${validResolutions.join(", ")}`)
        rl.prompt()
        return
      }
      const resolution = resolutionArg as ReviewResolution

      const feedbackClassArg = parts[2]?.toLowerCase().replace(/-/g, "_") ?? "other"
      const validFeedbackClasses = [
        "not_real_opportunity", "insufficient_evidence", "wrong_timing", "not_strategic_now",
        "duplicate", "already_known", "cannot_execute_now", "other",
      ]
      const feedbackClass = validFeedbackClasses.includes(feedbackClassArg)
        ? feedbackClassArg as FeedbackClass
        : "other" as FeedbackClass

      const humanReason = parts.slice(3).join(" ") || "(no reason provided)"

      // Parse evidence request tokens: evreq:<item>:<priority>[:<availability>]
      const evidenceRequests: { requestedItem: string; whyItMatters: string; priority: "high" | "medium" | "low"; availabilityStatus: "available_now" | "available_later" | "not_available" | "unknown"; humanNote?: string }[] = []
      for (const part of parts.slice(3)) {
        if (part.startsWith("evreq:")) {
          const segments = part.slice(6).split(":")
          const requestedItem = segments[0] || ""
          const priority = (segments[1] as "high" | "medium" | "low") ?? "medium"
          const availabilityStatus = (segments[2] as "available_now" | "available_later" | "not_available" | "unknown") ?? "unknown"
          if (requestedItem) {
            evidenceRequests.push({ requestedItem, whyItMatters: "(no context provided)", priority, availabilityStatus })
          }
        }
      }

      const topic = intentId as IntelligenceTopic
      const dObj = decisionObjectStore.load(topic, decisionId)
      if (!dObj) {
        console.log(`Decision object "${decisionId}" not found.`)
        rl.prompt()
        return
      }

      const result = buildReviewConfirm({
        decisionObjectId: decisionId,
        decisionObjectStatement: dObj.statement,
        resolution,
        feedbackClass,
        humanReason,
        reviewedBy: "cli-user",
        evidenceRequests,
        onApply: (feedback, requests) => {
          feedbackStore.save(feedback)
          for (const req of requests) {
            evidenceRequestStore.save(req)
          }
          console.log(`\n✓ Structured review feedback written: ${feedback.feedbackId}`)
          console.log(`  Decision: ${RESOLUTION_LABELS[feedback.resolution]}`)
          console.log(`  Class: ${FEEDBACK_CLASS_LABELS[feedback.feedbackClass]}`)
          if (feedback.humanReason) console.log(`  Reason: ${feedback.humanReason}`)
          if (requests.length > 0) console.log(`  Evidence requests: ${requests.length} created`)
        },
      })

      pendingConfirm = {
        onConfirm: () => { result.onConfirm(); return result.preview + "\n\n✓ Confirmed." },
        onCancel: () => result.onCancel(),
      }
      console.log(`\n── /review decision ${decisionId} ───────────────────`)
      console.log(result.preview)
      rl.prompt()
      return
    }

    // ── /review feedback — show review feedback summary ───────────────────────
    // ── /retrospective — show all retrospective cases ─────────────────────────
    if (line === "/retrospective") {
      const output = showRetrospectives(DATA_DIR, retrospectiveStore)
      console.log(output)
      rl.prompt()
      return
    }

    // ── /learning — show all learning memory ──────────────────────────────────
    if (line === "/learning") {
      const output = showLearningMemory(DATA_DIR, learningMemoryStore)
      console.log(output)
      rl.prompt()
      return
    }

    if (line === "/review feedback") {
      const allFeedback = feedbackStore.list()
      const lines: string[] = []
      lines.push(`\n── Structured Review Feedback ─────────────`)
      lines.push(`Total: ${allFeedback.length}`)
      lines.push(``)
      for (const fid of allFeedback.slice(0, 20)) {
        const fb = feedbackStore.load(fid)
        if (!fb) continue
        lines.push(`[${fb.feedbackId}] ${fb.decisionObjectId} | ${fb.resolution}`)
        lines.push(`  class=${fb.feedbackClass}  by=${fb.reviewedBy}`)
      }
      if (allFeedback.length > 20) lines.push(`  ... and ${allFeedback.length - 20} more`)
      lines.push(`─────────────────────────────────\n`)
      console.log(lines.join("\n"))
      rl.prompt()
      return
    }

    if (line === "/run" || line === "/run radar") {
      if (running) { console.log("Pipeline is already running. Please wait."); rl.prompt(); return }
      running = true
      console.log(`\nExecuting radar workflow — intent=${intentId}...`)
      try {
        // Load persistent context objects for this run
        const searchCtx = searchContextStore.load(intentId) ?? undefined
        const kbase = knowledgeBaseStore.load(intentId) ?? undefined
        const kpack = knowledgePackStore.load(intentId) ?? undefined
        const charter = meetingCharterStore.load(intentId) ?? undefined
        const kbrief = knowledgeBriefStore.load(intentId) ?? undefined

        const result = await runPipeline({
          intent,
          dataDir: DATA_DIR,
          strategy: strategyManager.get(),
          useCommercialAnalyst: process.env.USE_COMMERCIAL_ANALYST === "true",
          searchContext: searchCtx,
          knowledgeBase: kbase,
          knowledgePack: kpack,
          meetingCharter: charter,
          knowledgeBrief: kbrief,
        })

        // Note: RunContext is saved by runPipeline() itself (ScoutPlan + RunContext)
        // LastRunSummary is a separate lightweight snapshot for quick CLI queries
        const cycleId = result.cycleId

        const summary: LastRunSummary = {
          timestamp: new Date().toISOString(),
          intentId: intent.id,
          cycleId: result.cycleId,
          runType: "radar",
          sessionPatchCount: strategyManager.get().patches.length,
          sources: Object.entries(result.sourceCounts).map(([name, count]) => ({
            name,
            sourceType: getSourceWorkflowType(name),
            legacyRole: inferDefaultSourceRole(name),
            signalCount: count,
          })),
          pipeline: {
            ingested: result.ingested,
            scored: result.scored,
            qualified: result.qualifiedCount,
            enqueuedForTriage: result.enqueuedForTriage,
          },
          searchContext: summarizeSearchContext(searchCtx),
          knowledgeBase: summarizeKnowledgeBase(kbase),
          knowledgePack: summarizeKnowledgePack(kpack),
          meetingCharter: summarizeMeetingCharter(charter),
          knowledgeBrief: summarizeKnowledgeBrief(kbrief),
        }
        lastRunStore.save(summary)
        console.log(`\nDone. ${result.ingested} ingested → ${result.scored} scored → ${result.approved} approved → ${result.opportunities} opportunities`)
        console.log(`Radar Run saved. Use /state to view.`)
      } catch (err) {
        console.error(`Radar workflow failed: ${err}`)
      } finally {
        running = false
      }
      rl.prompt()
      return
    }

    if (line === "/run knowledge") {
      if (running) { console.log("Workflow is already running. Please wait."); rl.prompt(); return }
      running = true
      console.log(`\nExecuting knowledge workflow — intent=${intentId}...`)
      try {
        const kbrief = knowledgeBriefStore.load(intentId) ?? undefined
        const kbase = knowledgeBaseStore.load(intentId) ?? undefined
        const kpack = knowledgePackStore.load(intentId) ?? undefined
        const charter = meetingCharterStore.load(intentId) ?? undefined
        const searchCtx = searchContextStore.load(intentId) ?? undefined

        const result = await runKnowledgeWorkflow({
          intent,
          dataDir: DATA_DIR,
          configDir: CONFIG_DIR,
          knowledgeBrief: kbrief,
          knowledgeBase: kbase,
          knowledgePack: kpack ?? undefined,
          runContextStore,
          meetingCharter: charter,
          searchContext: searchCtx,
        })

        // Reload post-run artifacts so LastRunSummary reflects reality
        const postKbase = knowledgeBaseStore.load(intentId) ?? undefined
        const postKpack = knowledgePackStore.loadCandidate(result.candidatePackId)

        const summary: LastRunSummary = {
          timestamp: new Date().toISOString(),
          intentId: intent.id,
          cycleId: result.cycleId,
          runType: "knowledge",
          sessionPatchCount: 0,
          sources: result.sourcesPolled.map(name => ({
            name,
            sourceType: "knowledge_source" as const,
            signalCount: result.entriesInspected,
          })),
          pipeline: {
            ingested: result.entriesInspected,
            scored: result.newEntriesCount,
            qualified: 0,
            enqueuedForTriage: 0,
          },
          knowledgeBrief: summarizeKnowledgeBrief(kbrief),
          knowledgeBase: summarizeKnowledgeBase(postKbase),
          knowledgePack: summarizeKnowledgePack(postKpack ?? undefined),
        }
        lastRunStore.save(summary)
        console.log(`\nDone. Knowledge Run produced candidate pack: ${result.candidatePackId}`)
        console.log(`Use /review to inspect. Accept with /tell pack accept ${result.candidatePackId}`)
      } catch (err) {
        console.error(`Knowledge workflow failed: ${err}`)
      } finally {
        running = false
      }
      rl.prompt()
      return
    }

    // ── /tell — unified control-surface mutation ─────────────────────────────
    if (line.startsWith("/tell") && (line.length === 5 || line[5] === " ")) {
      const parts = line.slice(6).trim().split(/\s+/)
      const surface = parts[0]?.toLowerCase()
      const rest = parts.slice(1)
      const inputText = rest.join(" ")

      // /tell pack accept <id>
      if (surface === "pack" && rest[0] === "accept") {
        const packId = rest[1]
        if (!packId) {
          console.log("Usage: /tell pack accept <candidate-pack-id>")
          rl.prompt()
          return
        }
        // Accept a candidate pack: copies it to the accepted path and sets status=accepted
        const success = knowledgePackStore.acceptCandidate(packId)
        if (!success) {
          console.log(`Knowledge Pack "${packId}" not found in candidates. Run /run knowledge first to produce a candidate pack.`)
          rl.prompt()
          return
        }
        console.log(`\n── /tell pack accept ────────────────────`)
        console.log(`Knowledge Pack "${packId}" has been ACCEPTED.`)
        console.log(`It is now the default knowledge source for /run radar.`)
        console.log(`────────────────────────────────────────\n`)
        rl.prompt()
        return
      }

      if (!surface) {
        console.log([
          "Usage:",
          "  /tell intent <text>     — preview → confirm → apply Intent changes",
          "  /tell scout <text>      — preview → confirm → apply Scout Brief changes",
          "  /tell knowledge <text> — preview → confirm → apply Knowledge Brief changes",
          "  /tell meeting <text>   — preview → confirm → apply Meeting Goal changes",
          "  /tell pack accept <id> — accept a candidate Knowledge Pack immediately",
        ].join("\n"))
        rl.prompt()
        return
      }

      const validSurfaces = ["intent", "scout", "knowledge", "meeting"]
      if (!validSurfaces.includes(surface)) {
        console.log(`Unknown surface: ${surface}. Valid: ${validSurfaces.join(", ")}, pack`)
        rl.prompt()
        return
      }

      if (!inputText) {
        console.log(`Usage: /tell ${surface} <text>`)
        rl.prompt()
        return
      }

      // ── /tell intent — delegate to existing buildPatchAction ─────────────────
      if (surface === "intent") {
        const action = buildPatchAction(inputText, intent, strategyManager, intentPath(intentId))

        if (action.type === "persistent_confirm") {
          pendingConfirm = { onConfirm: action.onConfirm, onCancel: action.onCancel }
          console.log(`\n── /tell intent ─────────────────────────`)
          console.log(`Input: "${inputText}"`)
          console.log(action.preview)
          rl.prompt()
          return
        }

        if (action.type === "session_applied") {
          console.log(`\n${action.message}`)
          rl.prompt()
          return
        }

        console.log(`\n${action.message}`)
        rl.prompt()
        return
      }

      // ── /tell scout ──────────────────────────────────────────────────────────
      if (surface === "scout") {
        const currentScout = searchContextStore.load(intentId)
        const { preview, onConfirm, onCancel } = buildScoutBriefConfirm(inputText, currentScout, CONFIG_DIR, intentId)
        pendingConfirm = { onConfirm, onCancel }
        console.log(`\n── /tell scout ─────────────────────────`)
        console.log(`Input: "${inputText}"`)
        console.log(preview)
        rl.prompt()
        return
      }

      // ── /tell knowledge ──────────────────────────────────────────────────────
      if (surface === "knowledge") {
        const currentKb = knowledgeBriefStore.load(intentId)
        const { preview, onConfirm, onCancel } = buildKnowledgeBriefConfirm(inputText, currentKb, CONFIG_DIR, intentId)
        pendingConfirm = { onConfirm, onCancel }
        console.log(`\n── /tell knowledge ───────────────────────`)
        console.log(`Input: "${inputText}"`)
        console.log(preview)
        rl.prompt()
        return
      }

      // ── /tell meeting ────────────────────────────────────────────────────────
      if (surface === "meeting") {
        const currentMg = meetingCharterStore.load(intentId)
        const { preview, onConfirm, onCancel } = buildMeetingGoalConfirm(inputText, currentMg, CONFIG_DIR, intentId)
        pendingConfirm = { onConfirm, onCancel }
        console.log(`\n── /tell meeting ─────────────────────────`)
        console.log(`Input: "${inputText}"`)
        console.log(preview)
        rl.prompt()
        return
      }
    }

    if (line === "/help") {
      console.log([
        "",
        "Commands:",
        "  /state          — 查看 Intent / Scout Brief / Knowledge Brief / Knowledge Base / Knowledge Pack / Meeting Goal / Last Run",
        "  /decisions      — 查看所有 DecisionObjects（治理对象）",
        "  /findings       — 查看所有 Findings（判断对象）",
        "  /evidence       — 查看所有 Evidence（证据单元）",
        "  /review decision <id> — 查看特定 DecisionObject 详情",
        "  /review decision <id> <resolution> [class] [reason] — 写入结构化 review 反馈",
        "  /review feedback — 查看结构化 review 反馈摘要",
        "  /retrospective  — 查看所有回顾案例",
        "  /learning       — 查看所有学习记忆",
        "  /model          — 查看当前 search / meeting / consumer.prototypeBrief 的模型配置",
        "  /model <layer> <modelId> — 为某一层设置 OpenRouter free model",
        "  /models         — 实时列出 OpenRouter free 文本模型",
        "  /models all     — 实时列出 OpenRouter 全部文本模型",
        "  /undo           — 撤销最后一个 session patch",
        "  /reset          — 清除所有 session patches",
        "  /review         — 查看最近一次 /run 的完整报告（含 pipeline 统计和上下文快照）",
        "  /why <signalId> — 查看某个 signal 的 triage 决定原因",
        "  /plan [cycleId] — 查看 Scout Plan（Scout Commander 生成的审计计划）",
        "  /audit <target> — 查看 cycle 或 signal 的完整审计记录（plan + execution + meeting）",
        "  /run radar      — 执行 outward radar workflow，并保存 explainability 快照",
        "  /run knowledge  — 执行 inward knowledge workflow，更新 Knowledge Base，生成候选 Knowledge Pack",
        "  /tell <surface> <text> — 修改 Intent / Scout Brief / Knowledge Brief / Meeting Goal（预览 → 确认 → 应用）",
        "  /tell pack accept <id> — 接受候选 Knowledge Pack，使其成为 Radar Run 的默认知识源",
        "  /exit           — 退出",
        "",
        "Model layers:",
        "  search                  → CommercialAnalyst / search-stage OpenRouter model",
        "  meeting                 → meeting/deliberation slot (currently may share search execution path)",
        "  consumer.prototypeBrief → PrototypeBriefConsumer OpenRouter model",
        "",
        "Persistent change (preview-first — default for relevantThreshold/excludeTags):",
        '  "降低相关度门槛到 0.2"        → structured preview → confirm → persistent change',
        '  "从现在起都排除 demo 标签"    → structured preview → confirm → persistent change',
        '  "从现在起相关度门槛改为 0.5"  → structured preview → confirm → persistent change',
        "",
        "Session patch (explicit scope marker required — applies to this session only):",
        '  "这轮只看保险方向"            → immediate apply, focus for this session only',
        '  "这轮降低相关度门槛到 0.2"    → immediate apply, threshold for this session only',
        '  "暂停 confluence"             → immediate apply, pause for this session only',
        "",
        "Keywords:",
        '  "从现在起" "永久" "一直" "以后都"   → persistent (structured preview + y/n)',
        '  "这轮" "先" "暂时" "临时"           → session patch (immediate, no preview)',
        '  (no keyword)                      → persistent change (preview-first)',
        "",
      ].join("\n"))
      rl.prompt()
      return
    }

    // ── Natural language patch handling ───────────────────────────────────
    const action = buildPatchAction(line, intent, strategyManager, intentPath(intentId))

    switch (action.type) {
      case "session_applied":
        console.log(action.message)
        break

      case "persistent_confirm":
        console.log(action.preview)
        pendingConfirm = { onConfirm: action.onConfirm, onCancel: action.onCancel }
        // Do NOT call rl.prompt() — wait for the y/n answer
        return

      case "no_op":
        console.log(action.message)
        break

      case "unrecognized":
        console.log(action.message)
        break
    }

    rl.prompt()
  })

  rl.on("close", () => {
    process.exit(0)
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
