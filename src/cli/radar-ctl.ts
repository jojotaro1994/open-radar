import {
  deliberateMeetingPacket,
  renderMeetingPacketDeliberation,
} from "./meeting-packet-handler.js"
import { renderInbox } from "./inbox-handler.js"
import { buildReviewConfirm } from "./review-handler.js"
import { newRetrospectiveCandidateId } from "./card-submit-handler.js"
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
import { createRadarRuntime, DATA_DIR } from "./radar-runtime.js"
import type { LastRunSummary } from "../state/last-run.js"
import { stageScoutKnowledge } from "../orchestrator/scout-knowledge-staging.js"
import { scoutIngest, scoutRefresh } from "../orchestrator/scout-graph-ingestion.js"
import { draftGraphMappingPlan, applyGraphMappingPlan } from "../orchestrator/graph-mapping-plan.js"
import { summarizeKnowledgeBase, summarizeKnowledgePack, summarizeMeetingCharter, summarizeSearchContext, summarizeKnowledgeBrief } from "../state/context-summary.js"
import { inferDefaultSourceRole } from "../state/source-role.js"
import { getSourceWorkflowType } from "../registry/source-taxonomy.js"
import { bootstrapGraph, getGraphStats, checkHealth } from "../infrastructure/memgraph-bootstrap.js"
import {
  findProjectionsByKind,
  getProjection,
  findProjectionByKey,
  findPackageByProjection,
  findFactsByProjection,
  traceProjection,
  traceReferenceFact,
  getKnowledgePackage,
  findArtifactsByPackage,
  findProjectionsByPackage,
  findRecentScoutRuns,
} from "../state/graph/repositories.js"
import type { GraphMappingPlan } from "../state/graph-mapping-plan.js"
import type { StagedKnowledgeBundle } from "../state/staged-knowledge.js"
import type { HumanReviewFeedback } from "../state/human-review-feedback.js"
import type { ReviewResolution, FeedbackClass } from "../state/human-review-feedback.js"
import type { EvidenceRequest } from "../state/evidence-request.js"
import type { RetrospectiveCandidate } from "../state/retrospective-candidate.js"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

interface RadarCtlResponse<T extends JsonValue> {
  status: "ok" | "error"
  command: string
  result: T | null
  nextSteps: string[]
  error: { message: string } | null
}

function ok<T extends JsonValue>(command: string, result: T, nextSteps: string[] = []): RadarCtlResponse<T> {
  return { status: "ok", command, result, nextSteps, error: null }
}

function fail(command: string, message: string): RadarCtlResponse<null> {
  return { status: "error", command, result: null, nextSteps: [], error: { message } }
}

function printResponse<T extends JsonValue>(response: RadarCtlResponse<T>, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(response, null, 2))
    return
  }
  if (response.status === "error") {
    console.error(`${response.command}: ${response.error?.message ?? "unknown error"}`)
    return
  }
  console.log(`${response.command}: ok`)
  if (response.result !== null) {
    if (typeof response.result === "string") console.log(response.result)
    else console.log(JSON.stringify(response.result, null, 2))
  }
  if (response.nextSteps.length > 0) {
    console.log(`Next:`)
    for (const step of response.nextSteps) console.log(`- ${step}`)
  }
}

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string | boolean> } {
  const positional: string[] = []
  const flags = new Map<string, string | boolean>()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }
    const [key, inline] = arg.split("=", 2)
    if (inline !== undefined) {
      flags.set(key, inline)
      continue
    }
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      flags.set(key, true)
      continue
    }
    flags.set(key, next)
    i += 1
  }
  return { positional, flags }
}

function flagString(flags: Map<string, string | boolean>, name: string, fallback = ""): string {
  const value = flags.get(name)
  return typeof value === "string" ? value : fallback
}

function flagBool(flags: Map<string, string | boolean>, name: string): boolean {
  return flags.get(name) === true
}

