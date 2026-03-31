import crypto from "crypto"
import type { DecisionCard, DecisionCardStatus } from "../state/decision-card.js"
import type { FeedbackClass, ReviewResolution } from "../state/human-review-feedback.js"
import type { EvidenceAvailabilityStatus } from "../state/evidence-request.js"

export interface ParsedCardDraft {
  resolution: ReviewResolution
  cardStatus: DecisionCardStatus
  feedbackClass: FeedbackClass
  reason: string
  evidenceRequests: Array<{
    requestedItem: string
    whyItMatters: string
    priority: "high" | "medium" | "low"
    availabilityStatus: EvidenceAvailabilityStatus
  }>
}

export function renderDecisionCardMarkdown(card: DecisionCard): string {
  return [
    `# ${card.title}`,
    ``,
    `- Card ID: ${card.cardId}`,
    `- Decision Object: ${card.decisionObjectId}`,
    `- Kind: ${card.kind}`,
    `- Status: ${card.status}`,
    `- Topic: ${card.topic}`,
    ``,
    `## Summary`,
    card.summary,
    ``,
    `## Why Now`,
    card.whyNow,
    ``,
    `## Supporting Findings`,
    ...card.supportingFindingIds.map(id => `- ${id}`),
    ``,
    `## Evidence Gaps`,
    ...(card.evidenceGapSummary.length > 0 ? card.evidenceGapSummary.map(g => `- ${g}`) : ["- (none)"]),
    ``,
    `## Meeting Recommendation`,
    card.meetingRecommendation,
    ``,
    `## Editable Review`,
    `Decision: `,
    `Reason Class: `,
    `Reason: `,
    `Evidence Requests:`,
    `- item | priority | availability | why it matters`,
    ``,
    `<!-- Only the Editable Review section is parsed by /submit card -->`,
    ``,
  ].join("\n")
}

function mapDecisionToResolution(value: string): { resolution: ReviewResolution; status: DecisionCardStatus } | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === "pick" || normalized === "approve") return { resolution: "approve", status: "picked" }
  if (normalized === "reject") return { resolution: "reject", status: "rejected" }
  if (normalized === "defer") return { resolution: "defer", status: "deferred" }
  if (normalized === "watch") return { resolution: "watch", status: "watch" }
  return null
}

export function parseCardMarkdown(markdown: string): ParsedCardDraft | { error: string } {
  const editable = markdown.split("## Editable Review")[1]
  if (!editable) return { error: "Editable Review section not found." }

  const decision = editable.match(/Decision:\s*(.+)/)?.[1]?.trim() ?? ""
  const mapped = mapDecisionToResolution(decision)
  if (!mapped) return { error: "Decision must be one of: pick, approve, reject, defer, watch." }

  const feedbackClassRaw = editable.match(/Reason Class:\s*(.+)/)?.[1]?.trim().replace(/-/g, "_") ?? "other"
  const feedbackClass = ([
    "not_real_opportunity",
    "insufficient_evidence",
    "wrong_timing",
    "not_strategic_now",
    "duplicate",
    "already_known",
    "cannot_execute_now",
    "other",
  ] as const).includes(feedbackClassRaw as any)
    ? feedbackClassRaw as FeedbackClass
    : "other"
  const reason = editable.match(/Reason:\s*(.+)/)?.[1]?.trim() ?? "(no reason provided)"

  const evidenceRequests: ParsedCardDraft["evidenceRequests"] = []
  const requestLines = editable.split("Evidence Requests:")[1]?.split("\n") ?? []
  for (const raw of requestLines) {
    const trimmed = raw.trim()
    if (!trimmed.startsWith("-")) continue
    const content = trimmed.replace(/^-+\s*/, "")
    if (content.toLowerCase().startsWith("item |")) continue
    const [requestedItem, priorityRaw, availabilityRaw, whyItMatters] = content.split("|").map(p => p.trim())
    if (!requestedItem) continue
    const priority = priorityRaw === "high" || priorityRaw === "low" ? priorityRaw : "medium"
    const availabilityStatus = ([
      "available_now",
      "available_later",
      "not_available",
      "unknown",
    ] as const).includes(availabilityRaw as any)
      ? availabilityRaw as EvidenceAvailabilityStatus
      : "unknown"
    evidenceRequests.push({
      requestedItem,
      priority,
      availabilityStatus,
      whyItMatters: whyItMatters || "(no context provided)",
    })
  }

  return {
    resolution: mapped.resolution,
    cardStatus: mapped.status,
    feedbackClass,
    reason,
    evidenceRequests,
  }
}

export function newRetrospectiveCandidateId(): string {
  return `retrocand-${crypto.randomUUID().slice(0, 8)}`
}
