/**
 * radar-cli.ts — interactive CLI for the Prototype Radar.
 *
 * Runtime model (graph-native, Scout-first):
 *   ScoutTarget    — the source being ingested (local dir, file, URL)
 *   SourceArtifact — raw artifact from ScoutTarget
 *   KnowledgeSection — chunked section of an artifact
 *   Evidence       — extracted claim from a section
 *   ReferenceFact  — promoted, stable fact from evidence
 *   Projection     — queryable read model over facts (CompetitivePack, DomainDossier, etc.)
 *   Intent         — persistent: what the radar is looking for and why
 *   Scout Brief    — persistent: how Scout searches, weights, suppresses
 *   Meeting Goal   — persistent: how the BA meeting room frames judgment
 *
 * Scout is the canonical write path into the Memgraph knowledge graph.
 * Projections are the canonical read path for all downstream consumers.
 *
 * Change flow: draft -> structured preview -> refine/rewrite -> confirm (y/n) -> apply
 *
 * Run: npx tsx src/cli/radar-cli.ts [--intent=default]
 */

import * as path from "path"
import * as fs from "fs"
import * as readline from "readline"
import type { RadarIntent } from "../schemas/intent.js"
import type { LastRunSummary } from "../state/last-run.js"
import { ActiveStrategyManager } from "../state/active-strategy.js"
import { LastRunStore } from "../state/last-run.js"
import { SearchContextStore } from "../state/search-context-store.js"
import { ScoutBriefStore } from "../state/scout-brief-store.js"
import type { ScoutBrief } from "../state/scout-brief.js"
import { ScoutPlanStore } from "../state/scout-plan-store.js"
import { KnowledgeBaseStore } from "../state/knowledge-base-store.js"
import { KnowledgePackStore } from "../state/knowledge-pack-store.js"
import { MeetingCharterStore } from "../state/meeting-charter-store.js"
import { MeetingGoalStore } from "../state/meeting-goal-store.js"
import type { MeetingGoal } from "../state/meeting-goal.js"
import { KnowledgeBriefStore } from "../state/knowledge-brief-store.js"
import { ModelConfigStore } from "../state/model-config-store.js"
import { RunContextStore } from "../state/run-context-store.js"
import { MeetingRecordStore } from "../state/meeting-record-store.js"
import { DecisionObjectStore } from "../state/decision-object-store.js"
import { FindingStore } from "../state/finding-store.js"
import { EvidenceStore } from "../state/evidence-store.js"
import { DecisionCardStore } from "../state/decision-card-store.js"
import type { DecisionCard } from "../state/decision-card.js"
import { HumanReviewFeedbackStore } from "../state/human-review-feedback-store.js"
import { EvidenceRequestStore } from "../state/evidence-request-store.js"
import { RetrospectiveCaseStore } from "../state/retrospective-case-store.js"
import type { MisjudgmentType } from "../state/retrospective-case.js"
import { LearningMemoryStore } from "../state/learning-memory-store.js"
import type { LearningMemoryType } from "../state/learning-memory.js"
import { RetrospectiveCandidateStore } from "../state/retrospective-candidate-store.js"
import type { RetrospectiveCandidate } from "../state/retrospective-candidate.js"
import { ReferenceFactStore } from "../state/reference-fact-store.js"
import { StagedKnowledgeStore } from "../state/staged-knowledge-store.js"
import type { StagedKnowledgeBundle } from "../state/staged-knowledge.js"
import { GraphMappingPlanStore } from "../state/graph-mapping-plan-store.js"
import type { GraphMappingPlan } from "../state/graph-mapping-plan.js"
import { buildMeetingContextEnvelope } from "../state/context-envelopes.js"
import { evaluateDecisionObjectWithMeetingRoom } from "../state/ba-meeting-room.js"
import { buildReviewConfirm, buildRetrospectiveConfirm, buildLearningMemoryConfirm, RESOLUTION_LABELS, FEEDBACK_CLASS_LABELS, MISJUDGMENT_LABELS, LEARNING_MEMORY_TYPE_LABELS } from "./review-handler.js"
import type { IntelligenceTopic } from "../state/intelligence-layout.js"
import type { ReviewResolution, FeedbackClass } from "../state/human-review-feedback.js"
import type { EvidenceAvailabilityStatus } from "../state/evidence-request.js"
import type { CommercialAssessment } from "../schemas/commercial-assessment.js"
import { printState } from "../state/state-printer.js"
import { summarizeKnowledgeBase, summarizeKnowledgePack, summarizeMeetingCharter, summarizeSearchContext, summarizeKnowledgeBrief } from "../state/context-summary.js"
import { buildPatchAction } from "./patch-handler.js"
import { runPipeline } from "../orchestrator/run-pipeline.js"
import { buildScoutBriefConfirm, buildMeetingGoalConfirm } from "./tell-handler.js"
import {
  draftScoutBrief,
  draftMeetingGoal,
  renderBriefPreview,
  confirmScoutBrief,
  confirmMeetingGoal,
  supersedeScoutBrief,
  supersedeMeetingGoal,
  scoutBriefToSearchContext,
  meetingGoalToCharter,
} from "./brief-handler.js"
import { renderInbox, renderPendingSummary } from "./inbox-handler.js"
import { renderDecisionCardMarkdown, parseCardMarkdown, newRetrospectiveCandidateId } from "./card-submit-handler.js"
import { deliberateMeetingPacket, renderMeetingPacketDeliberation } from "./meeting-packet-handler.js"
import { renderTrace } from "./trace-handler.js"
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
import { bootstrapGraph, getGraphStats, checkHealth, clearGraph } from "../infrastructure/memgraph-bootstrap.js"
import { loadMemgraphConfig, memgraphBoltUrl } from "../infrastructure/memgraph-config.js"
import { isConnected } from "../infrastructure/memgraph-connection.js"
import { createRadarRuntime, loadIntent, DATA_DIR } from "./radar-runtime.js"
import { scoutIngest, scoutRefresh } from "../orchestrator/scout-graph-ingestion.js"
import { stageScoutKnowledge } from "../orchestrator/scout-knowledge-staging.js"
import { draftGraphMappingPlan, applyGraphMappingPlan } from "../orchestrator/graph-mapping-plan.js"
import {
  getKnowledgePackage,
  listKnowledgePackages,
  getSourceArtifact,
  findArtifactsByPackage,
  findSectionsByArtifact,
  findEvidenceBySection,
  findFactsByEvidence,
  getProjection,
  findProjectionsByPackage,
  findProjectionsByKind,
  findProjectionByKey,
  findPackageByProjection,
  findFactsByProjection,
  getScoutTarget,
  traceProjection,
  traceReferenceFact,
  getPackageStatus,
  getScoutTargetForPath,
} from "../state/graph/repositories.js"

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
      lines.push(`  status: candidate  ← this is the latest knowledge run candidate`)
    } else {
      lines.push(`  status: ${status}`)
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
    if (finding.metricsContext?.notes?.length) {
      const scoreNote = finding.metricsContext.notes.find(n => n.startsWith("opportunityScore="))
      if (scoreNote) lines.push(`  opportunityScore=${scoreNote.split("=")[1]}`)
    }
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
  meetingRecordStore: MeetingRecordStore,
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
    const scoreNote = dObj.metricsImpact.context?.notes?.find(n => n.startsWith("opportunityScore="))
    lines.push(`Metrics impact: ${dObj.metricsImpact.direction} / ${dObj.metricsImpact.strength}${scoreNote ? ` (${scoreNote})` : ""}`)
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
  } else {
    lines.push(`Evidence Requests: (none)`)
  }

  // Show BA Meeting Room governance evaluation (if available)
  const mr = meetingRecordStore.loadForDecisionObject(decisionId)
  if (mr) {
    lines.push(``)
    lines.push(`BA Meeting Room Evaluation:`)
    lines.push(`  Chair: ${mr.lenses.chair.summary}`)
    lines.push(`  Opportunity: ${mr.lenses.opportunity.category} | impact=${mr.lenses.opportunity.commercialImpact} | fit=${mr.lenses.productFit.fitLevel}`)
    if (mr.lenses.chair.decisionRationale) {
      lines.push(`  Rationale: ${mr.lenses.chair.decisionRationale.slice(0, 100)}`)
    }
    if (mr.lenses.skeptic.weaknesses.length > 0) {
      lines.push(`  Skeptic concerns: ${mr.lenses.skeptic.weaknesses.join("; ")}`)
    }
    if (mr.lenses.opportunity.evidenceGaps.length > 0) {
      lines.push(`  Evidence gaps: ${mr.lenses.opportunity.evidenceGaps.slice(0, 3).join("; ")}`)
    }
  } else {
    lines.push(``)
    lines.push(`BA Meeting Room Evaluation: (not yet evaluated — run pipeline to generate)`)
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

function requireConfirmedScoutBrief(
  intentId: string,
  scoutBriefStore: ScoutBriefStore,
): ScoutBrief | null {
  return scoutBriefStore.loadCurrent(intentId)
}

function requireConfirmedMeetingGoal(
  intentId: string,
  meetingGoalStore: MeetingGoalStore,
): MeetingGoal | null {
  return meetingGoalStore.loadCurrent(intentId)
}

function decisionKindToCardKind(kind: string): "opportunity" | "risk" | "gap" | null {
  if (kind === "opportunity" || kind === "risk" || kind === "gap") return kind
  return null
}

function synthesizeAssessmentForDecisionObject(params: {
  intentId: string
  decision: import("../state/decision-object.js").DecisionObject
  findings: import("../state/finding.js").Finding[]
  meetingGoal: MeetingGoal
}): CommercialAssessment {
  const { decision, findings, meetingGoal, intentId } = params
  const strongestFinding = findings[0]
  const reasoningParts = [
    decision.statement,
    strongestFinding ? `Primary supporting finding: ${strongestFinding.statement}` : null,
    `Meeting lens: ${meetingGoal.decisionLens}`,
    `Priority bias: ${meetingGoal.priorityBias}`,
  ].filter((value): value is string => Boolean(value))
  const metricNotes = decision.metricsImpact?.context?.notes ?? []
  const missingEvidence = [
    ...new Set([
      ...findings.flatMap(f => f.supportedByEvidenceIds.length === 0 ? [`finding:${f.findingId} missing direct evidence linkage`] : []),
      ...(metricNotes.length === 0 ? ["metrics context is inferred-only; no operational metrics linked"] : []),
    ]),
  ]

  const category: CommercialAssessment["category"] =
    decision.kind === "opportunity"
      ? "growth_opportunity"
      : decision.kind === "gap"
        ? "feature_request"
        : "workflow_friction"

  return {
    signalId: `decision-${decision.decisionObjectId}`,
    commercialRelevance: decision.kind === "opportunity" || decision.kind === "gap",
    category,
    reasoning: reasoningParts.join(" | "),
    confidence: decision.priorityBand === "high" ? 0.8 : decision.priorityBand === "medium" ? 0.65 : 0.5,
    opportunityScore: decision.priorityBand === "high" ? 0.85 : decision.priorityBand === "medium" ? 0.65 : 0.45,
    verticalTags: [decision.topic],
    missingEvidence,
    attribution: {
      intentId,
      sourceAdapterId: "meeting-console",
      modelId: "rule-based",
      analyzedAt: new Date().toISOString(),
    },
    arrImpact: decision.metricsImpact?.context?.arr ? `$${decision.metricsImpact.context.arr}` : undefined,
    nrrImpact: decision.metricsImpact?.context?.nrr ? `${decision.metricsImpact.context.nrr}` : undefined,
    ndrImpact: decision.metricsImpact?.context?.ndr ? `${decision.metricsImpact.context.ndr}` : undefined,
  }
}

function buildDecisionCardFromDecisionObject(params: {
  intentId: string
  topic: string
  decision: import("../state/decision-object.js").DecisionObject
  findings: import("../state/finding.js").Finding[]
  meetingRecord: import("../state/meeting-record.js").MeetingRecord | null
  existingCard?: DecisionCard
}): DecisionCard | null {
  const kind = decisionKindToCardKind(params.decision.kind)
  if (!kind) return null
  const now = new Date().toISOString()
  const title = params.decision.statement.length > 72
    ? `${params.decision.statement.slice(0, 69)}...`
    : params.decision.statement
  const whyNow = params.decision.metricsImpact?.context?.notes?.join(" | ")
    ?? params.meetingRecord?.lenses.chair.summary
    ?? params.decision.statement
  const meetingRecommendation = params.meetingRecord
    ? `${params.meetingRecord.lenses.chair.finalDecision}: ${params.meetingRecord.lenses.chair.decisionRationale}`
    : "no meeting record available"
  return {
    cardId: `card-${params.decision.decisionObjectId}`,
    intentId: params.intentId,
    topic: params.topic,
    decisionObjectId: params.decision.decisionObjectId,
    kind,
    title,
    summary: params.decision.statement,
    whyNow,
    supportingFindingIds: params.findings.map(f => f.findingId),
    evidenceGapSummary: params.meetingRecord?.nextEvidenceNeeded ?? [],
    meetingRecommendation,
    status: params.existingCard?.status ?? "pending_human_review",
    createdAt: params.existingCard?.createdAt ?? now,
    updatedAt: now,
  }
}

function showStagedKnowledgeBundle(bundle: StagedKnowledgeBundle): void {
  const domains = Array.from(new Set(bundle.items.map(item => item.domain))).sort()
  const packageHints = Array.from(new Set(bundle.items.map(item => item.packageHint))).sort()
  console.log(`Bundle:         ${bundle.bundleId}`)
  console.log(`Intent:         ${bundle.intentProfile}`)
  console.log(`Direction:      ${bundle.researchDirection}`)
  console.log(`Status:         ${bundle.status}`)
  console.log(`Source targets: ${bundle.sourceLocators.length}`)
  console.log(`Items:          ${bundle.items.length}`)
  console.log(`Domains:        ${domains.join(", ") || "(none)"}`)
  console.log(`Packages:       ${packageHints.join(", ") || "(none)"}`)
  console.log(`Created:        ${bundle.createdAt}`)
  console.log(`Updated:        ${bundle.updatedAt}`)
  console.log(``)
  for (const item of bundle.items.slice(0, 8)) {
    console.log(`- ${item.title}`)
    console.log(`  domain=${item.domain}  subdomain=${item.subdomain}  package=${item.packageHint}`)
    console.log(`  source=${item.sourceLocator}`)
    console.log(`  factCandidate=${item.factCandidate ? "yes" : "no"}  projections=${item.projectionTargets.join(", ") || "(none)"}`)
  }
  if (bundle.items.length > 8) console.log(`  ... and ${bundle.items.length - 8} more items`)
}

function showGraphMappingPlan(plan: GraphMappingPlan): void {
  const targetKinds = Array.from(new Set(plan.entries.map(entry => entry.targetNodeKind))).sort()
  console.log(`Plan:           ${plan.planId}`)
  console.log(`Bundle:         ${plan.bundleId}`)
  console.log(`Status:         ${plan.status}`)
  console.log(`Targets:        ${plan.sourceLocators.length}`)
  console.log(`Entries:        ${plan.entries.length}`)
  console.log(`Kinds:          ${targetKinds.join(", ") || "(none)"}`)
  console.log(`Summary:        ${plan.summary}`)
  console.log(`Created:        ${plan.createdAt}`)
  console.log(`Updated:        ${plan.updatedAt}`)
  console.log(``)
  for (const entry of plan.entries.slice(0, 10)) {
    console.log(`- ${entry.targetNodeKind} -> ${entry.targetKey}`)
    console.log(`  ${entry.rationale}`)
  }
  if (plan.entries.length > 10) console.log(`  ... and ${plan.entries.length - 10} more entries`)
}

async function main(): Promise<void> {
  const intentArg = process.argv.find(a => a.startsWith("--intent="))
  const intentId = intentArg ? intentArg.split("=")[1]! : "default"

  const runtime = createRadarRuntime(intentId)
  let intent = runtime.intent
  const strategyManager = runtime.strategyManager
  const lastRunStore = runtime.lastRunStore
  const searchContextStore = runtime.searchContextStore
  const scoutBriefStore = runtime.scoutBriefStore
  const scoutPlanStore = runtime.scoutPlanStore
  const knowledgeBaseStore = runtime.knowledgeBaseStore
  const knowledgePackStore = runtime.knowledgePackStore
  const meetingCharterStore = runtime.meetingCharterStore
  const meetingGoalStore = runtime.meetingGoalStore
  const knowledgeBriefStore = runtime.knowledgeBriefStore
  const modelConfigStore = runtime.modelConfigStore
  const runContextStore = runtime.runContextStore
  const meetingRecordStore = runtime.meetingRecordStore
  const decisionObjectStore = runtime.decisionObjectStore
  const findingStore = runtime.findingStore
  const evidenceStore = runtime.evidenceStore
  const decisionCardStore = runtime.decisionCardStore
  const feedbackStore = runtime.feedbackStore
  const evidenceRequestStore = runtime.evidenceRequestStore
  const retrospectiveStore = runtime.retrospectiveStore
  const retrospectiveCandidateStore = runtime.retrospectiveCandidateStore
  const learningMemoryStore = runtime.learningMemoryStore
  const referenceFactStore = runtime.referenceFactStore
  const stagedKnowledgeStore = runtime.stagedKnowledgeStore
  const graphMappingPlanStore = runtime.graphMappingPlanStore
  let running = false

  // ── Graph helper functions ────────────────────────────────────────────────

  async function showPackageDetails(packageId: string): Promise<void> {
    const pkg = await getKnowledgePackage(packageId)
    if (!pkg) { console.log(`Package not found: ${packageId}`); return }
    console.log(`ID:             ${pkg.id}`)
    console.log(`Path:           ${pkg.package_path}`)
    console.log(`Kind:           ${pkg.package_kind}`)
    console.log(`Title:          ${pkg.title}`)
    console.log(`Confidence:     ${pkg.confidence}`)
    console.log(`Freshness:      ${pkg.freshness_status}`)
    console.log(`Last verified:  ${pkg.last_verified_at}`)
    console.log(`Created:        ${pkg.created_at}`)

    // Show artifacts
    const artifacts = await findArtifactsByPackage(packageId)
    console.log(`Artifacts:      ${artifacts.length}`)
    for (const art of artifacts.slice(0, 5)) {
      console.log(`  - ${art.id}  ${art.artifact_kind}  ${art.artifact_path_or_url}`)
    }
    if (artifacts.length > 5) console.log(`  ... and ${artifacts.length - 5} more`)

    // Show projections
    const projections = await findProjectionsByPackage(packageId)
    console.log(`Projections:    ${projections.length}`)
    for (const proj of projections) {
      console.log(`  - ${proj.id}  [${proj.projection_kind}] ${proj.title}`)
    }
  }

  async function showProjectionDetails(projectionId: string): Promise<void> {
    const proj = await getProjection(projectionId)
    if (!proj) { console.log(`Projection not found: ${projectionId}`); return }
    console.log(`ID:             ${proj.id}`)
    console.log(`Kind:           ${proj.projection_kind}`)
    console.log(`Key:            ${proj.projection_key}`)
    console.log(`Title:          ${proj.title}`)
    console.log(`Summary:        ${proj.summary}`)
    console.log(`Freshness:      ${proj.freshness_status}`)
    console.log(`Last verified:  ${proj.last_verified_at}`)
    console.log(`Created:        ${proj.created_at}`)
  }


  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  })

  console.log(`\nRadar CLI — intent: ${intentId}`)
  console.log(`Commands: /Brief  /scout  /review knowledge  /graph plan  /review graph  /graph apply  /meeting  /inbox  /pick  /reject  /defer  /watch  /submit card  /trace  /graph  /package  /projection  /help  /exit`)
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

    if (line === "/Brief" || line.startsWith("/Brief ")) {
      const promptText = line.slice("/Brief".length).trim()
      if (!promptText) {
        console.log("Usage: /Brief <prompt>")
        rl.prompt()
        return
      }
      const draftBrief = draftScoutBrief(promptText, intentId)
      const draftGoal = draftMeetingGoal(promptText, intentId)
      const preview = renderBriefPreview(draftBrief, draftGoal)
      pendingConfirm = {
        onConfirm: () => {
          const currentBrief = scoutBriefStore.loadCurrent(intentId)
          const currentGoal = meetingGoalStore.loadCurrent(intentId)
          if (currentBrief) scoutBriefStore.save(supersedeScoutBrief(currentBrief))
          if (currentGoal) meetingGoalStore.save(supersedeMeetingGoal(currentGoal))

          const confirmedBrief = confirmScoutBrief(draftBrief)
          const confirmedGoal = confirmMeetingGoal(draftGoal)
          scoutBriefStore.save(confirmedBrief)
          meetingGoalStore.save(confirmedGoal)
          searchContextStore.save(intentId, scoutBriefToSearchContext(confirmedBrief))
          meetingCharterStore.save(intentId, meetingGoalToCharter(confirmedGoal))
          return [
            `✓ Brief confirmed.`,
            `  ScoutBrief: ${confirmedBrief.briefId}`,
            `  MeetingGoal: ${confirmedGoal.meetingGoalId}`,
          ].join("\n")
        },
        onCancel: () => "Brief cancelled. Nothing written.",
      }
      console.log(`\n── /Brief ─────────────────────────────`)
      console.log(preview)
      rl.prompt()
      return
    }

    if (line === "/meeting" || line.startsWith("/meeting ")) {
      // ── Packet-first meeting retrieval ─────────────────────────────────────
      const meetingArg = line.slice("/meeting".length).trim()
      const renderPacketMeeting = async (packetProj: NonNullable<Awaited<ReturnType<typeof getProjection>>>) => {
        const pkg = await findPackageByProjection(packetProj.id)
        const facts = await findFactsByProjection(packetProj.id)
        const deliberation = deliberateMeetingPacket(packetProj, pkg, facts)
        console.log(`\n── /meeting ─────────────────────────────`)
        console.log(renderMeetingPacketDeliberation(packetProj, pkg, facts, deliberation))
        console.log(`────────────────────────────────────────\n`)
      }

      if (meetingArg) {
        // Try to resolve a MeetingPacket from the graph first
        let packetProj = await getProjection(meetingArg)
        if (!packetProj) {
          packetProj = await findProjectionByKey(meetingArg)
        }
        if (!packetProj) {
          // Try by projection_key suffix
          const allPackets = await findProjectionsByKind("MeetingPacket")
          packetProj = allPackets.find(p =>
            p.projection_key.toLowerCase().includes(meetingArg.toLowerCase())
          ) ?? null
        }

        if (packetProj) {
          await renderPacketMeeting(packetProj)
          rl.prompt()
          return
        }
        console.log(`MeetingPacket "${meetingArg}" not found in graph. Falling back to old flow.`)
        console.log(`Run /graph apply <plan_id> or /scout ingest <path> first.`)
      } else {
        const packets = await findProjectionsByKind("MeetingPacket")
        if (packets.length > 0) {
          const packetProj = packets[0]!
          await renderPacketMeeting(packetProj)
          rl.prompt()
          return
        }
      }

      // Fallback: old meeting governance flow
      const meetingGoal = requireConfirmedMeetingGoal(intentId, meetingGoalStore)
      if (!meetingGoal) {
        console.log("Meeting blocked: no confirmed Meeting Goal. Run /Brief first.")
        rl.prompt()
        return
      }

      const pendingCards = decisionCardStore.listByIntent(intentId, "inbox").map(x => x.card)
      console.log(renderPendingSummary(pendingCards))

      const topic = intentId as IntelligenceTopic
      const created: string[] = []
      const updated: string[] = []
      const skippedHistorical: string[] = []
      const charter = meetingGoalToCharter(meetingGoal)
      const knowledgePack = knowledgePackStore.load(intentId) ?? undefined
      const referenceFacts = referenceFactStore.list(topic)
        .map(id => referenceFactStore.load(topic, id))
        .filter((fact): fact is NonNullable<typeof fact> => fact !== null)
      for (const decisionId of decisionObjectStore.list(topic)) {
        const decision = decisionObjectStore.load(topic, decisionId)
        if (!decision) continue
        const findings = decision.supportedByFindingIds
          .map(id => findingStore.load(topic, id))
          .filter((f): f is NonNullable<typeof f> => f !== null)
        const evidenceBundle: Record<string, import("../state/evidence.js").Evidence[]> = {}
        for (const finding of findings) {
          evidenceBundle[finding.findingId] = finding.supportedByEvidenceIds
            .map(id => evidenceStore.load(topic, id))
            .filter((ev): ev is NonNullable<typeof ev> => ev !== null)
        }
        const findingBundle = { [decisionId]: findings }
        const metricsContext = decision.metricsImpact?.context
          ? {
              [decisionId]: {
                arr: decision.metricsImpact.context.arr,
                nrr: decision.metricsImpact.context.nrr,
                ndr: decision.metricsImpact.context.ndr,
                notes: decision.metricsImpact.context.notes,
              },
            }
          : {}
        const priorFeedback = feedbackStore.listByDecisionObject(decisionId)
        const meetingEnvelope = buildMeetingContextEnvelope({
          intentId,
          cycleId: `meeting-${Date.now()}`,
          meetingCharter: charter,
          decisionObjects: [decision],
          findingBundle,
          evidenceBundle,
          referenceFacts,
          metricsContext,
          priorFeedback,
          mode: "review",
        })
        const bundleAssessments = new Map<string, CommercialAssessment>()
        bundleAssessments.set(
          `decision-${decisionId}`,
          synthesizeAssessmentForDecisionObject({ intentId, decision, findings, meetingGoal }),
        )
        const meetingRecord = evaluateDecisionObjectWithMeetingRoom(
          decisionId,
          meetingEnvelope.cycleId,
          bundleAssessments,
          charter,
          knowledgePack,
          meetingEnvelope,
        )
        meetingRecordStore.save(meetingRecord)
        const existing = decisionCardStore.load(`card-${decisionId}`)
        if (existing && existing.bucket !== "inbox") {
          skippedHistorical.push(existing.card.cardId)
          continue
        }
        const card = buildDecisionCardFromDecisionObject({
          intentId,
          topic,
          decision,
          findings,
          meetingRecord,
          existingCard: existing?.card,
        })
        if (!card) continue
        decisionCardStore.save(card, "inbox", renderDecisionCardMarkdown(card))
        if (existing?.bucket === "inbox") {
          updated.push(card.cardId)
        } else if (!existing) {
          created.push(card.cardId)
        }
      }
      console.log(`\nMeeting complete. Created ${created.length} Decision Cards, refreshed ${updated.length} inbox cards.`)
      if (skippedHistorical.length > 0) {
        console.log(`Skipped ${skippedHistorical.length} already-processed/archive cards to preserve history.`)
      }
      if (created.length > 0 || updated.length > 0) console.log(`Use /inbox to review them.`)
      rl.prompt()
      return
    }

    if (line === "/inbox" || line.startsWith("/inbox ")) {
      const topicMatch = line.match(/--topic\s+([^\s]+)/)
      const kindMatch = line.match(/--kind\s+([^\s]+)/)
      const statusMatch = line.match(/--status\s+([^\s]+)/)
      const cards = decisionCardStore.listByIntent(intentId).map(x => x.card)
      console.log(renderInbox(cards, {
        topic: topicMatch?.[1],
        kind: kindMatch?.[1],
        status: statusMatch?.[1],
      }))
      rl.prompt()
      return
    }

    if (
      line.startsWith("/pick ") ||
      line.startsWith("/reject ") ||
      line.startsWith("/defer ") ||
      line.startsWith("/watch ")
    ) {
      const [command, cardId, ...rest] = line.split(/\s+/)
      if (!cardId) {
        console.log(`Usage: ${command} <card_id> [reason_class] [reason]`)
        rl.prompt()
        return
      }
      const loaded = decisionCardStore.load(cardId)
      if (!loaded) {
        console.log(`Card "${cardId}" not found.`)
        rl.prompt()
        return
      }

      const resolutionMap: Record<string, { resolution: ReviewResolution; status: DecisionCard["status"] }> = {
        "/pick": { resolution: "approve", status: "picked" },
        "/reject": { resolution: "reject", status: "rejected" },
        "/defer": { resolution: "defer", status: "deferred" },
        "/watch": { resolution: "watch", status: "watch" },
      }
      const mapped = resolutionMap[command]!
      const feedbackClass = command === "/pick"
        ? "other" as FeedbackClass
        : ((rest[0]?.replace(/-/g, "_") as FeedbackClass) || "other")
      const humanReason = command === "/pick"
        ? (rest.join(" ") || "picked for follow-up")
        : (rest.slice(1).join(" ") || "(no reason provided)")

      const result = buildReviewConfirm({
        decisionObjectId: loaded.card.decisionObjectId,
        decisionObjectStatement: loaded.card.summary,
        resolution: mapped.resolution,
        feedbackClass,
        humanReason,
        reviewedBy: "cli-user",
        onApply: (feedback, requests) => {
          feedbackStore.save(feedback)
          for (const req of requests) evidenceRequestStore.save(req)
          decisionCardStore.transition(cardId, mapped.status, "processed")
          if (mapped.status === "rejected" || mapped.status === "deferred" || mapped.status === "watch") {
            const candidate: RetrospectiveCandidate = {
              candidateId: newRetrospectiveCandidateId(),
              decisionObjectId: loaded.card.decisionObjectId,
              triggerFeedbackId: feedback.feedbackId,
              candidateReason: humanReason,
              status: "candidate",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            retrospectiveCandidateStore.save(candidate)
            console.log(`  Retrospective candidate created: ${candidate.candidateId}`)
          }
          console.log(`\n✓ Card ${cardId} -> ${mapped.status}`)
        },
      })
      pendingConfirm = {
        onConfirm: () => { result.onConfirm(); return result.preview + "\n\n✓ Confirmed." },
        onCancel: () => result.onCancel(),
      }
      console.log(`\n── ${command} ${cardId} ───────────────────`)
      console.log(result.preview)
      rl.prompt()
      return
    }

    if (line.startsWith("/submit card ")) {
      const cardId = line.slice("/submit card ".length).trim()
      if (!cardId) {
        console.log("Usage: /submit card <card_id>")
        rl.prompt()
        return
      }
      const loaded = decisionCardStore.load(cardId)
      if (!loaded) {
        console.log(`Card "${cardId}" not found.`)
        rl.prompt()
        return
      }
      const markdown = decisionCardStore.loadMarkdown(cardId)
      if (!markdown) {
        console.log(`Card markdown for "${cardId}" not found.`)
        rl.prompt()
        return
      }
      const parsed = parseCardMarkdown(markdown)
      if ("error" in parsed) {
        console.log(`Submit failed: ${parsed.error}`)
        rl.prompt()
        return
      }
      const result = buildReviewConfirm({
        decisionObjectId: loaded.card.decisionObjectId,
        decisionObjectStatement: loaded.card.summary,
        resolution: parsed.resolution,
        feedbackClass: parsed.feedbackClass,
        humanReason: parsed.reason,
        reviewedBy: "cli-user",
        evidenceRequests: parsed.evidenceRequests,
        onApply: (feedback, requests) => {
          feedbackStore.save(feedback)
          for (const req of requests) evidenceRequestStore.save(req)
          decisionCardStore.transition(cardId, parsed.cardStatus, "processed")
          if (parsed.cardStatus === "rejected" || parsed.cardStatus === "deferred" || parsed.cardStatus === "watch") {
            const candidate: RetrospectiveCandidate = {
              candidateId: newRetrospectiveCandidateId(),
              decisionObjectId: loaded.card.decisionObjectId,
              triggerFeedbackId: feedback.feedbackId,
              candidateReason: parsed.reason,
              status: "candidate",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            retrospectiveCandidateStore.save(candidate)
            console.log(`  Retrospective candidate created: ${candidate.candidateId}`)
          }
          console.log(`\n✓ Submitted card ${cardId}`)
        },
      })
      pendingConfirm = {
        onConfirm: () => { result.onConfirm(); return result.preview + "\n\n✓ Confirmed." },
        onCancel: () => result.onCancel(),
      }
      console.log(`\n── /submit card ${cardId} ───────────────────`)
      console.log(result.preview)
      rl.prompt()
      return
    }

    if (line.startsWith("/trace ")) {
      const target = line.slice("/trace ".length).trim()
      if (!target) {
        console.log("Usage: /trace <card_id|decision_object_id|projection_id|fact_id>")
        rl.prompt()
        return
      }
      const topic = intentId as IntelligenceTopic
      const cardLoaded = decisionCardStore.load(target)
      const decisionId = cardLoaded?.card.decisionObjectId ?? target
      const decision = decisionObjectStore.load(topic, decisionId)
      if (!decision) {
        const projectionEdges = await traceProjection(target)
        if (projectionEdges.length > 0) {
          console.log(`Trace (projection):`)
          for (const edge of projectionEdges) {
            console.log(`  ${edge.from_label}:${edge.from_id} --[${edge.rel_type}]--> ${edge.to_label}:${edge.to_id}`)
          }
          rl.prompt()
          return
        }
        const factEdges = await traceReferenceFact(target)
        if (factEdges.length > 0) {
          console.log(`Trace (reference_fact):`)
          for (const edge of factEdges) {
            console.log(`  ${edge.from_label}:${edge.from_id} --[${edge.rel_type}]--> ${edge.to_label}:${edge.to_id}`)
          }
          rl.prompt()
          return
        }
        console.log(`Nothing traceable found for "${target}".`)
        rl.prompt()
        return
      }
      const findings = decision.supportedByFindingIds
        .map(id => findingStore.load(topic, id))
        .filter((f): f is NonNullable<typeof f> => f !== null)
      const evidence = findings
        .flatMap(f => f.supportedByEvidenceIds.map(id => evidenceStore.load(topic, id)))
        .filter((e): e is NonNullable<typeof e> => e !== null)
      const meetingRecord = meetingRecordStore.loadForDecisionObject(decisionId)
      const feedback = feedbackStore.listByDecisionObject(decisionId)
      const retrospectiveCandidates = retrospectiveCandidateStore.listByDecisionObject(decisionId)
      const retrospectives = retrospectiveStore.listByOriginalDecision(decisionId)
      const learning = learningMemoryStore.list()
        .map(id => learningMemoryStore.load(id))
        .filter((m): m is NonNullable<typeof m> => m !== null && retrospectives.some(r => m.derivedFromRetrospectiveCaseIds.includes(r.retrospectiveCaseId)))
      console.log(renderTrace({
        card: cardLoaded?.card,
        decision,
        findings,
        evidence,
        meetingRecord,
        feedback,
        retrospectiveCandidates,
        retrospectives,
        learning,
      }))
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
          feedbackStore, evidenceRequestStore, meetingRecordStore,
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

    // ── /retro submit <decisionObjectId> <misjudgmentType> <reopenReason> --what <whatChanged> --lessons <l1> <l2>... ──
    if (line.startsWith("/retro submit ")) {
      const parts = line.split(" ").filter(Boolean)
      if (parts.length < 5) {
        console.log("Usage: /retro submit <decisionObjectId> <misjudgmentType> <reopenReason> --what <whatChanged> --lessons <lesson1> [<lesson2>...]")
        console.log("  misjudgmentType: interpretation_error | missing_evidence | timing_error | priority_error | reference_conflict_missed")
        rl.prompt()
        return
      }
      const decisionObjectId = parts[2]!
      const misjudgmentTypeRaw = parts[3]!.toLowerCase()
      const validMisjudgmentTypes = ["interpretation_error", "missing_evidence", "timing_error", "priority_error", "reference_conflict_missed"]
      if (!validMisjudgmentTypes.includes(misjudgmentTypeRaw)) {
        console.log(`Invalid misjudgmentType "${misjudgmentTypeRaw}". Valid: ${validMisjudgmentTypes.join(", ")}`)
        rl.prompt()
        return
      }

      // Collect reopenReason up to --what
      const whatIdx = parts.findIndex((p, i) => i > 3 && p === "--what")
      if (whatIdx === -1) { console.log("Missing --what flag"); rl.prompt(); return }
      const reopenReason = parts.slice(4, whatIdx).join(" ") || "(no reason)"

      // Find --lessons
      const lessonsIdx = parts.findIndex((p, i) => i > whatIdx && p === "--lessons")
      if (lessonsIdx === -1) { console.log("Missing --lessons flag"); rl.prompt(); return }
      const whatChanged = parts.slice(whatIdx + 1, lessonsIdx).join(" ") || "(not specified)"
      const lessons = parts.slice(lessonsIdx + 1).filter(l => l.trim())

      // Load DecisionObject to verify it exists
      const topic = intentId as IntelligenceTopic
      const dObj = decisionObjectStore.load(topic, decisionObjectId)
      if (!dObj) {
        console.log(`Decision object "${decisionObjectId}" not found.`)
        rl.prompt()
        return
      }
      // Get original resolution from most recent review feedback
      const priorFeedback = feedbackStore.listByDecisionObject(decisionObjectId)
      const originalResolution = priorFeedback.length > 0 ? priorFeedback[priorFeedback.length - 1]!.resolution : "no prior review"

      const result = buildRetrospectiveConfirm({
        originalDecisionObjectId: decisionObjectId,
        originalResolution,
        reopenReason,
        whatChanged,
        misjudgmentType: misjudgmentTypeRaw as any,
        lessons: lessons.length > 0 ? lessons : ["(no lessons recorded)"],
        onApply: (retro) => {
          retrospectiveStore.save(retro)
          console.log(`\n✓ Retrospective case created: ${retro.retrospectiveCaseId}`)
          console.log(`  Decision: ${retro.originalDecisionObjectId} | Misjudgment: ${retro.misjudgmentType}`)
          console.log(`  Lessons: ${retro.lessons.length}`)
        },
      })

      pendingConfirm = {
        onConfirm: () => { result.onConfirm(); return result.preview + "\n\n✓ Confirmed." },
        onCancel: () => result.onCancel(),
      }
      console.log(`\n── /retro submit ${decisionObjectId} ───────────────────`)
      console.log(result.preview)
      rl.prompt()
      return
    }

    // ── /learning add <retroId> <memoryType> "<statement>" --confidence <h|m|l> --reviewafter <date> ──
    if (line.startsWith("/learning add ")) {
      const parts = line.split(" ").filter(Boolean)
      if (parts.length < 6) {
        console.log("Usage: /learning add <retroId> <memoryType> \"<statement>\" --confidence <high|medium|low> --reviewafter <YYYY-MM-DD>")
        console.log("  memoryType: decision_heuristic | evidence_policy | anti_pattern | blind_spot | watch_rule")
        rl.prompt()
        return
      }
      const retroId = parts[2]!
      const memoryTypeRaw = parts[3]!.toLowerCase()
      const validMemoryTypes = ["decision_heuristic", "evidence_policy", "anti_pattern", "blind_spot", "watch_rule"]
      if (!validMemoryTypes.includes(memoryTypeRaw)) {
        console.log(`Invalid memoryType "${memoryTypeRaw}". Valid: ${validMemoryTypes.join(", ")}`)
        rl.prompt()
        return
      }

      // Statement is quoted, find it between index 4 and --confidence
      const confidenceIdx = parts.findIndex((p, i) => i > 4 && p === "--confidence")
      if (confidenceIdx === -1) { console.log("Missing --confidence flag"); rl.prompt(); return }
      const statement = parts.slice(4, confidenceIdx).join(" ").replace(/^"(.*)"$/, "$1") || "(no statement)"

      const confidenceRaw = parts[confidenceIdx + 1]?.toLowerCase()
      const confidence = (confidenceRaw === "h" || confidenceRaw === "high") ? "high" as const
        : (confidenceRaw === "l" || confidenceRaw === "low") ? "low" as const
        : "medium" as const

      const reviewafterIdx = parts.findIndex((p, i) => i > confidenceIdx && p === "--reviewafter")
      const reviewAfter = reviewafterIdx !== -1 ? parts[reviewafterIdx + 1]! : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      // Verify retro exists
      const retro = retrospectiveStore.load(retroId)
      if (!retro) {
        console.log(`Retrospective case "${retroId}" not found.`)
        rl.prompt()
        return
      }

      const result = buildLearningMemoryConfirm({
        derivedFromRetrospectiveCaseIds: [retroId],
        memoryType: memoryTypeRaw as any,
        statement,
        confidence,
        reviewAfter,
        onApply: (memory) => {
          learningMemoryStore.save(memory)
          console.log(`\n✓ Learning memory created: ${memory.memoryId}`)
          console.log(`  Type: ${memory.memoryType} | Status: candidate | Confidence: ${memory.confidence}`)
        },
      })

      pendingConfirm = {
        onConfirm: () => { result.onConfirm(); return result.preview + "\n\n✓ Confirmed." },
        onCancel: () => result.onCancel(),
      }
      console.log(`\n── /learning add ${retroId} ───────────────────`)
      console.log(result.preview)
      rl.prompt()
      return
    }

    // ── /learning promote <memoryId> ──────────────────────────────────────────
    if (line.startsWith("/learning promote ")) {
      const parts = line.split(" ").filter(Boolean)
      const memoryId = parts[2]
      if (!memoryId) { console.log("Usage: /learning promote <memoryId>"); rl.prompt(); return }
      const memory = learningMemoryStore.load(memoryId)
      if (!memory) { console.log(`Learning memory "${memoryId}" not found.`); rl.prompt(); return }
      if (memory.status === "active") { console.log(`Memory "${memoryId}" is already active.`); rl.prompt(); return }
      if (memory.status === "expired") { console.log(`Memory "${memoryId}" is expired and cannot be promoted.`); rl.prompt(); return }
      learningMemoryStore.save({ ...memory, status: "active", updatedAt: new Date().toISOString() })
      console.log(`\n✓ Learning memory "${memoryId}" promoted to active.`)
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

    if (line === "/scout" || line === "/run" || line === "/run radar") {
      if (running) { console.log("Pipeline is already running. Please wait."); rl.prompt(); return }
      const confirmedScoutBrief = requireConfirmedScoutBrief(intentId, scoutBriefStore)
      if (!confirmedScoutBrief) {
        console.log("Scout blocked: no confirmed Scout Brief. Run /Brief first.")
        rl.prompt()
        return
      }
      running = true
      console.log(`\nExecuting staged Scout workflow — intent=${intentId}...`)
      try {
        const staged = stageScoutKnowledge(confirmedScoutBrief, process.cwd())
        const existingBundle = stagedKnowledgeStore.loadLatest(intentId)
        if (existingBundle && existingBundle.status === "approved") {
          stagedKnowledgeStore.save({ ...existingBundle, status: "superseded", updatedAt: new Date().toISOString() })
        }
        stagedKnowledgeStore.save(staged.bundle)

        const summary: LastRunSummary = {
          timestamp: new Date().toISOString(),
          intentId: intent.id,
          cycleId: staged.bundle.scoutRunId,
          runType: "radar",
          sessionPatchCount: strategyManager.get().patches.length,
          sources: staged.bundle.sourceLocators.map(locator => ({
            name: locator,
            sourceType: getSourceWorkflowType(locator),
            legacyRole: inferDefaultSourceRole(locator),
            signalCount: staged.itemsCreated,
          })),
          pipeline: {
            ingested: staged.filesScanned,
            scored: staged.itemsCreated,
            qualified: staged.itemsCreated,
            enqueuedForTriage: 0,
          },
          searchContext: summarizeSearchContext(scoutBriefToSearchContext(confirmedScoutBrief)),
          knowledgeBase: summarizeKnowledgeBase(undefined),
          knowledgePack: summarizeKnowledgePack(undefined),
          meetingCharter: summarizeMeetingCharter(undefined),
          knowledgeBrief: summarizeKnowledgeBrief(undefined),
        }
        lastRunStore.save(summary)
        console.log(`\nStaged knowledge created.`)
        console.log(`Bundle:        ${staged.bundle.bundleId}`)
        console.log(`Source targets: ${staged.bundle.sourceLocators.length}`)
        console.log(`Files scanned: ${staged.filesScanned}`)
        console.log(`Items created: ${staged.itemsCreated}`)
        console.log(`Next: /review knowledge ${staged.bundle.bundleId}`)
      } catch (err) {
        console.error(`Scout workflow failed: ${err}`)
      } finally {
        running = false
      }
      rl.prompt()
      return
    }

    if (line === "/review knowledge" || line.startsWith("/review knowledge ")) {
      const bundleArg = line.slice("/review knowledge".length).trim()
      const bundle = bundleArg
        ? stagedKnowledgeStore.load(bundleArg)
        : stagedKnowledgeStore.loadLatest(intentId)
      if (!bundle) {
        console.log("No staged knowledge bundle found. Run /scout first.")
        rl.prompt()
        return
      }
      pendingConfirm = {
        onConfirm: () => {
          stagedKnowledgeStore.save({
            ...bundle,
            status: "approved",
            updatedAt: new Date().toISOString(),
            items: bundle.items.map(item => ({ ...item, knowledgeReviewStatus: "approved" })),
          })
          return `✓ Knowledge bundle approved.\n  Bundle: ${bundle.bundleId}\n  Next: /graph plan ${bundle.bundleId}`
        },
        onCancel: () => "Knowledge review cancelled. Bundle remains unapproved.",
      }
      console.log(`\n── /review knowledge ─────────────────────`)
      showStagedKnowledgeBundle(bundle)
      console.log(``)
      console.log(`Approve this staged knowledge bundle for graph planning?`)
      console.log(`Type 'y' to approve, 'n' to cancel`)
      rl.prompt()
      return
    }

    // ── /graph plan ─────────────────────────────────────────────────────────
    if (line === "/graph plan" || line.startsWith("/graph plan ")) {
      const bundleArg = line.slice("/graph plan".length).trim()
      const bundle = bundleArg
        ? stagedKnowledgeStore.load(bundleArg)
        : stagedKnowledgeStore.loadLatest(intentId)
      if (!bundle) {
        console.log("No staged knowledge bundle found. Run /scout first.")
        rl.prompt()
        return
      }
      if (bundle.status !== "approved") {
        console.log(`Bundle ${bundle.bundleId} is not approved yet. Run /review knowledge ${bundle.bundleId} first.`)
        rl.prompt()
        return
      }
      const existingPlan = graphMappingPlanStore.loadLatestByBundle(bundle.bundleId)
      if (existingPlan && existingPlan.status !== "applied") {
        graphMappingPlanStore.save({ ...existingPlan, status: "superseded", updatedAt: new Date().toISOString() })
      }
      const plan = draftGraphMappingPlan(bundle)
      graphMappingPlanStore.save(plan)
      stagedKnowledgeStore.save({
        ...bundle,
        updatedAt: new Date().toISOString(),
        items: bundle.items.map(item => ({ ...item, graphMappingStatus: "drafted" })),
      })
      console.log(`\n── /graph plan ───────────────────────────`)
      showGraphMappingPlan(plan)
      console.log(``)
      console.log(`Next: /review graph ${plan.planId}`)
      console.log(`────────────────────────────────────────\n`)
      rl.prompt()
      return
    }

    if (line === "/review graph" || line.startsWith("/review graph ")) {
      const planArg = line.slice("/review graph".length).trim()
      const candidatePlan = planArg
        ? graphMappingPlanStore.load(planArg)
        : stagedKnowledgeStore.loadLatest(intentId)
          ? graphMappingPlanStore.loadLatestByBundle(stagedKnowledgeStore.loadLatest(intentId)!.bundleId)
          : null
      if (!candidatePlan) {
        console.log("No graph mapping plan found. Run /graph plan first.")
        rl.prompt()
        return
      }
      pendingConfirm = {
        onConfirm: () => {
          const approvedPlan: GraphMappingPlan = {
            ...candidatePlan,
            status: "approved",
            updatedAt: new Date().toISOString(),
            entries: candidatePlan.entries.map(entry => ({ ...entry, status: "approved" })),
          }
          graphMappingPlanStore.save(approvedPlan)
          const bundle = stagedKnowledgeStore.load(approvedPlan.bundleId)
          if (bundle) {
            stagedKnowledgeStore.save({
              ...bundle,
              updatedAt: new Date().toISOString(),
              items: bundle.items.map(item => ({ ...item, graphMappingStatus: "approved" })),
            })
          }
          return `✓ Graph mapping plan approved.\n  Plan: ${approvedPlan.planId}\n  Next: /graph apply ${approvedPlan.planId}`
        },
        onCancel: () => "Graph mapping review cancelled. Plan remains unapproved.",
      }
      console.log(`\n── /review graph ─────────────────────────`)
      showGraphMappingPlan(candidatePlan)
      console.log(``)
      console.log(`Approve this graph mapping plan for canonical graph apply?`)
      console.log(`Type 'y' to approve, 'n' to cancel`)
      rl.prompt()
      return
    }

    if (line === "/graph apply" || line.startsWith("/graph apply ")) {
      const planArg = line.slice("/graph apply".length).trim()
      const candidatePlan = planArg
        ? graphMappingPlanStore.load(planArg)
        : stagedKnowledgeStore.loadLatest(intentId)
          ? graphMappingPlanStore.loadLatestByBundle(stagedKnowledgeStore.loadLatest(intentId)!.bundleId)
          : null
      if (!candidatePlan) {
        console.log("No graph mapping plan found. Run /graph plan first.")
        rl.prompt()
        return
      }
      if (candidatePlan.status !== "approved") {
        console.log(`Plan ${candidatePlan.planId} is not approved yet. Run /review graph ${candidatePlan.planId} first.`)
        rl.prompt()
        return
      }
      console.log(`\n── /graph apply ──────────────────────────`)
      try {
        const result = await applyGraphMappingPlan(candidatePlan, DATA_DIR)
        const appliedPlan: GraphMappingPlan = {
          ...candidatePlan,
          status: "applied",
          updatedAt: new Date().toISOString(),
          entries: candidatePlan.entries.map(entry => ({ ...entry, status: "applied" })),
        }
        graphMappingPlanStore.save(appliedPlan)
        const bundle = stagedKnowledgeStore.load(appliedPlan.bundleId)
        if (bundle) {
          stagedKnowledgeStore.save({
            ...bundle,
            updatedAt: new Date().toISOString(),
            items: bundle.items.map(item => ({ ...item, graphMappingStatus: "applied" })),
          })
        }
        console.log(`Plan:            ${result.planId}`)
        console.log(`Targets applied: ${result.appliedTargets}`)
        const artifacts = result.results.reduce((sum, item) => sum + item.artifactsCreated, 0)
        const sections = result.results.reduce((sum, item) => sum + item.sectionsCreated, 0)
        const evidence = result.results.reduce((sum, item) => sum + item.evidenceExtracted, 0)
        const facts = result.results.reduce((sum, item) => sum + item.factsPromoted, 0)
        const projections = result.results.reduce((sum, item) => sum + item.projectionsRefreshed, 0)
        console.log(`Artifacts:       ${artifacts}`)
        console.log(`Sections:        ${sections}`)
        console.log(`Evidence:        ${evidence}`)
        console.log(`Facts:           ${facts}`)
        console.log(`Projections:     ${projections}`)
        if (result.errors.length > 0) {
          console.log(`Errors:`)
          for (const error of result.errors) console.log(`  - ${error}`)
        }
        console.log(`Next: /graph stats  /package show  /projection show  /meeting`)
        console.log(`────────────────────────────────────────\n`)
      } catch (err) {
        console.error(`Graph apply failed: ${err}`)
      }
      rl.prompt()
      return
    }

    // ── /graph — Memgraph graph knowledge runtime ───────────────────────────────
    if (line === "/graph bootstrap") {
      console.log(`\n── /graph bootstrap ──────────────────────`)
      const cfg = loadMemgraphConfig()
      console.log(`Connecting to Memgraph at ${memgraphBoltUrl(cfg)}...`)
      try {
        const result = await bootstrapGraph()
        if (result.success) {
          console.log(`Graph bootstrap succeeded.`)
        } else {
          console.log(`Graph bootstrap completed with errors:`)
          for (const err of result.errors) console.log(`  - ${err}`)
        }
        console.log(`Indexes created: ${result.indexesCreated.join(", ") || "(none)"}`)
        console.log(`────────────────────────────────────────\n`)
      } catch (err) {
        console.error(`Bootstrap failed: ${err}`)
      }
      rl.prompt()
      return
    }

    if (line === "/graph health") {
      console.log(`\n── /graph health ──────────────────────────`)
      const health = await checkHealth()
      if (health.healthy) {
        console.log(`Memgraph is healthy.`)
        if (health.version) console.log(`Version: ${health.version}`)
      } else {
        console.log(`Memgraph is NOT reachable.`)
        if (health.error) console.log(`Error: ${health.error}`)
        console.log(`Make sure Memgraph is running at ${loadMemgraphConfig().host}:${loadMemgraphConfig().port}`)
      }
      console.log(`────────────────────────────────────────\n`)
      rl.prompt()
      return
    }

    if (line === "/graph stats") {
      console.log(`\n── /graph stats ───────────────────────────`)
      try {
        const stats = await getGraphStats()
        const total = Object.values(stats).reduce((a, b) => a + b, 0)
        console.log(`Memgraph: ${loadMemgraphConfig().database} @ ${loadMemgraphConfig().host}:${loadMemgraphConfig().port}`)
        console.log(``)
        for (const [label, count] of Object.entries(stats)) {
          console.log(`  ${label}: ${count}`)
        }
        console.log(`  ─────────────────`)
        console.log(`  Total nodes: ${total}`)
        console.log(`────────────────────────────────────────\n`)
      } catch (err) {
        console.error(`Stats failed: ${err}`)
      }
      rl.prompt()
      return
    }

    // ── /scout status ───────────────────────────────────────────────────────
    if (line === "/scout status" || line.startsWith("/scout status ")) {
      const targetArg = line.slice("/scout status".length).trim()
      console.log(`\n── /scout status ───────────────────────────`)
      try {
        if (!targetArg) {
          // Show recent scout runs
          const { findRecentScoutRuns } = await import("../state/graph/repositories.js")
          const runs = await findRecentScoutRuns(10)
          if (runs.length === 0) {
            console.log("No scout runs found. Run /scout ingest first.")
          } else {
            console.log(`${runs.length} recent scout runs:`)
            for (const r of runs) {
              console.log(`  ${r.run_id}  ${r.mode}  ${r.status}  started=${r.started_at}`)
            }
          }
        } else {
          // Try to find as package path or package id
          const allPkgs = await listKnowledgePackages()
          const pkg = allPkgs.find(p => p.id === targetArg || p.package_path === targetArg)
          if (!pkg) {
            console.log(`Package not found: ${targetArg}`)
            console.log(`Run /scout ingest ${targetArg} first.`)
          } else {
            const status = await getPackageStatus(pkg.id)
            if (!status) {
              console.log(`Could not get status for ${targetArg}`)
            } else {
              console.log(`Package:     ${status.package.package_path} [${status.package.package_kind}]`)
              console.log(`ID:         ${status.package.id}`)
              console.log(`Confidence: ${status.package.confidence}`)
              console.log(`Freshness:  ${status.package.freshness_status}`)
              console.log(``)
              console.log(`Artifacts:   ${status.artifactCount}`)
              console.log(`Sections:   ${status.sectionCount}`)
              console.log(`Evidence:   ${status.evidenceCount}`)
              console.log(`Facts:      ${status.factCount}`)
              console.log(`Projections: ${status.projectionCount}`)
              if (status.lastRun) {
                console.log(``)
                console.log(`Last run:   ${status.lastRun.run_id}  ${status.lastRun.mode}  ${status.lastRun.status}`)
                console.log(`Started:    ${status.lastRun.started_at}`)
                if (status.lastRun.finished_at) console.log(`Finished:   ${status.lastRun.finished_at}`)
              }
            }
          }
        }
        console.log(`────────────────────────────────────────\n`)
      } catch (err) {
        console.error(`Status failed: ${err}`)
      }
      rl.prompt()
      return
    }

    // ── /scout ingest ─────────────────────────────────────────────────────────
    if (line.startsWith("/scout ingest ")) {
      const sourcePath = line.slice("/scout ingest ".length).trim()
      if (!sourcePath) {
        console.log("Usage: /scout ingest <path|package>")
        rl.prompt()
        return
      }
      console.log(`\n── /scout ingest ────────────────────────`)
      console.log(`Ingesting: ${sourcePath}`)
      try {
        const result = await scoutIngest(sourcePath)
        console.log(`Run ID:      ${result.runId}`)
        console.log(`Target:      ${result.targetId}`)
        console.log(`Package:     ${result.packageId}`)
        console.log(`Artifacts:   ${result.artifactsCreated}`)
        console.log(`Sections:    ${result.sectionsCreated}`)
        console.log(`Evidence:    ${result.evidenceExtracted}`)
        console.log(`Facts:       ${result.factsPromoted}`)
        console.log(`Projections: ${result.projectionsRefreshed}`)
        if (result.errors.length > 0) {
          console.log(`Errors:`)
          for (const err of result.errors) console.log(`  - ${err}`)
        }
        console.log(`────────────────────────────────────────\n`)
      } catch (err) {
        console.error(`Ingest failed: ${err}`)
      }
      rl.prompt()
      return
    }

    // ── /scout refresh ───────────────────────────────────────────────────────
    if (line.startsWith("/scout refresh ")) {
      const packagePath = line.slice("/scout refresh ".length).trim()
      if (!packagePath) {
        console.log("Usage: /scout refresh <package>")
        rl.prompt()
        return
      }
      console.log(`\n── /scout refresh ───────────────────────`)
      console.log(`Refreshing: ${packagePath}`)
      try {
        const result = await scoutRefresh(packagePath)
        console.log(`Run ID:      ${result.runId}`)
        console.log(`Artifacts:   ${result.artifactsCreated}`)
        console.log(`Facts:       ${result.factsPromoted}`)
        console.log(`Projections: ${result.projectionsRefreshed}`)
        console.log(`────────────────────────────────────────\n`)
      } catch (err) {
        console.error(`Refresh failed: ${err}`)
      }
      rl.prompt()
      return
    }

    // ── /package show ────────────────────────────────────────────────────────
    if (line === "/package show" || line.startsWith("/package show ")) {
      const packageId = line === "/package show"
        ? ""
        : line.slice("/package show ".length).trim()
      if (!packageId) {
        // List all packages if no ID given
        const packages = await listKnowledgePackages()
        console.log(`\n── /package show ─────────────────────────`)
        if (packages.length === 0) {
          console.log("No packages in graph. Run /scout ingest first.")
        } else {
          console.log(`${packages.length} packages:`)
          for (const pkg of packages) {
            console.log(`  ${pkg.id}  ${pkg.package_path}  [${pkg.package_kind}]`)
          }
        }
        console.log(`────────────────────────────────────────\n`)
        rl.prompt()
        return
      }
      console.log(`\n── /package show ─────────────────────────`)
      try {
        const pkg = await getKnowledgePackage(packageId)
        if (!pkg) {
          // Try finding by path
          const allPackages = await listKnowledgePackages()
          const matched = allPackages.find(p => p.id === packageId || p.package_path === packageId)
          if (!matched) {
            console.log(`Package "${packageId}" not found.`)
          } else {
            await showPackageDetails(matched.id)
          }
        } else {
          await showPackageDetails(pkg.id)
        }
        console.log(`────────────────────────────────────────\n`)
      } catch (err) {
        console.error(`Failed: ${err}`)
      }
      rl.prompt()
      return
    }

    // ── /projection show ─────────────────────────────────────────────────────
    if (line.startsWith("/projection show ")) {
      const projectionIdOrKey = line.slice("/projection show ".length).trim()
      if (!projectionIdOrKey) {
        console.log("Usage: /projection show <projection_id|projection_key>")
        rl.prompt()
        return
      }
      console.log(`\n── /projection show ───────────────────────`)
      try {
        // Try as ID first, then as key
        let proj = await getProjection(projectionIdOrKey)
        if (!proj) {
          proj = await findProjectionByKey(projectionIdOrKey)
        }
        if (!proj) {
          console.log(`Projection "${projectionIdOrKey}" not found.`)
        } else {
          await showProjectionDetails(proj.id)
        }
        console.log(`────────────────────────────────────────\n`)
      } catch (err) {
        console.error(`Failed: ${err}`)
      }
      rl.prompt()
      return
    }

    // ── /projection refresh ──────────────────────────────────────────────────
    if (line.startsWith("/projection refresh ")) {
      const target = line.slice("/projection refresh ".length).trim()
      if (!target) {
        console.log("Usage: /projection refresh <projection_id|package_id>")
        rl.prompt()
        return
      }
      console.log(`\n── /projection refresh ────────────────────`)
      console.log(`Refreshing projections for: ${target}`)
      console.log(`(Re-run /scout ingest on the source package to refresh)`)
      console.log(`────────────────────────────────────────\n`)
      rl.prompt()
      return
    }

    // ── /trace ───────────────────────────────────────────────────────────────
    if (line.startsWith("/trace ")) {
      const targetId = line.slice("/trace ".length).trim()
      if (!targetId) {
        console.log("Usage: /trace <projection_id|fact_id|decision_id>")
        rl.prompt()
        return
      }
      console.log(`\n── /trace ─────────────────────────────────`)
      try {
        // Try projection trace first
        let edges = await traceProjection(targetId)
        let traceType = "projection"
        if (edges.length === 0) {
          edges = await traceReferenceFact(targetId)
          traceType = "reference_fact"
        }
        if (edges.length === 0) {
          console.log(`No trace found for "${targetId}".`)
        } else {
          console.log(`Trace (${traceType}):`)
          for (const edge of edges) {
            console.log(`  ${edge.from_label}:${edge.from_id} --[${edge.rel_type}]--> ${edge.to_label}:${edge.to_id}`)
          }
        }
        console.log(`────────────────────────────────────────\n`)
      } catch (err) {
        console.error(`Trace failed: ${err}`)
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

      if (!surface) {
        console.log([
          "Usage:",
          "  /tell intent <text>   — preview → confirm → apply Intent changes",
          "  /tell scout <text>    — preview → confirm → apply Scout Brief changes",
          "  /tell meeting <text> — preview → confirm → apply Meeting Goal changes",
        ].join("\n"))
        rl.prompt()
        return
      }

      const validSurfaces = ["intent", "scout", "meeting"]
      if (!validSurfaces.includes(surface)) {
        console.log(`Unknown surface: ${surface}. Valid: ${validSurfaces.join(", ")}`)
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
        "  /Brief <prompt> — 生成并确认 Scout Brief + Meeting Goal",
        "  /scout          — 基于 confirmed Scout Brief 生成 staged knowledge bundle",
        "  /review knowledge [bundle_id] — 审阅 staged knowledge",
        "  /graph plan [bundle_id] — 从 approved knowledge 生成 graph mapping plan",
        "  /review graph [plan_id] — 审阅 graph mapping plan",
        "  /graph apply [plan_id] — 将 approved mapping 写入 canonical graph",
        "  /meeting        — 优先消费 graph-backed MeetingPacket；否则回退旧 flow",
        "  /inbox          — 查看 Decision Cards inbox",
        "  /pick <card_id> [reason] — 选择卡片进入后续消费",
        "  /reject <card_id> <reason_class> <reason> — 拒绝卡片并写反馈",
        "  /defer <card_id> <reason_class> <reason> — 延后卡片并写反馈",
        "  /watch <card_id> <reason_class> <reason> — watch 卡片并写反馈",
        "  /submit card <card_id> — 提交编辑过的 Markdown 卡片",
        "  /trace <projection_id|fact_id|decision_id> — 追踪完整 lineage",
        "",
        "Graph commands (Memgraph-backed):",
        "  /graph bootstrap — 初始化 Memgraph schema 和 indexes",
        "  /graph health    — 检查 Memgraph 连接状态",
        "  /graph stats     — 查看图中节点统计",
        "  /scout ingest <path> — operator path: 直接将本地路径摄入 Memgraph",
        "  /scout refresh <package> — 刷新已有 package",
        "  /scout status [package] — 查看摄入状态或最近运行记录",
        "  /package show [id] — 查看 package 详情或列表",
        "  /projection show <id|key> — 查看 projection 详情",
        "  /projection refresh <id> — 刷新 projection（重新 ingest）",
        "",
        "Advanced / compatibility commands:",
        "  /state          — 查看旧对象摘要",
        "  /decisions      — 查看所有 DecisionObjects",
        "  /findings       — 查看所有 Findings",
        "  /evidence       — 查看所有 Evidence",
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
        "  /run radar      — compatibility alias for /scout",
        "  /tell <surface> <text> — 修改 Intent / Scout Brief / Meeting Goal（预览 → 确认 → 应用）",
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