async function runOverviewState(intentId: string): Promise<RadarCtlResponse<JsonValue>> {
  const runtime = createRadarRuntime(intentId)
  const currentBrief = runtime.scoutBriefStore.loadCurrent(intentId)
  const currentGoal = runtime.meetingGoalStore.loadCurrent(intentId)
  const latestBundle = runtime.stagedKnowledgeStore.loadLatest(intentId)
  const latestPlan = latestBundle ? runtime.graphMappingPlanStore.loadLatestByBundle(latestBundle.bundleId) : null
  const inboxCards = runtime.decisionCardStore.listByIntent(intentId, "inbox")
  const lastRun = runtime.lastRunStore.load()

  return ok("overview state", {
    intentId,
    scoutBriefId: currentBrief?.briefId ?? null,
    meetingGoalId: currentGoal?.meetingGoalId ?? null,
    bundleId: latestBundle?.bundleId ?? null,
    bundleStatus: latestBundle?.status ?? null,
    planId: latestPlan?.planId ?? null,
    planStatus: latestPlan?.status ?? null,
    inboxCount: inboxCards.length,
    lastRunTimestamp: lastRun?.timestamp ?? null,
  }, [])
}

async function runOverviewGraph(): Promise<RadarCtlResponse<JsonValue>> {
  const health = await checkHealth()
  const stats = health.healthy ? await getGraphStats() : {}
  return ok("overview graph", {
    healthy: health.healthy,
    version: health.version ?? null,
    error: health.error ?? null,
    stats,
  }, [])
}

async function runBriefDraft(intentId: string, prompt: string): Promise<RadarCtlResponse<JsonValue>> {
  if (!prompt.trim()) return fail("brief draft", "Missing --prompt")
  const runtime = createRadarRuntime(intentId)
  const draftBrief = draftScoutBrief(prompt, intentId)
  const draftGoal = draftMeetingGoal(prompt, intentId)
  runtime.scoutBriefStore.save(draftBrief)
  runtime.meetingGoalStore.save(draftGoal)
  return ok("brief draft", {
    scoutBriefId: draftBrief.briefId,
    meetingGoalId: draftGoal.meetingGoalId,
    preview: renderBriefPreview(draftBrief, draftGoal),
  }, [
    `radar-ctl brief apply --intent ${intentId} --brief ${draftBrief.briefId} --goal ${draftGoal.meetingGoalId}`,
  ])
}

async function runBriefApply(intentId: string, briefId: string, goalId: string): Promise<RadarCtlResponse<JsonValue>> {
  const runtime = createRadarRuntime(intentId)
  const draftBrief = runtime.scoutBriefStore.load(briefId)
  const draftGoal = runtime.meetingGoalStore.load(goalId)
  if (!draftBrief) return fail("brief apply", `ScoutBrief not found: ${briefId}`)
  if (!draftGoal) return fail("brief apply", `MeetingGoal not found: ${goalId}`)

  const currentBrief = runtime.scoutBriefStore.loadCurrent(intentId)
  const currentGoal = runtime.meetingGoalStore.loadCurrent(intentId)
  if (currentBrief) runtime.scoutBriefStore.save(supersedeScoutBrief(currentBrief))
  if (currentGoal) runtime.meetingGoalStore.save(supersedeMeetingGoal(currentGoal))

  const confirmedBrief = confirmScoutBrief(draftBrief)
  const confirmedGoal = confirmMeetingGoal(draftGoal)
  runtime.scoutBriefStore.save(confirmedBrief)
  runtime.meetingGoalStore.save(confirmedGoal)
  runtime.searchContextStore.save(intentId, scoutBriefToSearchContext(confirmedBrief))
  runtime.meetingCharterStore.save(intentId, meetingGoalToCharter(confirmedGoal))

  return ok("brief apply", {
    scoutBriefId: confirmedBrief.briefId,
    meetingGoalId: confirmedGoal.meetingGoalId,
  }, [
    `radar-ctl knowledge scout --intent ${intentId}`,
  ])
}

