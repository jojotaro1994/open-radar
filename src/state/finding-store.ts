import { intelligenceCollectionDir, intelligenceObjectPath, type IntelligenceTopic } from "./intelligence-layout.js"
import { ensureDir, listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import type { Finding } from "./finding.js"

export class FindingStore {
  constructor(private dataDir: string) {}

  private dir(topic: IntelligenceTopic): string {
    return intelligenceCollectionDir(this.dataDir, topic, "findings")
  }

  private filePath(topic: IntelligenceTopic, findingId: string): string {
    return intelligenceObjectPath(this.dataDir, topic, "findings", findingId)
  }

  save(topic: IntelligenceTopic, finding: Finding): void {
    ensureDir(this.dir(topic))
    writeJsonFile(this.filePath(topic, finding.findingId), finding)
  }

  load(topic: IntelligenceTopic, findingId: string): Finding | null {
    return readJsonFile<Finding>(this.filePath(topic, findingId))
  }

  list(topic: IntelligenceTopic): string[] {
    return listJsonBasenames(this.dir(topic))
  }
}
