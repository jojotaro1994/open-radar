/**
 * KnowledgePackStore — persists KnowledgePack to JSON file.
 *
 * File location: config/intents/{intentId}.knowledge-pack.json
 *
 * Lifecycle: persistent. Written via the preview-first change flow
 * (not yet wired — store exists to establish the persistence contract).
 */

import * as fs from "fs"
import * as path from "path"
import type { KnowledgePack } from "./knowledge-pack.js"

export class KnowledgePackStore {
  constructor(private configDir: string) {}

  private filePath(intentId: string): string {
    return path.join(this.configDir, "intents", `${intentId}.knowledge-pack.json`)
  }

  load(intentId: string): KnowledgePack | null {
    const p = this.filePath(intentId)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as KnowledgePack
    } catch {
      return null
    }
  }

  save(intentId: string, kp: KnowledgePack): void {
    const p = this.filePath(intentId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(kp, null, 2) + "\n")
  }

  exists(intentId: string): boolean {
    return fs.existsSync(this.filePath(intentId))
  }
}
