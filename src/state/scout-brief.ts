export type ScoutBriefStatus = "draft" | "confirmed" | "superseded"

export interface ScoutBrief {
  briefId: string
  intentId: string
  prompt: string
  objective: string
  primaryQuestions: string[]
  priorityDimensions: string[]
  outOfScope: string[]
  sourceScope: string[]
  status: ScoutBriefStatus
  createdAt: string
  updatedAt: string
}
