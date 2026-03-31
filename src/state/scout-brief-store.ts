import { listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import { runtimeBriefDir, runtimeBriefPath } from "./intelligence-layout.js"
import type { ScoutBrief } from "./scout-brief.js"

export class ScoutBriefStore {
  constructor(private dataDir: string) {}

  save(brief: ScoutBrief): void {
    writeJsonFile(runtimeBriefPath(this.dataDir, "scout", brief.briefId), brief)
  }

  load(briefId: string): ScoutBrief | null {
    return readJsonFile<ScoutBrief>(runtimeBriefPath(this.dataDir, "scout", briefId))
  }

  list(): string[] {
    return listJsonBasenames(runtimeBriefDir(this.dataDir, "scout"))
  }

  listByIntent(intentId: string): ScoutBrief[] {
    return this.list()
      .map(id => this.load(id))
      .filter((b): b is ScoutBrief => b !== null && b.intentId === intentId)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  }

  loadCurrent(intentId: string): ScoutBrief | null {
    const matches = this.listByIntent(intentId).filter(b => b.status === "confirmed")
    return matches.length > 0 ? matches[matches.length - 1]! : null
  }
}
