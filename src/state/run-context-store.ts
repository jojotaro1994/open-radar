/**
 * run-context-store.ts — persists a full radar context snapshot per cycle.
 *
 * File location: data/run-contexts/{cycleId}.json
 *
 * Captures what the radar "knew" at the time of a specific run:
 *   - Which SearchContext / KnowledgePack / MeetingCharter were active
 *   - What the LastRun stats were
 *   - What intent was used
 *
 * This is the foundation for /review and /why explainability:
 *   - /why {signalId} → look up triage record → get cycleId → load RunContext
 *   - /review → load RunContext for a cycle to see what the radar "thought"
 *
 * Lifecycle: written once at the end of a pipeline run; read-only thereafter.
 */

import * as fs from "fs"
import * as path from "path"
import type { SearchContextSummary } from "./search-context.js"
import type { KnowledgePackSummary } from "./knowledge-pack.js"
import type { MeetingCharterSummary } from "./meeting-charter.js"

export interface RunContext {
  cycleId: string
  timestamp: string
  intentId: string
  searchContext: SearchContextSummary
  knowledgePack: KnowledgePackSummary
  meetingCharter: MeetingCharterSummary
  pipelineStats: {
    ingested: number
    scored: number
    qualified: number
    enqueuedForTriage: number
    approved: number
    rejected: number
    deferred: number
    themes: number
    opportunities: number
  }
}

export class RunContextStore {
  constructor(private dataDir: string) {}

  private dir(): string {
    return path.join(this.dataDir, "run-contexts")
  }

  private filePath(cycleId: string): string {
    return path.join(this.dir(), `${cycleId}.json`)
  }

  save(ctx: RunContext): void {
    const dir = this.dir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.filePath(ctx.cycleId), JSON.stringify(ctx, null, 2) + "\n")
  }

  load(cycleId: string): RunContext | null {
    const p = this.filePath(cycleId)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as RunContext
    } catch {
      return null
    }
  }

  list(): string[] {
    const dir = this.dir()
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => f.replace(/\.json$/, ""))
  }
}
