import { intelligenceCollectionDir, intelligenceObjectPath, type IntelligenceTopic } from "./intelligence-layout.js"
import { ensureDir, listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import type { Evidence } from "./evidence.js"

export class EvidenceStore {
  constructor(private dataDir: string) {}

  private dir(topic: IntelligenceTopic): string {
    return intelligenceCollectionDir(this.dataDir, topic, "evidence")
  }

  private filePath(topic: IntelligenceTopic, evidenceId: string): string {
    return intelligenceObjectPath(this.dataDir, topic, "evidence", evidenceId)
  }

  save(topic: IntelligenceTopic, evidence: Evidence): void {
    ensureDir(this.dir(topic))
    writeJsonFile(this.filePath(topic, evidence.evidenceId), evidence)
  }

  load(topic: IntelligenceTopic, evidenceId: string): Evidence | null {
    return readJsonFile<Evidence>(this.filePath(topic, evidenceId))
  }

  list(topic: IntelligenceTopic): string[] {
    return listJsonBasenames(this.dir(topic))
  }
}
