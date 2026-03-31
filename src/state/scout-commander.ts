/**
 * Scout Commander — generates an auditable ScoutPlan before each radar run.
 *
 * This is the first version of the Scout Organization operating model.
 * It is a deterministic planner, NOT a freeform agent.
 *
 * Design principles:
 * - Reads Intent + Scout Brief + Knowledge Base + Knowledge Pack
 * - Produces explicit Scout Assignments with rationale
 * - Records exclusions and overlaps explicitly
 * - Survives as audit trail
 *
 * What it does NOT do (not in v1):
 * - True parallel scout execution (not required for auditable planner)
 * - Dynamic re-planning mid-run
 * - Autonomous goal rewriting
 * - Knowledge Base -> Knowledge Pack distillation (that is the Knowledge Workflow)
 */

import type { ScoutPlan, ScoutAssignment, ScoutSliceObjective } from "./scout-plan.js"
import type { SearchContext } from "./search-context.js"
import type { KnowledgeBase } from "./knowledge-base.js"
import type { KnowledgePack } from "./knowledge-pack.js"
import type { RadarIntent } from "../schemas/intent.js"

const ASSIGNMENT_IDS = ["scout-a", "scout-b", "scout-c", "scout-d"]

function slugToObjective(slug: string): ScoutSliceObjective {
  const map: Record<string, ScoutSliceObjective> = {
    renewal: "renewal_opportunity",
    claims: "claims_notification",
    broker: "broker_workflow",
    apac: "apac_channel",
    line: "apac_channel",
    whatsapp: "apac_channel",
    crosssell: "cross_sell",
    cross_sell: "cross_sell",
    multi_policy: "multi_policy",
    household: "multi_policy",
  }
  return map[slug.toLowerCase()] ?? "general"
}

function inferObjectives(searchContext: SearchContext | undefined, knowledgePack: KnowledgePack | undefined): ScoutSliceObjective[] {
  const objectives: Set<ScoutSliceObjective> = new Set(["general"])

  if (searchContext) {
    for (const boost of searchContext.topicBoosts ?? []) {
      const obj = slugToObjective(boost.term)
      if (obj !== "general") objectives.add(obj)
    }
  }

  if (knowledgePack?.verticalContext) {
    const vc = knowledgePack.verticalContext.toLowerCase()
    if (vc.includes("renewal")) objectives.add("renewal_opportunity")
    if (vc.includes("claim")) objectives.add("claims_notification")
    if (vc.includes("broker")) objectives.add("broker_workflow")
    if (vc.includes("line") || vc.includes("whatsapp") || vc.includes("apac")) objectives.add("apac_channel")
    if (vc.includes("cross-sell") || vc.includes("cross sell")) objectives.add("cross_sell")
    if (vc.includes("multi-policy") || vc.includes("household")) objectives.add("multi_policy")
  }

  return [...objectives]
}

function buildAssignments(
  objectives: ScoutSliceObjective[],
  searchContext: SearchContext | undefined,
  knowledgePack: KnowledgePack | undefined,
): ScoutAssignment[] {
  const assignments: ScoutAssignment[] = []
  const n = Math.min(objectives.length, ASSIGNMENT_IDS.length)

  // All topic boosts from Scout Brief (lowercased for matching)
  const topicBoosts = searchContext?.topicBoosts?.map(b => b.term.toLowerCase()) ?? []

  for (let i = 0; i < n; i++) {
    const objective = objectives[i]
    const assignmentId = ASSIGNMENT_IDS[i]

    // Per-assignment topic focus: general scout gets all boosts;
    // specific-objective scouts get only the subset of boosts relevant to their slice.
    // This makes the Scout Plan meaningful — each scout knows what to prioritize.
    const objectiveKeywords = getObjectiveKeywords(objective)
    const matchedBoosts = objective === "general"
      ? topicBoosts
      : topicBoosts.filter(boost =>
          objectiveKeywords.some(kw => boost.includes(kw))
        )
    const topicFocus = matchedBoosts

    // Derive dispatch weight from objective-keyword match with Scout Brief boosts.
    // This makes the Scout Plan reflect "which scouts the operator cares about most."
    // General gets baseline; specific objectives get higher if their keywords appear in boosts.
    const matchCount = objectiveKeywords.filter(kw => topicBoosts.some(boost => boost.includes(kw))).length
    // dispatchWeight: 1.0 base + 0.25 per matched keyword (max 2.0)
    const dispatchWeight = Math.min(2.0, 1.0 + matchCount * 0.25)

    // budgetWeight reflects depth/completeness priority; matched objectives get
    // higher budget for deeper signal harvesting.
    const budgetWeight = Math.min(2.0, 0.8 + matchCount * 0.3)

    const assignment: ScoutAssignment = {
      assignmentId,
      objective,
      description: describeObjective(objective),
      allowedSources: extractAllowedSources(searchContext),
      excludedSources: extractExcludedSources(searchContext),
      topicFocus,
      additionalSuppressions: [],
      overlapPolicy: objectives.length > 1 ? "allowed" : "none",
      rationale: `Scout ${assignmentId.toUpperCase()} focuses on ${objective.replace(/_/g, " ")}. ${matchCount > 0 ? `Matched ${matchCount} boost keyword(s) in Scout Brief — prioritized topics: ${matchedBoosts.slice(0, 3).join(", ")}${matchedBoosts.length > 3 ? "..." : ""}.` : "No explicit boost keyword match; baseline priority."}`,
      separationRationale: objectives.length > 1
        ? `Separated from other scouts to allow parallel investigation of distinct opportunity slices.`
        : "Single-slice plan — only one dominant objective detected.",
      stopConditions: buildStopConditions(objective),
      dispatchWeight,
      budgetWeight,
    }

    assignments.push(assignment)
  }

  return assignments
}

