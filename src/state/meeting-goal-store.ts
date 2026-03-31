import { listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import { runtimeBriefDir, runtimeBriefPath } from "./intelligence-layout.js"
import type { MeetingGoal } from "./meeting-goal.js"

export class MeetingGoalStore {
  constructor(private dataDir: string) {}

  save(goal: MeetingGoal): void {
    writeJsonFile(runtimeBriefPath(this.dataDir, "meeting", goal.meetingGoalId), goal)
  }

  load(meetingGoalId: string): MeetingGoal | null {
    return readJsonFile<MeetingGoal>(runtimeBriefPath(this.dataDir, "meeting", meetingGoalId))
  }

  list(): string[] {
    return listJsonBasenames(runtimeBriefDir(this.dataDir, "meeting"))
  }

  listByIntent(intentId: string): MeetingGoal[] {
    return this.list()
      .map(id => this.load(id))
      .filter((g): g is MeetingGoal => g !== null && g.intentId === intentId)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  }

  loadCurrent(intentId: string): MeetingGoal | null {
    const matches = this.listByIntent(intentId).filter(g => g.status === "confirmed")
    return matches.length > 0 ? matches[matches.length - 1]! : null
  }
}
