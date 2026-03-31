/**
 * BA Meeting Room — produces structured MeetingRecord for each triage decision.
 *
 * This is the first version of the BA Meeting Room operating model.
 * It is a deterministic transformer, NOT a freeform discussion.
 *
 * Design:
 * - Reads triage decision + Commercial Analyst assessment (already computed)
 * - Reads Meeting Goal for structured lens inputs
 * - Produces MeetingRecord with four structured lens outputs
 *
 * What it does NOT do (not in v1):
 * - Freeform multi-agent debate
 * - Theatrical dialogue
 * - Autonomous reasoning
 */

import type { MeetingRecord } from "./meeting-record.js"
import type { MeetingCharter } from "./meeting-charter.js"
import type { KnowledgePack } from "./knowledge-pack.js"
import type { CommercialAssessment } from "../schemas/commercial-assessment.js"
import type { MeetingContextEnvelope } from "./context-envelopes.js"
import { buildMeetingGuidance } from "./context-envelopes.js"

type TriageDecision = "approved" | "rejected" | "deferred"

function inferCategory(assessment: CommercialAssessment): MeetingRecord["lenses"]["opportunity"]["category"] {
  const cats = assessment.category ?? "general"
  if (cats.includes("renewal")) return "renewal"
  if (cats.includes("claim") || cats.includes("claims")) return "claims"
  if (cats.includes("channel") || cats.includes("apac") || cats.includes("line") || cats.includes("whatsapp")) return "channel"
  if (cats.includes("broker")) return "broker"
  if (cats.includes("cross-sell") || cats.includes("cross_sell")) return "cross_sell"
  return "general"
}

function inferVerticals(assessment: CommercialAssessment): string[] {
  return assessment.verticalTags ?? []
}

function inferImpact(
  assessment: CommercialAssessment | null,
  decisionStyle?: MeetingCharter["decisionStyle"],
): MeetingRecord["lenses"]["opportunity"]["commercialImpact"] {
  const score = assessment?.opportunityScore ?? 0
  // Apply decision-style threshold adjustment to opportunityScore threshold
  const thresholdHigh = decisionStyle === "aggressive" ? 0.6 : decisionStyle === "conservative" ? 0.8 : 0.7
  const thresholdLow = decisionStyle === "aggressive" ? 0.3 : decisionStyle === "conservative" ? 0.5 : 0.4
  if (score >= thresholdHigh) return "high"
  if (score >= thresholdLow) return "medium"
  return "low"
}

function inferFitLevel(assessment: CommercialAssessment): MeetingRecord["lenses"]["productFit"]["fitLevel"] {
  const confidence = assessment.confidence ?? 0
  if (confidence >= 0.7) return "strong"
  if (confidence >= 0.4) return "moderate"
  return "weak"
}

export function evaluateWithMeetingRoom(
  signalId: string,
  cycleId: string,
  decision: TriageDecision,
  assessment: CommercialAssessment | null,
  meetingCharter: MeetingCharter | undefined,
  knowledgePack: KnowledgePack | undefined,
): MeetingRecord {
  const now = new Date().toISOString()
  const tags: string[] = []

  // Build opportunity lens
  const category = assessment ? inferCategory(assessment) : "general"
  tags.push(category)
  const verticals = assessment ? inferVerticals(assessment) : []
  const impact = inferImpact(assessment, meetingCharter?.decisionStyle)

  const opportunityLens: MeetingRecord["lenses"]["opportunity"] = {
    conclusion: assessment?.reasoning ?? `Signal assessed as ${decision}.`,
    supportingEvidence: assessment?.missingEvidence ?? [],
    evidenceGaps: assessment?.missingEvidence ?? [],
    category,
    verticals,
    commercialImpact: impact,
  }

  // Build skeptic lens
  const weaknesses: string[] = []
  const riskFactors: string[] = []
  if (assessment?.missingEvidence?.length) {
    weaknesses.push(...assessment.missingEvidence.slice(0, 3))
  }
  if (!assessment || assessment.confidence < 0.5) {
    riskFactors.push("Low confidence in commercial relevance assessment")
  }
  if (decision === "deferred") {
    riskFactors.push("Deferred — insufficient evidence for strong case")
  }
  tags.push(assessment?.commercialRelevance ? "commercial" : "non-commercial")

  const skepticLens: MeetingRecord["lenses"]["skeptic"] = {
    conclusion: weaknesses.length > 0
      ? `Evidence gaps identified: ${weaknesses.join("; ")}`
      : "No significant evidence gaps identified.",
    supportingEvidence: riskFactors,
    evidenceGaps: assessment?.missingEvidence ?? [],
    weaknesses,
    riskFactors,
  }

  // Build product fit lens
  const improvementPaths: string[] = []
  if (knowledgePack?.knownLimitations?.length) {
    improvementPaths.push(...knowledgePack.knownLimitations.slice(0, 2))
  }
  const fitLevel = assessment ? inferFitLevel(assessment) : "weak"

  const productFitLens: MeetingRecord["lenses"]["productFit"] = {
    conclusion: `Product fit assessed as ${fitLevel}. ${improvementPaths.length > 0 ? `Improvement paths: ${improvementPaths.join("; ")}` : ""}`,
    supportingEvidence: knowledgePack?.productCapabilities?.slice(0, 3).map(c => c.capability) ?? [],
    evidenceGaps: improvementPaths,
    fitLevel,
    improvementPaths,
  }

  // Build chair decision
  const decisionRationale = assessment
    ? `[${assessment.category}] ${assessment.reasoning}`
    : `Rule-based triage: ${decision} — no LLM assessment available.`

  const chairLens: MeetingRecord["lenses"]["chair"] = {
    summary: `Signal ${signalId} assessed as ${decision} by BA Meeting Room. Category=${category}, impact=${impact}, fit=${fitLevel}.`,
    finalDecision: decision,
    decisionRationale,
  }

  const meetingRecord: MeetingRecord = {
    cycleId,
    signalId,
    evaluatedAt: now,
    meetingGoalSnapshot: meetingCharter as unknown as Record<string, unknown> ?? {},
    lenses: {
      chair: chairLens,
      opportunity: opportunityLens,
      skeptic: skepticLens,
      productFit: productFitLens,
    },
    nextEvidenceNeeded: assessment?.missingEvidence ?? [],
    tags,
  }

  return meetingRecord
}

