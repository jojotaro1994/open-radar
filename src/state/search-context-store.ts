/**
 * ScoutBriefStore — persists Scout Brief to JSON file.
 * (Internal type is still SearchContext for compatibility migration.)
 *
 * File location: config/intents/{intentId}.scout-brief.json
 *
 * Lifecycle: persistent. Written via the preview-first change flow
 * (not yet wired — store exists to establish the persistence contract).
 */

import * as fs from "fs"
import * as path from "path"
import type { SearchContext } from "./search-context.js"

export class SearchContextStore {
  constructor(private configDir: string) {}

  private filePath(intentId: string, preferNew = true): string {
    if (preferNew) return path.join(this.configDir, "intents", `${intentId}.scout-brief.json`)
    return path.join(this.configDir, "intents", `${intentId}.search-context.json`)
  }

  load(intentId: string): SearchContext | null {
    const p = this.filePath(intentId, true)
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, "utf-8")) as SearchContext } catch { /* fall through */ }
    }
    // Backward-compat fallback: migrate from old filename on first read
    const old = this.filePath(intentId, false)
    if (fs.existsSync(old)) {
      try {
        const data = JSON.parse(fs.readFileSync(old, "utf-8")) as SearchContext
        // Migrate to new filename silently
        this.save(intentId, data)
        return data
      } catch { /* fall through */ }
    }
    return null
  }

  save(intentId: string, ctx: SearchContext): void {
    const p = this.filePath(intentId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(ctx, null, 2) + "\n")
  }

  exists(intentId: string): boolean {
    return fs.existsSync(this.filePath(intentId))
  }
}
