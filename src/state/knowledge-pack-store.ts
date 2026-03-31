/**
 * KnowledgePackStore — persists KnowledgePack to JSON file.
 *
 * File locations:
 *   - Accepted pack:  config/intents/{intentId}.knowledge-pack.json
 *   - Candidate packs: data/knowledge-packs/candidates/{id}.json
 *
 * Lifecycle:
 *   - Knowledge Run produces candidate packs → saved to candidates/
 *   - User accepts candidate → /tell pack accept copies it to config/intents/
 *   - Radar Run loads from config/intents/ (accepted pack only)
 */

import * as fs from "fs"
import * as path from "path"
import type { KnowledgePack } from "./knowledge-pack.js"

export class KnowledgePackStore {
  constructor(private configDir: string) {}

  private acceptedPath(intentId: string): string {
    return path.join(this.configDir, "intents", `${intentId}.knowledge-pack.json`)
  }

  private candidatesDir(): string {
    return path.join(this.configDir, "..", "data", "knowledge-packs", "candidates")
  }

  private candidatePath(packId: string): string {
    return path.join(this.candidatesDir(), `${packId}.json`)
  }

  /**
   * Load the accepted Knowledge Pack from config/intents/.
   */
  load(intentId: string): KnowledgePack | null {
    const p = this.acceptedPath(intentId)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as KnowledgePack
    } catch {
      return null
    }
  }

  /**
   * Load a candidate pack by ID from data/knowledge-packs/candidates/.
   */
  loadCandidate(packId: string): KnowledgePack | null {
    const p = this.candidatePath(packId)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as KnowledgePack
    } catch {
      return null
    }
  }

  /**
   * List all candidate pack IDs (without extension).
   */
  listCandidates(): string[] {
    const dir = this.candidatesDir()
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => f.replace(/\.json$/, ""))
  }

  /**
   * Save a Knowledge Pack to the candidates directory.
   * Used by Knowledge Run to produce candidate packs.
   */
  save(packId: string, kp: KnowledgePack): void {
    const p = this.candidatePath(packId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(kp, null, 2) + "\n")
  }

  /**
   * Accept a candidate pack: copy it to the accepted path.
   * Sets status to "accepted" and saves to config/intents/.
   */
  acceptCandidate(packId: string): boolean {
    const candidate = this.loadCandidate(packId)
    if (!candidate) return false
    const accepted: KnowledgePack = {
      ...candidate,
      id: packId,
      status: "accepted",
      updatedAt: new Date().toISOString(),
    }
    const p = this.acceptedPath(candidate.intentId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(accepted, null, 2) + "\n")
    return true
  }

  exists(intentId: string): boolean {
    return fs.existsSync(this.acceptedPath(intentId))
  }
}
