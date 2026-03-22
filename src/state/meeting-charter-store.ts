/**
 * MeetingCharterStore — persists MeetingCharter to JSON file.
 *
 * File location: config/intents/{intentId}.meeting-charter.json
 *
 * Lifecycle: persistent. Written via the preview-first change flow
 * (not yet wired — store exists to establish the persistence contract).
 */

import * as fs from "fs"
import * as path from "path"
import type { MeetingCharter } from "./meeting-charter.js"

export class MeetingCharterStore {
  constructor(private configDir: string) {}

  private filePath(intentId: string): string {
    return path.join(this.configDir, "intents", `${intentId}.meeting-charter.json`)
  }

  load(intentId: string): MeetingCharter | null {
    const p = this.filePath(intentId)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as MeetingCharter
    } catch {
      return null
    }
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