function describeObjective(o: ScoutSliceObjective): string {
  switch (o) {
    case "renewal_opportunity": return "Scout for policy renewal and retention opportunities"
    case "claims_notification": return "Scout for claims communication and SLA-driven notification opportunities"
    case "broker_workflow": return "Scout for broker-mediated distribution and communication workflows"
    case "apac_channel": return "Scout for APAC-native messaging channels (LINE, WhatsApp Business)"
    case "cross_sell": return "Scout for cross-sell and multi-policy household opportunities"
    case "multi_policy": return "Scout for multi-policy household and contact model opportunities"
    default: return "Scout for general insurance/travel MA opportunities"
  }
}

function getObjectiveKeywords(o: ScoutSliceObjective): string[] {
  switch (o) {
    case "renewal_opportunity": return ["renewal", "renew", "retention", "churn"]
    case "claims_notification": return ["claim", "claims", "notification", "sla", "loss", "adjuster"]
    case "broker_workflow": return ["broker", "agency", "agent", "intermediary", "wholesaler"]
    case "apac_channel": return ["line", "whatsapp", "messenger", "apac", "thailand", "indonesia", "malaysia"]
    case "cross_sell": return ["cross-sell", "cross_sell", "upsell", "multi-policy", "household", "bundle"]
    case "multi_policy": return ["multi-policy", "household", "family", "bundle", "multi-policy"]
    default: return []
  }
}

function extractAllowedSources(searchContext: SearchContext | undefined): string[] {
  if (!searchContext?.sourceWeights) return []
  return searchContext.sourceWeights.filter(w => w.weight > 0).map(w => w.sourceId)
}

function extractExcludedSources(searchContext: SearchContext | undefined): string[] {
  if (!searchContext?.sourceWeights) return []
  return searchContext.sourceWeights.filter(w => w.weight === 0).map(w => w.sourceId)
}

function buildStopConditions(objective: ScoutSliceObjective): string[] {
  const base = [
    "Signal count exceeds practical review capacity (>20 per scout)",
    "No relevant signals found after exhausting source pages",
  ]
  switch (objective) {
    case "renewal_opportunity":
      return [...base, "Renewal-specific signals confirmed from multiple sources"]
    case "claims_notification":
      return [...base, "SLA-driven notification requirements confirmed"]
    case "broker_workflow":
      return [...base, "Broker communication patterns identified"]
    case "apac_channel":
      return [...base, "LINE/WhatsApp integration requirements documented"]
    default:
      return base
  }
}

export function generateScoutPlan(
  cycleId: string,
  intent: RadarIntent,
  searchContext: SearchContext | undefined,
  knowledgePack: KnowledgePack | undefined,
  knowledgeBase?: KnowledgeBase | undefined,
): ScoutPlan {
  const objectives = inferObjectives(searchContext, knowledgePack)
  const assignments = buildAssignments(objectives, searchContext, knowledgePack)

  const exclusions = (searchContext?.topicSuppressions ?? []).map(term => ({ reason: `Topic suppression: ${term}` }) )
  const excludedSources = extractExcludedSources(searchContext)
  exclusions.push(...excludedSources.map(s => ({ reason: `Source suppressed: ${s}` })))

  const plan: ScoutPlan = {
    cycleId,
    generatedAt: new Date().toISOString(),
    intentId: intent.id,
    totalAssignments: assignments.length,
    assignments,
    planRationale: buildPlanRationale(intent.id, assignments, searchContext, knowledgePack),
    exclusions,
    overlaps: buildOverlapRecords(assignments),
    scoutBriefSnapshot: searchContext as unknown as Record<string, unknown> ?? {},
    knowledgePackSnapshot: knowledgePack as unknown as Record<string, unknown> ?? {},
    knowledgeBaseSnapshot: knowledgeBase as unknown as Record<string, unknown> ?? {},
  }

  return plan
}

function buildPlanRationale(
  intentId: string,
  assignments: ScoutAssignment[],
  searchContext: SearchContext | undefined,
  knowledgePack: KnowledgePack | undefined,
): string {
  const lines: string[] = []
  lines.push(`Plan generated for intent=${intentId} with ${assignments.length} scout assignment(s).`)

  if (searchContext?.recallMode) {
    lines.push(`Recall mode=${searchContext.recallMode}.`)
  }
  if (searchContext?.topicBoosts?.length) {
    lines.push(`Topic boosts: ${searchContext.topicBoosts.map(b => b.term).join(", ")}.`)
  }
  if (knowledgePack?.verticalContext) {
    const vc = knowledgePack.verticalContext.slice(0, 80)
    lines.push(`Vertical context: ${vc}${knowledgePack.verticalContext.length > 80 ? "..." : ""}.`)
  }

  return lines.join(" ")
}

function buildOverlapRecords(assignments: ScoutAssignment[]): ScoutPlan["overlaps"] {
  const records: ScoutPlan["overlaps"] = []
  const allowedAssignments = assignments.filter(a => a.overlapPolicy !== "none")
  if (allowedAssignments.length > 1) {
    records.push({
      assignmentIds: allowedAssignments.map(a => a.assignmentId),
      reason: "APAC channel signals (LINE + WhatsApp) may overlap — allowed to capture cross-channel patterns.",
    })
  }
  return records
}