async function runKnowledgeScout(intentId: string): Promise<RadarCtlResponse<JsonValue>> {
  const runtime = createRadarRuntime(intentId)
  const confirmedScoutBrief = runtime.scoutBriefStore.loadCurrent(intentId)
  if (!confirmedScoutBrief) return fail("knowledge scout", "No confirmed Scout Brief. Run brief apply first.")

  const staged = stageScoutKnowledge(confirmedScoutBrief, process.cwd())
  const existingBundle = runtime.stagedKnowledgeStore.loadLatest(intentId)
  if (existingBundle && existingBundle.status === "approved") {
    runtime.stagedKnowledgeStore.save({ ...existingBundle, status: "superseded", updatedAt: new Date().toISOString() })
  }
  runtime.stagedKnowledgeStore.save(staged.bundle)

  const summary: LastRunSummary = {
    timestamp: new Date().toISOString(),
    intentId: runtime.intent.id,
    cycleId: staged.bundle.scoutRunId,
    runType: "radar",
    sessionPatchCount: runtime.strategyManager.get().patches.length,
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
  runtime.lastRunStore.save(summary)

  return ok("knowledge scout", {
    bundleId: staged.bundle.bundleId,
    sourceTargets: staged.bundle.sourceLocators.length,
    filesScanned: staged.filesScanned,
    itemsCreated: staged.itemsCreated,
  }, [
    `radar-ctl knowledge review --intent ${intentId} --bundle ${staged.bundle.bundleId} --approve`,
  ])
}

async function runKnowledgeReview(intentId: string, bundleId: string, approve: boolean): Promise<RadarCtlResponse<JsonValue>> {
  const runtime = createRadarRuntime(intentId)
  const bundle = bundleId ? runtime.stagedKnowledgeStore.load(bundleId) : runtime.stagedKnowledgeStore.loadLatest(intentId)
  if (!bundle) return fail("knowledge review", "No staged knowledge bundle found.")
  if (!approve) {
    return ok("knowledge review", {
      bundleId: bundle.bundleId,
      status: bundle.status,
      itemCount: bundle.items.length,
    }, [])
  }
  const approved: StagedKnowledgeBundle = {
    ...bundle,
    status: "approved",
    updatedAt: new Date().toISOString(),
    items: bundle.items.map(item => ({ ...item, knowledgeReviewStatus: "approved" })),
  }
  runtime.stagedKnowledgeStore.save(approved)
  return ok("knowledge review", {
    bundleId: approved.bundleId,
    status: approved.status,
  }, [
    `radar-ctl graph plan --intent ${intentId} --bundle ${approved.bundleId}`,
  ])
}

async function runGraphPlan(intentId: string, bundleId: string): Promise<RadarCtlResponse<JsonValue>> {
  const runtime = createRadarRuntime(intentId)
  const bundle = bundleId ? runtime.stagedKnowledgeStore.load(bundleId) : runtime.stagedKnowledgeStore.loadLatest(intentId)
  if (!bundle) return fail("graph plan", "No staged knowledge bundle found.")
  if (bundle.status !== "approved") return fail("graph plan", `Bundle ${bundle.bundleId} is not approved yet.`)

  const existingPlan = runtime.graphMappingPlanStore.loadLatestByBundle(bundle.bundleId)
  if (existingPlan && existingPlan.status !== "applied") {
    runtime.graphMappingPlanStore.save({ ...existingPlan, status: "superseded", updatedAt: new Date().toISOString() })
  }
  const plan = draftGraphMappingPlan(bundle)
  runtime.graphMappingPlanStore.save(plan)
  runtime.stagedKnowledgeStore.save({
    ...bundle,
    updatedAt: new Date().toISOString(),
    items: bundle.items.map(item => ({ ...item, graphMappingStatus: "drafted" })),
  })
  return ok("graph plan", {
    planId: plan.planId,
    bundleId: bundle.bundleId,
    entryCount: plan.entries.length,
    summary: plan.summary,
  }, [
    `radar-ctl graph review --intent ${intentId} --plan ${plan.planId} --approve`,
  ])
}

async function runGraphReview(intentId: string, planId: string, approve: boolean): Promise<RadarCtlResponse<JsonValue>> {
  const runtime = createRadarRuntime(intentId)
  const plan = planId
    ? runtime.graphMappingPlanStore.load(planId)
    : runtime.stagedKnowledgeStore.loadLatest(intentId)
      ? runtime.graphMappingPlanStore.loadLatestByBundle(runtime.stagedKnowledgeStore.loadLatest(intentId)!.bundleId)
      : null
  if (!plan) return fail("graph review", "No graph mapping plan found.")
  if (!approve) return ok("graph review", { planId: plan.planId, status: plan.status }, [])

  const approvedPlan: GraphMappingPlan = {
    ...plan,
    status: "approved",
    updatedAt: new Date().toISOString(),
    entries: plan.entries.map(entry => ({ ...entry, status: "approved" })),
  }
  runtime.graphMappingPlanStore.save(approvedPlan)
  const bundle = runtime.stagedKnowledgeStore.load(approvedPlan.bundleId)
  if (bundle) {
    runtime.stagedKnowledgeStore.save({
      ...bundle,
      updatedAt: new Date().toISOString(),
      items: bundle.items.map(item => ({ ...item, graphMappingStatus: "approved" })),
    })
  }
  return ok("graph review", {
    planId: approvedPlan.planId,
    status: approvedPlan.status,
  }, [
    `radar-ctl graph apply --intent ${intentId} --plan ${approvedPlan.planId}`,
  ])
}

async function runGraphApply(intentId: string, planId: string): Promise<RadarCtlResponse<JsonValue>> {
  const runtime = createRadarRuntime(intentId)
  const plan = planId
    ? runtime.graphMappingPlanStore.load(planId)
    : runtime.stagedKnowledgeStore.loadLatest(intentId)
      ? runtime.graphMappingPlanStore.loadLatestByBundle(runtime.stagedKnowledgeStore.loadLatest(intentId)!.bundleId)
      : null
  if (!plan) return fail("graph apply", "No graph mapping plan found.")
  if (plan.status !== "approved") return fail("graph apply", `Plan ${plan.planId} is not approved yet.`)

  const result = await applyGraphMappingPlan(plan, DATA_DIR)
  const appliedPlan: GraphMappingPlan = {
    ...plan,
    status: "applied",
    updatedAt: new Date().toISOString(),
    entries: plan.entries.map(entry => ({ ...entry, status: "applied" })),
  }
  runtime.graphMappingPlanStore.save(appliedPlan)
  const bundle = runtime.stagedKnowledgeStore.load(appliedPlan.bundleId)
  if (bundle) {
    runtime.stagedKnowledgeStore.save({
      ...bundle,
      updatedAt: new Date().toISOString(),
      items: bundle.items.map(item => ({ ...item, graphMappingStatus: "applied" })),
    })
  }
  return ok("graph apply", {
    planId: result.planId,
    appliedTargets: result.appliedTargets,
    artifacts: result.results.reduce((sum, item) => sum + item.artifactsCreated, 0),
    sections: result.results.reduce((sum, item) => sum + item.sectionsCreated, 0),
    evidence: result.results.reduce((sum, item) => sum + item.evidenceExtracted, 0),
    facts: result.results.reduce((sum, item) => sum + item.factsPromoted, 0),
    projections: result.results.reduce((sum, item) => sum + item.projectionsRefreshed, 0),
    errors: result.errors,
  }, [
    "radar-ctl graph stats",
    "radar-ctl graph package-show --package <id>",
    "radar-ctl graph projection-show --projection <id|key>",
  ])
}

async function runGraphHealth(): Promise<RadarCtlResponse<JsonValue>> {
  const health = await checkHealth()
  return ok("graph health", {
    healthy: health.healthy,
    version: health.version ?? null,
    error: health.error ?? null,
  }, [])
}

async function runGraphBootstrap(): Promise<RadarCtlResponse<JsonValue>> {
  const result = await bootstrapGraph()
  return ok("graph bootstrap", {
    success: result.success,
    indexesCreated: result.indexesCreated,
    errors: result.errors,
  }, [])
}

async function runGraphStats(): Promise<RadarCtlResponse<JsonValue>> {
  return ok("graph stats", await getGraphStats() as JsonValue, [])
}

async function runPackageShow(packageId: string): Promise<RadarCtlResponse<JsonValue>> {
  const pkg = await getKnowledgePackage(packageId)
  if (!pkg) return fail("graph package-show", `Package not found: ${packageId}`)
  const artifacts = await findArtifactsByPackage(packageId)
  const projections = await findProjectionsByPackage(packageId)
  return ok("graph package-show", {
    id: pkg.id,
    path: pkg.package_path,
    kind: pkg.package_kind,
    title: pkg.title,
    confidence: pkg.confidence,
    freshness: pkg.freshness_status,
    artifacts: artifacts.map(art => ({
      id: art.id,
      kind: art.artifact_kind,
      pathOrUrl: art.artifact_path_or_url,
    })),
    projections: projections.map(proj => ({
      id: proj.id,
      kind: proj.projection_kind,
      key: proj.projection_key,
      title: proj.title,
    })),
  }, [])
}

async function runProjectionShow(projectionIdOrKey: string): Promise<RadarCtlResponse<JsonValue>> {
  let proj = await getProjection(projectionIdOrKey)
  if (!proj) proj = await findProjectionByKey(projectionIdOrKey)
  if (!proj) return fail("graph projection-show", `Projection not found: ${projectionIdOrKey}`)
  return ok("graph projection-show", {
    id: proj.id,
    kind: proj.projection_kind,
    key: proj.projection_key,
    title: proj.title,
    summary: proj.summary,
    freshness: proj.freshness_status,
    lastVerifiedAt: proj.last_verified_at,
  }, [])
}

async function runMeeting(packetOrTopic: string): Promise<RadarCtlResponse<JsonValue>> {
  let packetProj = packetOrTopic ? await getProjection(packetOrTopic) : null
  if (!packetProj && packetOrTopic) packetProj = await findProjectionByKey(packetOrTopic)
  if (!packetProj && packetOrTopic) {
    const allPackets = await findProjectionsByKind("MeetingPacket")
    packetProj = allPackets.find(p => p.projection_key.toLowerCase().includes(packetOrTopic.toLowerCase())) ?? null
  }
  if (!packetProj) {
    const packets = await findProjectionsByKind("MeetingPacket")
    packetProj = packets[0] ?? null
  }
  if (!packetProj) return fail("meeting run", "No MeetingPacket found in graph.")

  const pkg = await findPackageByProjection(packetProj.id)
  const facts = await findFactsByProjection(packetProj.id)
  const deliberation = deliberateMeetingPacket(packetProj, pkg, facts)
  return ok("meeting run", {
    projectionId: packetProj.id,
    projectionKey: packetProj.projection_key,
    packagePath: pkg?.package_path ?? null,
    factCount: facts.length,
    stance: deliberation.stance,
    summary: deliberation.summary,
    highlights: deliberation.highlights,
    evidenceGaps: deliberation.evidenceGaps,
    nextActions: deliberation.nextActions,
    rendered: renderMeetingPacketDeliberation(packetProj, pkg, facts, deliberation),
  }, [])
}

async function runTriageInbox(intentId: string): Promise<RadarCtlResponse<JsonValue>> {
  const runtime = createRadarRuntime(intentId)
  const cards = runtime.decisionCardStore.listByIntent(intentId, "inbox").map(x => x.card)
  return ok("triage inbox", {
    count: cards.length,
    cards: cards.map(card => ({
      cardId: card.cardId,
      kind: card.kind,
      status: card.status,
      title: card.title,
      topic: card.topic,
      decisionObjectId: card.decisionObjectId,
    })),
    rendered: renderInbox(cards),
  }, [])
}

type TriageAction = "pick" | "reject" | "defer" | "watch"

async function runTriageMutate(
  intentId: string,
  action: TriageAction,
  cardId: string,
  feedbackClass: FeedbackClass = "other",
  humanReason?: string,
): Promise<RadarCtlResponse<JsonValue>> {
  const runtime = createRadarRuntime(intentId)
  const loaded = runtime.decisionCardStore.load(cardId)
  if (!loaded) return fail(`triage ${action}`, `Card not found: ${cardId}`)

  const resolutionMap: Record<TriageAction, { resolution: ReviewResolution; status: "picked" | "rejected" | "deferred" | "watch" }> = {
    pick: { resolution: "approve", status: "picked" },
    reject: { resolution: "reject", status: "rejected" },
    defer: { resolution: "defer", status: "deferred" },
    watch: { resolution: "watch", status: "watch" },
  }
  const mapped = resolutionMap[action]!
  const reason = humanReason ?? (action === "pick" ? "picked for follow-up" : "(no reason provided)")

  const result = buildReviewConfirm({
    decisionObjectId: loaded.card.decisionObjectId,
    decisionObjectStatement: loaded.card.summary,
    resolution: mapped.resolution,
    feedbackClass,
    humanReason: reason,
    reviewedBy: "ctl-user",
    onApply: (feedback: HumanReviewFeedback, requests: EvidenceRequest[]) => {
      runtime.feedbackStore.save(feedback)
      for (const req of requests) runtime.evidenceRequestStore.save(req)
      runtime.decisionCardStore.transition(cardId, mapped.status, "processed")
      if (mapped.status === "rejected" || mapped.status === "deferred" || mapped.status === "watch") {
        const candidate: RetrospectiveCandidate = {
          candidateId: newRetrospectiveCandidateId(),
          decisionObjectId: loaded.card.decisionObjectId,
          triggerFeedbackId: feedback.feedbackId,
          candidateReason: reason,
          status: "candidate",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        runtime.retrospectiveCandidateStore.save(candidate)
      }
    },
  })
  result.onConfirm()

  return ok(`triage ${action}`, {
    cardId,
    status: mapped.status,
    resolution: mapped.resolution,
    feedbackId: result.feedback.feedbackId,
  }, [])
}

async function runScoutStatus(intentId: string): Promise<RadarCtlResponse<JsonValue>> {
  const runtime = createRadarRuntime(intentId)
  const runs = await findRecentScoutRuns(10)
  return ok("scout status", {
    intentId,
    recentRuns: runs.map(r => ({
      runId: r.run_id,
      mode: r.mode,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? null,
    })),
  }, [])
}

async function runScoutIngest(intentId: string, target: string): Promise<RadarCtlResponse<JsonValue>> {
  if (!target) return fail("scout ingest", "Missing --target")
  const runtime = createRadarRuntime(intentId)
  const result = await scoutIngest(target)
  return ok("scout ingest", {
    runId: result.runId,
    targetId: result.targetId,
    packageId: result.packageId,
    artifactsCreated: result.artifactsCreated,
    sectionsCreated: result.sectionsCreated,
    evidenceExtracted: result.evidenceExtracted,
    factsPromoted: result.factsPromoted,
    projectionsRefreshed: result.projectionsRefreshed,
    errors: result.errors,
  }, [])
}

async function runScoutRefresh(intentId: string, pkg: string): Promise<RadarCtlResponse<JsonValue>> {
  if (!pkg) return fail("scout refresh", "Missing --package")
  const runtime = createRadarRuntime(intentId)
  const result = await scoutRefresh(pkg)
  return ok("scout refresh", {
    runId: result.runId,
    packageId: result.packageId,
    artifactsCreated: result.artifactsCreated,
    factsPromoted: result.factsPromoted,
    projectionsRefreshed: result.projectionsRefreshed,
    errors: result.errors,
  }, [])
}

async function runTrace(target: string): Promise<RadarCtlResponse<JsonValue>> {
  if (!target) return fail("trace show", "Missing --id")
  const projectionEdges = await traceProjection(target)
  if (projectionEdges.length > 0) {
    return ok("trace show", {
      target,
      kind: "projection",
      edgeCount: projectionEdges.length,
      edges: projectionEdges.map(edge => ({
        from_id: edge.from_id,
        from_label: edge.from_label,
        rel_type: edge.rel_type,
        to_id: edge.to_id,
        to_label: edge.to_label,
      })),
    }, [])
  }
  const factEdges = await traceReferenceFact(target)
  if (factEdges.length > 0) {
    return ok("trace show", {
      target,
      kind: "reference_fact",
      edgeCount: factEdges.length,
      edges: factEdges.map(edge => ({
        from_id: edge.from_id,
        from_label: edge.from_label,
        rel_type: edge.rel_type,
        to_id: edge.to_id,
        to_label: edge.to_label,
      })),
    }, [])
  }
  return fail("trace show", `Nothing traceable found for "${target}".`)
}

function usage(): string {
  return [
    "Usage: radar-ctl <family> <action> [options]",
    "",
    "Families:",
    "  overview state|graph",
    "  brief draft|apply",
    "  knowledge scout|review",
    "  graph plan|review|apply|health|bootstrap|stats|package-show|projection-show",
    "  meeting run",
    "  triage inbox|pick|reject|defer|watch",
    "  scout status|ingest|refresh",
    "  trace show",
    "",
    "Common flags:",
    "  --intent <id>",
    "  --json",
    "",
    "Triage flags:",
    "  --card <id>",
    "  --feedback-class <class>  (not_real_opportunity|insufficient_evidence|wrong_timing|",
    "                              not_strategic_now|duplicate|already_known|cannot_execute_now|other)",
    "  --reason <text>",
    "",
    "Scout flags:",
    "  --target <path>",
    "  --package <name>",
  ].join("\n")
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const asJson = flagBool(flags, "--json")
  const intentId = flagString(flags, "--intent", "default")
  const [family = "", action = ""] = positional

  let response: RadarCtlResponse<JsonValue>

  try {
    switch (`${family} ${action}`.trim()) {
      case "overview state":
        response = await runOverviewState(intentId)
        break
      case "overview graph":
        response = await runOverviewGraph()
        break
      case "brief draft":
        response = await runBriefDraft(intentId, flagString(flags, "--prompt"))
        break
      case "brief apply":
        response = await runBriefApply(intentId, flagString(flags, "--brief"), flagString(flags, "--goal"))
        break
      case "knowledge scout":
        response = await runKnowledgeScout(intentId)
        break
      case "knowledge review":
        response = await runKnowledgeReview(intentId, flagString(flags, "--bundle"), flagBool(flags, "--approve"))
        break
      case "graph plan":
        response = await runGraphPlan(intentId, flagString(flags, "--bundle"))
        break
      case "graph review":
        response = await runGraphReview(intentId, flagString(flags, "--plan"), flagBool(flags, "--approve"))
        break
      case "graph apply":
        response = await runGraphApply(intentId, flagString(flags, "--plan"))
        break
      case "graph health":
        response = await runGraphHealth()
        break
      case "graph bootstrap":
        response = await runGraphBootstrap()
        break
      case "graph stats":
        response = await runGraphStats()
        break
      case "graph package-show":
        response = await runPackageShow(flagString(flags, "--package"))
        break
      case "graph projection-show":
        response = await runProjectionShow(flagString(flags, "--projection"))
        break
      case "meeting run":
        response = await runMeeting(flagString(flags, "--packet") || flagString(flags, "--topic"))
        break
      case "triage inbox":
        response = await runTriageInbox(intentId)
        break
      case "triage pick":
        response = await runTriageMutate(
          intentId, "pick", flagString(flags, "--card"),
          (flagString(flags, "--feedback-class") || "other") as FeedbackClass,
          flagString(flags, "--reason"),
        )
        break
      case "triage reject":
        response = await runTriageMutate(
          intentId, "reject", flagString(flags, "--card"),
          (flagString(flags, "--feedback-class") || "other") as FeedbackClass,
          flagString(flags, "--reason"),
        )
        break
      case "triage defer":
        response = await runTriageMutate(
          intentId, "defer", flagString(flags, "--card"),
          (flagString(flags, "--feedback-class") || "other") as FeedbackClass,
          flagString(flags, "--reason"),
        )
        break
      case "triage watch":
        response = await runTriageMutate(
          intentId, "watch", flagString(flags, "--card"),
          (flagString(flags, "--feedback-class") || "other") as FeedbackClass,
          flagString(flags, "--reason"),
        )
        break
      case "scout status":
        response = await runScoutStatus(intentId)
        break
      case "scout ingest":
        response = await runScoutIngest(intentId, flagString(flags, "--target"))
        break
      case "scout refresh":
        response = await runScoutRefresh(intentId, flagString(flags, "--package"))
        break
      case "trace show":
        response = await runTrace(flagString(flags, "--id"))
        break
      default:
        response = fail("radar-ctl", usage())
        break
    }
  } catch (error) {
    response = fail(`${family} ${action}`.trim() || "radar-ctl", error instanceof Error ? error.message : String(error))
  }

  printResponse(response, asJson)
  process.exitCode = response.status === "ok" ? 0 : 1
}

void main()
