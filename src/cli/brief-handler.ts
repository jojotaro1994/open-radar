import crypto from "crypto"
import type { ScoutBrief } from "../state/scout-brief.js"
import type { MeetingGoal, DecisionLens, PriorityBias } from "../state/meeting-goal.js"
import type { SearchContext } from "../state/search-context.js"
import type { MeetingCharter } from "../state/meeting-charter.js"

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

function extractSourceScope(text: string): string[] {
  const urls = [...text.matchAll(/https?:\/\/[^\s)]+/g)].map(m => m[0]!)
  // Filter out protocol-relative URLs (//www.example.com/...) which start with //
  const paths = [...text.matchAll(/(?:\/Users\/[^\s]+|\.{0,2}\/[^\s]+)/g)]
    .map(m => m[0]!)
    .filter(p => !p.startsWith("//"))
  return [...new Set([...urls, ...paths])]
}

function inferPrimaryQuestions(text: string): string[] {
  const lines = text.split(/[。.!?\n]/).map(s => s.trim()).filter(Boolean)
  if (lines.length === 0) return [text.trim()]
  return lines.slice(0, 3)
}

function inferPriorityDimensions(text: string): string[] {
  const lower = text.toLowerCase()
  const dims: string[] = []
  if (/(upsell|growth|expansion|机会)/i.test(text)) dims.push("growth")
  if (/(risk|retention|renewal|churn|留存)/i.test(text)) dims.push("retention")
  if (/(gap|feature|capability|产品)/i.test(text)) dims.push("product-gap")
  if (/(execution|process|delivery|交付|执行)/i.test(text)) dims.push("execution")
  if (/(competitor|竞品|positioning|包装)/i.test(text)) dims.push("positioning")
  return dims.length > 0 ? dims : ["evidence-backed relevance"]
}

function inferOutOfScope(text: string): string[] {
  const patterns = [...text.matchAll(/(?:not|don't|do not|不要|排除)\s+([^,.;\n]+)/gi)].map(m => m[1]!.trim())
  return [...new Set(patterns)]
}

function inferDecisionLens(text: string): DecisionLens {
  const lower = text.toLowerCase()
  const hitOpp = /(opportunity|机会|upsell|expansion|growth)/i.test(text)
  const hitRisk = /(risk|风险|retention|churn)/i.test(text)
  const hitGap = /(gap|缺口|product gap|capability gap)/i.test(text)
  const count = [hitOpp, hitRisk, hitGap].filter(Boolean).length
  if (count > 1) return "mixed"
  if (hitRisk) return "risk"
  if (hitGap) return "gap"
  return "opportunity"
}

function inferPriorityBias(text: string): PriorityBias {
  if (/(retention|churn|renewal|留存)/i.test(text)) return "retention"
  if (/(packaging|positioning|打包|包装)/i.test(text)) return "packaging"
  if (/(execution|process|delivery|执行|交付)/i.test(text)) return "execution"
  if (/(growth|upsell|expansion|增长|机会)/i.test(text)) return "growth"
  return "balanced"
}

export function draftScoutBrief(prompt: string, intentId: string): ScoutBrief {
  const now = new Date().toISOString()
  return {
    briefId: genId("sbrief"),
    intentId,
    prompt,
    objective: prompt.trim(),
    primaryQuestions: inferPrimaryQuestions(prompt),
    priorityDimensions: inferPriorityDimensions(prompt),
    outOfScope: inferOutOfScope(prompt),
    sourceScope: extractSourceScope(prompt),
    status: "draft",
    createdAt: now,
    updatedAt: now,
  }
}

export function draftMeetingGoal(prompt: string, intentId: string): MeetingGoal {
  const now = new Date().toISOString()
  return {
    meetingGoalId: genId("mgoal"),
    intentId,
    prompt,
    decisionLens: inferDecisionLens(prompt),
    successCriteria: `Use evidence-backed judgment for: ${prompt.trim()}`,
    priorityBias: inferPriorityBias(prompt),
    topicScope: extractSourceScope(prompt),
    status: "draft",
    createdAt: now,
    updatedAt: now,
  }
}

export function renderBriefPreview(brief: ScoutBrief, goal: MeetingGoal): string {
  return [
    "Brief draft preview:",
    "",
    `Scout Brief [${brief.briefId}]`,
    `  objective: ${brief.objective}`,
    `  primaryQuestions: ${brief.primaryQuestions.join(" | ")}`,
    `  priorityDimensions: ${brief.priorityDimensions.join(", ") || "(none)"}`,
    `  outOfScope: ${brief.outOfScope.join(", ") || "(none)"}`,
    `  sourceScope: ${brief.sourceScope.join(", ") || "(none detected)"}`,
    "",
    `Meeting Goal [${goal.meetingGoalId}]`,
    `  decisionLens: ${goal.decisionLens}`,
    `  successCriteria: ${goal.successCriteria}`,
    `  priorityBias: ${goal.priorityBias}`,
    `  topicScope: ${goal.topicScope.join(", ") || "(inherits scout scope)"}`,
    "",
    "Type 'y' to confirm, 'n' to cancel",
  ].join("\n")
}

export function confirmScoutBrief(brief: ScoutBrief): ScoutBrief {
  return { ...brief, status: "confirmed", updatedAt: new Date().toISOString() }
}

export function confirmMeetingGoal(goal: MeetingGoal): MeetingGoal {
  return { ...goal, status: "confirmed", updatedAt: new Date().toISOString() }
}

export function supersedeScoutBrief(brief: ScoutBrief): ScoutBrief {
  return { ...brief, status: "superseded", updatedAt: new Date().toISOString() }
}

export function supersedeMeetingGoal(goal: MeetingGoal): MeetingGoal {
  return { ...goal, status: "superseded", updatedAt: new Date().toISOString() }
}

export function scoutBriefToSearchContext(brief: ScoutBrief): SearchContext {
  return {
    id: `${brief.intentId}-scout-brief`,
    intentId: brief.intentId,
    sourceWeights: [],
    topicBoosts: brief.priorityDimensions.map(term => ({ term, boost: 0.25 })),
    topicSuppressions: brief.outOfScope,
    recallMode: "normal",
    noiseTolerance: 0.5,
    searchNotes: brief.objective,
    createdAt: brief.createdAt,
    updatedAt: brief.updatedAt,
  }
}

export function meetingGoalToCharter(goal: MeetingGoal): MeetingCharter {
  return {
    id: `${goal.intentId}-meeting-goal`,
    intentId: goal.intentId,
    objective: goal.successCriteria,
    primaryLens: goal.decisionLens,
    requiredQuestions: [],
    avoidOverweighting: [],
    decisionStyle: goal.priorityBias === "growth"
      ? "aggressive"
      : goal.priorityBias === "retention"
      ? "conservative"
      : "balanced",
    meetingNotes: goal.prompt,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  }
}
