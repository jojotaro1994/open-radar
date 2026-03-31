/**
 * MeetingRecordStore — persists MeetingRecord per signal/opportunity/decision-object.
 *
 * File location: data/meeting-records/{id}.json
 *   - For signal-level:       data/meeting-records/signal-{signalId}.json
 *   - For opportunity-level:   data/meeting-records/opp-{opportunityId}.json
 *   - For DecisionObject-level: data/meeting-records/do-{decisionObjectId}.json
 *
 * Lifecycle: written during triage/evaluation; read-only thereafter.
 * Part of BA Meeting Room audit trail.
 */

import * as fs from "fs"
import * as path from "path"
import type { MeetingRecord } from "./meeting-record.js"

export class MeetingRecordStore {
  constructor(private dataDir: string) {}

  private dir(): string {
    return path.join(this.dataDir, "meeting-records")
  }

  private filePath(id: string): string {
    return path.join(this.dir(), `${id}.json`)
  }

  save(record: MeetingRecord): void {
    const dir = this.dir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    let id: string
    if (record.decisionObjectId) {
      id = `do-${record.decisionObjectId}`
    } else if (record.signalId) {
      id = `signal-${record.signalId}`
    } else if (record.opportunityId) {
      id = `opp-${record.opportunityId}`
    } else {
      throw new Error("MeetingRecord must have at least one of signalId, decisionObjectId, or opportunityId")
    }
    fs.writeFileSync(this.filePath(id), JSON.stringify(record, null, 2) + "\n")
  }

  loadForSignal(signalId: string): MeetingRecord | null {
    return this.load(`signal-${signalId}`)
  }

  loadForOpportunity(opportunityId: string): MeetingRecord | null {
    return this.load(`opp-${opportunityId}`)
  }

  loadForDecisionObject(decisionObjectId: string): MeetingRecord | null {
    return this.load(`do-${decisionObjectId}`)
  }

  private load(id: string): MeetingRecord | null {
    const p = this.filePath(id)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as MeetingRecord
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