/**
 * Evaluate a DecisionObject at the meeting governance level.
 *
 * This is the DecisionObject-centered equivalent of evaluateWithMeetingRoom.
 * It reads the DecisionObject's Finding bundle (and their Evidence) to produce
 * a structured MeetingRecord with a decisionObjectId reference.
 *
 * Currently produces the meeting record using the highest-confidence assessment
 * among signals in the DecisionObject's evidence bundle. Full multi-signal
 * aggregation is the next step.
 */
export function evaluateDecisionObjectWithMeetingRoom(
  decisionObjectId: string,
  cycleId: string,
  assessments: Map<string, CommercialAssessment>,
  meetingCharter: MeetingCharter | undefined,
  knowledgePack: KnowledgePack | undefined,
  meetingEnvelope?: MeetingContextEnvelope,
): MeetingRecord {
  const now = new Date().toISOString()

  // Aggregate across all signals in the bundle — use the highest opportunityScore assessment
  let bestAssessment: CommercialAssessment | null = null
  for (const [, a] of assessments) {
    if (!bestAssessment || (a.opportunityScore ?? 0) > (bestAssessment.opportunityScore ?? 0)) {
      bestAssessment = a
    }
  }

  // Collect supporting evidence IDs from the finding bundle when meetingEnvelope is provided
  const supportingEvidenceFromFindings: string[] = []
  const evidenceGapsFromEvidence: string[] = []
  if (meetingEnvelope?.findingBundle?.[decisionObjectId]) {
    for (const f of meetingEnvelope.findingBundle[decisionObjectId]) {
      supportingEvidenceFromFindings.push(`finding:${f.findingId}`)
    }
  }
  if (meetingEnvelope?.evidenceBundle) {
    for (const [, evList] of Object.entries(meetingEnvelope.evidenceBundle)) {
      for (const ev of evList) {
        evidenceGapsFromEvidence.push(`evidence:${ev.evidenceId}:${(ev.normalizedText ?? "").slice(0, 80)}`)
      }
    }
  }

  const category = bestAssessment ? inferCategory(bestAssessment) : "general"
  const verticals = bestAssessment ? inferVerticals(bestAssessment) : []
  const impact = inferImpact(bestAssessment, meetingCharter?.decisionStyle)
  const fitLevel = bestAssessment ? inferFitLevel(bestAssessment) : "weak"

  // When meetingEnvelope is available, derive the decisionObject from it for metrics guidance
  const decisionObjectFromEnvelope = meetingEnvelope?.decisionObjects.find(
    d => d.decisionObjectId === decisionObjectId,
  )
  const meetingGuidance = meetingEnvelope && meetingCharter && decisionObjectFromEnvelope
    ? buildMeetingGuidance({
        decisionStyle: meetingCharter.decisionStyle,
        priorityBand: decisionObjectFromEnvelope.priorityBand,
        metricsImpact: decisionObjectFromEnvelope.metricsImpact,
      })
    : null

  const opportunityLens: MeetingRecord["lenses"]["opportunity"] = {
    conclusion: bestAssessment?.reasoning ?? `DecisionObject ${decisionObjectId} evaluated by BA Meeting Room.`,
    supportingEvidence: [
      ...(bestAssessment?.missingEvidence ?? []),
      ...supportingEvidenceFromFindings,
    ],
    evidenceGaps: [
      ...(bestAssessment?.missingEvidence ?? []),
      ...evidenceGapsFromEvidence,
    ],
    category,
    verticals,
    commercialImpact: impact,
  }

  const weaknesses: string[] = []
  const riskFactors: string[] = []
  if (bestAssessment?.missingEvidence?.length) {
    weaknesses.push(...bestAssessment.missingEvidence.slice(0, 3))
  }
  if (!bestAssessment || (bestAssessment.confidence ?? 0) < 0.5) {
    riskFactors.push("Low confidence in commercial relevance assessment")
  }
  riskFactors.push(`DecisionObject-level evaluation: ${assessments.size} signal assessment(s) aggregated`)
  if (meetingEnvelope) {
    // Prior feedback — consumed to drive governance signals
    const priorFeedback = meetingEnvelope.priorFeedback
    if (priorFeedback && priorFeedback.length > 0) {
      riskFactors.push(`Prior feedback: ${priorFeedback.length} prior feedback record(s) on this DecisionObject`)
      const priorRejections = priorFeedback.filter(f => f.resolution === "reject")
      if (priorRejections.length > 0) {
        weaknesses.push(`Previously rejected (${priorRejections.length} prior rejection(s)) — review prior rationale carefully`)
        riskFactors.push(`Prior rejection count: ${priorRejections.length} — escalating scrutiny`)
      }
      const feedbackClasses = priorFeedback.map(f => f.feedbackClass).filter(Boolean)
      if (feedbackClasses.length > 0) {
        riskFactors.push(`Prior feedback classes: ${[...new Set(feedbackClasses)].join(", ")}`)
      }
    }

    // Reference facts — consumed as governance context (baseline truths for this topic)
    const referenceFacts = meetingEnvelope.referenceFacts
    if (referenceFacts && referenceFacts.length > 0) {
      riskFactors.push(`Reference facts: ${referenceFacts.length} baseline fact(s) available for this topic`)
    }

    riskFactors.push("MeetingContextEnvelope fully consumed: findingBundle + evidenceBundle + priorFeedback + referenceFacts")
  }

  const skepticLens: MeetingRecord["lenses"]["skeptic"] = {
    conclusion: weaknesses.length > 0
      ? `Evidence gaps identified: ${weaknesses.join("; ")}`
      : "No significant evidence gaps identified.",
    supportingEvidence: riskFactors,
    evidenceGaps: [
      ...(bestAssessment?.missingEvidence ?? []),
      ...evidenceGapsFromEvidence,
      // Surface reference fact titles as explicit evidence gaps the reviewer should reconcile
      ...(meetingEnvelope?.referenceFacts?.map(rf => `ref:${rf.referenceFactId}:${rf.title}`) ?? []),
    ],
    weaknesses,
    riskFactors,
  }

  const improvementPaths: string[] = []
  if (knowledgePack?.knownLimitations?.length) {
    improvementPaths.push(...knowledgePack.knownLimitations.slice(0, 2))
  }

  const productFitLens: MeetingRecord["lenses"]["productFit"] = {
    conclusion: `Product fit assessed as ${fitLevel}. ${improvementPaths.length > 0 ? `Improvement paths: ${improvementPaths.join("; ")}` : ""}`,
    supportingEvidence: knowledgePack?.productCapabilities?.slice(0, 3).map(c => c.capability) ?? [],
    evidenceGaps: improvementPaths,
    fitLevel,
    improvementPaths,
  }

  const decisionRationale = bestAssessment
    ? `[DecisionObject ${decisionObjectId}] [${bestAssessment.category}] ${bestAssessment.reasoning}`
    : `Rule-based DecisionObject evaluation — no LLM assessment available.`

  const guidanceNote = meetingGuidance ? ` | Guidance: ${meetingGuidance}` : ""
  const chairLens: MeetingRecord["lenses"]["chair"] = {
    summary: `DecisionObject ${decisionObjectId} evaluated by BA Meeting Room. Category=${category}, impact=${impact}, fit=${fitLevel}, signals=${assessments.size}.${guidanceNote}`,
    finalDecision: "deferred", // DecisionObject-level governance always starts as deferred until human review
    decisionRationale,
  }

  const meetingRecord: MeetingRecord = {
    cycleId,
    decisionObjectId,
    evaluatedAt: now,
    meetingGoalSnapshot: meetingCharter as unknown as Record<string, unknown> ?? {},
    lenses: {
      chair: chairLens,
      opportunity: opportunityLens,
      skeptic: skepticLens,
      productFit: productFitLens,
    },
    nextEvidenceNeeded: bestAssessment?.missingEvidence ?? [],
    tags: [bestAssessment?.commercialRelevance ? "commercial" : "non-commercial", category],
  }

  return meetingRecord
}
