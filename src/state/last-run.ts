/**
 * LastRunStore — read-only projection of the most recent /run execution.
 *
 * Persisted to data/last-run.json so it survives between CLI invocations.
 * Written by the runner after completing a cycle; never written by session patches.
 */

import * as fs from "fs"
import * as path from "path"
import type { SearchContextSummary } from "./search-context.js"
import type { KnowledgeBaseSummary } from "./knowledge-base.js"
import type { KnowledgePackSummary } from "./knowledge-pack.js"
import type { MeetingCharterSummary } from "./meeting-charter.js"
import type { KnowledgeBriefSummary } from "./knowledge-brief.js"
import type { SourceWorkflowType } from "../registry/source-taxonomy.js"

export interface LastRunSourceStat {
  name: string
  sourceType: SourceWorkflowType
  legacyRole?: "direct_signal" | "context"
  signalCount: number
}

export type RunType = "radar" | "knowledge"

export interface LastRunSummary {
  timestamp: string
  intentId: string
  cycleId?: string
  runType?: RunType
  sessionPatchCount: number
  sources: LastRunSourceStat[]
  pipeline: {
    ingested: number
    scored: number
    qualified: number
    enqueuedForTriage: number
  }
  /** Full context snapshot for explainability — /why and /review use this */
  searchContext?: SearchContextSummary
  knowledgeBase?: KnowledgeBaseSummary
  knowledgePack?: KnowledgePackSummary
  meetingCharter?: MeetingCharterSummary
  knowledgeBrief?: KnowledgeBriefSummary
}

export class LastRunStore {
  private filePath: string

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "last-run.json")
  }

  save(summary: LastRunSummary): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(summary, null, 2) + "\n")
  }

  load(): LastRunSummary | null {
    if (!fs.existsSync(this.filePath)) return null
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as LastRunSummary
    } catch {
      return null
    }
  }
}
