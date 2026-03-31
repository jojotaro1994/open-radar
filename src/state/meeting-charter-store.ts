/**
 * MeetingGoalStore — persists Meeting Goal to JSON file.
 * (Internal type is still MeetingCharter for compatibility migration.)
 *
 * File location: config/intents/{intentId}.meeting-goal.json
 *
 * Lifecycle: persistent. Written via the preview-first change flow
 * (not yet wired — store exists to establish the persistence contract).
 */

import * as fs from "fs"
import * as path from "path"
import type { MeetingCharter } from "./meeting-charter.js"

export class MeetingCharterStore {
  constructor(private configDir: string) {}

  private filePath(intentId: string, preferNew = true): string {
    if (preferNew) return path.join(this.configDir, "intents", `${intentId}.meeting-goal.json`)
    return path.join(this.configDir, "intents", `${intentId}.meeting-charter.json`)
  }

  load(intentId: string): MeetingCharter | null {
    const p = this.filePath(intentId, true)
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, "utf-8")) as MeetingCharter } catch { /* fall through */ }
    }
    // Backward-compat fallback: migrate from old filename on first read
    const old = this.filePath(intentId, false)
    if (fs.existsSync(old)) {
      try {
        const data = JSON.parse(fs.readFileSync(old, "utf-8")) as MeetingCharter
        // Migrate to new filename silently
        this.save(intentId, data)
        return data
      } catch { /* fall through */ }
    }
    return null
  }

  save(intentId: string, mc: MeetingCharter): void {
    const p = this.filePath(intentId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(mc, null, 2) + "\n")
  }

  exists(intentId: string): boolean {
    return fs.existsSync(this.filePath(intentId))
  }
}
