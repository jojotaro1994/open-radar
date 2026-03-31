export type MeetingGoalStatus = "draft" | "confirmed" | "superseded"
export type DecisionLens = "opportunity" | "risk" | "gap" | "mixed"
export type PriorityBias = "growth" | "retention" | "packaging" | "execution" | "balanced"

export interface MeetingGoal {
  meetingGoalId: string
  intentId: string
  prompt: string
  decisionLens: DecisionLens
  successCriteria: string
  priorityBias: PriorityBias
  topicScope: string[]
  status: MeetingGoalStatus
  createdAt: string
  updatedAt: string
}
