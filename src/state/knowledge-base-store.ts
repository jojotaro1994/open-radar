import * as fs from "fs"
import * as path from "path"
import type { KnowledgeBase } from "./knowledge-base.js"

export class KnowledgeBaseStore {
  constructor(private configDir: string) {}

  private filePath(intentId: string): string {
    return path.join(this.configDir, "intents", `${intentId}.knowledge-base.json`)
  }

  load(intentId: string): KnowledgeBase | null {
    const filePath = this.filePath(intentId)
    if (!fs.existsSync(filePath)) return null
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as KnowledgeBase
    } catch {
      return null
    }
  }

  save(intentId: string, knowledgeBase: KnowledgeBase): void {
    const filePath = this.filePath(intentId)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(knowledgeBase, null, 2) + "\n")
  }

  exists(intentId: string): boolean {
    return fs.existsSync(this.filePath(intentId))
  }
}
