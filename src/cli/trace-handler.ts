import type { DecisionObject } from "../state/decision-object.js"
import type { DecisionCard } from "../state/decision-card.js"
import type { Finding } from "../state/finding.js"
import type { Evidence } from "../state/evidence.js"
import type { MeetingRecord } from "../state/meeting-record.js"
import type { HumanReviewFeedback } from "../state/human-review-feedback.js"
import type { RetrospectiveCase } from "../state/retrospective-case.js"
import type { RetrospectiveCandidate } from "../state/retrospective-candidate.js"
import type { LearningMemory } from "../state/learning-memory.js"

export interface TraceSnapshot {
  card?: DecisionCard
  decision?: DecisionObject
  findings: Finding[]
  evidence: Evidence[]
  meetingRecord?: MeetingRecord | null
  feedback: HumanReviewFeedback[]
  retrospectiveCandidates: RetrospectiveCandidate[]
  retrospectives: RetrospectiveCase[]
  learning: LearningMemory[]
}

export function renderTrace(snapshot: TraceSnapshot): string {
  const lines: string[] = []
  lines.push(`\n── Trace ─────────────────────────────`)
  if (snapshot.card) {
    lines.push(`Card: ${snapshot.card.cardId} (${snapshot.card.kind} | ${snapshot.card.status})`)
    lines.push(`  ${snapshot.card.title}`)
  }
  if (snapshot.decision) {
    lines.push(`DecisionObject: ${snapshot.decision.decisionObjectId} (${snapshot.decision.kind})`)
    lines.push(`  ${snapshot.decision.statement}`)
  }
  lines.push(`Findings: ${snapshot.findings.length}`)
  for (const f of snapshot.findings.slice(0, 10)) {
    lines.push(`  - ${f.findingId}: ${f.statement}`)
  }
  lines.push(`Evidence: ${snapshot.evidence.length}`)
  for (const e of snapshot.evidence.slice(0, 10)) {
    lines.push(`  - ${e.evidenceId}: ${e.normalizedText.slice(0, 80)}`)
  }
  if (snapshot.meetingRecord) {
    lines.push(`MeetingRecord: yes`)
    lines.push(`  chair: ${snapshot.meetingRecord.lenses.chair.summary.slice(0, 120)}`)
  }
  lines.push(`Feedback: ${snapshot.feedback.length}`)
  lines.push(`RetrospectiveCandidates: ${snapshot.retrospectiveCandidates.length}`)
  lines.push(`Retrospectives: ${snapshot.retrospectives.length}`)
  lines.push(`LearningMemory: ${snapshot.learning.length}`)
  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}
