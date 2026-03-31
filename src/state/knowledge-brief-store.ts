/**
 * KnowledgeBriefStore — persists Knowledge Brief to JSON file.
 *
 * File location: config/intents/{intentId}.knowledge-brief.json
 *
 * Lifecycle: persistent. Written via the preview-first change flow.
 */

import * as fs from "fs"
import * as path from "path"
import type { KnowledgeBrief } from "./knowledge-brief.js"

export class KnowledgeBriefStore {
  constructor(private configDir: string) {}

  private filePath(intentId: string): string {
    return path.join(this.configDir, "intents", `${intentId}.knowledge-brief.json`)
  }

  load(intentId: string): KnowledgeBrief | null {
    const p = this.filePath(intentId)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as KnowledgeBrief
    } catch {
      return null
    }
  }

  save(intentId: string, kb: KnowledgeBrief): void {
    const p = this.filePath(intentId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(kb, null, 2) + "\n")
  }

  exists(intentId: string): boolean {
    return fs.existsSync(this.filePath(intentId))
  }
}
