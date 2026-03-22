/**
 * SearchContextStore — persists SearchContext to JSON file.
 *
 * File location: config/intents/{intentId}.search-context.json
 *
 * Lifecycle: persistent. Written via the preview-first change flow
 * (not yet wired — store exists to establish the persistence contract).
 */

import * as fs from "fs"
import * as path from "path"
import type { SearchContext } from "./search-context.js"

export class SearchContextStore {
  constructor(private configDir: string) {}

  private filePath(intentId: string): string {
    return path.join(this.configDir, "intents", `${intentId}.search-context.json`)
  }

  load(intentId: string): SearchContext | null {
    const p = this.filePath(intentId)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as SearchContext
    } catch {
      return null
    }
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
