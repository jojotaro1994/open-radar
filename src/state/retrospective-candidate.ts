export type RetrospectiveCandidateStatus = "candidate" | "promoted" | "dropped"

export interface RetrospectiveCandidate {
  candidateId: string
  decisionObjectId: string
  triggerFeedbackId: string
  candidateReason: string
  status: RetrospectiveCandidateStatus
  createdAt: string
  updatedAt: string
}
