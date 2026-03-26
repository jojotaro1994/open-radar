/**
 * LearningMemoryStore — persists LearningMemory objects.
 *
 * File location: data/review/learning-memory/{memoryId}.json
 *
 * Design notes:
 * - NOT a second knowledge base — bounded, revisable, policy-level
 * - Status lifecycle: candidate → active → superseded → expired
 * - Expire old memories by checking reviewAfter
 */

import { learningMemoryDir, learningMemoryPath } from "./intelligence-layout.js"
import { ensureDir, listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import type { LearningMemory, LearningMemoryStatus } from "./learning-memory.js"

export class LearningMemoryStore {
  constructor(private dataDir: string) {}

  save(m: LearningMemory): void {
    ensureDir(learningMemoryDir(this.dataDir))
    writeJsonFile(learningMemoryPath(this.dataDir, m.memoryId), m)
  }

  load(memoryId: string): LearningMemory | null {
    return readJsonFile<LearningMemory>(learningMemoryPath(this.dataDir, memoryId))
  }

  list(): string[] {
    return listJsonBasenames(learningMemoryDir(this.dataDir))
  }

  listByStatus(status: LearningMemoryStatus): LearningMemory[] {
    return this.list()
      .map(id => this.load(id))
      .filter((m): m is LearningMemory => m !== null && m.status === status)
  }

  listActive(): LearningMemory[] {
    return this.listByStatus("active")
  }

  listCandidate(): LearningMemory[] {
    return this.listByStatus("candidate")
  }

  /** Mark a memory as superseded and return the updated object */
  supersede(memoryId: string, supersedesMemoryId: string): LearningMemory | null {
    const m = this.load(memoryId)
    if (!m) return null
    const updated: LearningMemory = { ...m, status: "superseded", updatedAt: new Date().toISOString() }
    this.save(updated)
    return updated
  }
}
