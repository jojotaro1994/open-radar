import path from "path"
import { referenceDir, referenceObjectPath, type IntelligenceTopic } from "./intelligence-layout.js"
import { ensureDir, listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import type { ReferenceFact } from "./reference-fact.js"

export class ReferenceFactStore {
  constructor(private dataDir: string) {}

  private dir(topic: IntelligenceTopic): string {
    return path.join(referenceDir(this.dataDir), topic)
  }

  private filePath(topic: IntelligenceTopic, referenceFactId: string): string {
    return referenceObjectPath(this.dataDir, topic, referenceFactId)
  }

  save(topic: IntelligenceTopic, fact: ReferenceFact): void {
    ensureDir(this.dir(topic))
    writeJsonFile(this.filePath(topic, fact.referenceFactId), fact)
  }

  load(topic: IntelligenceTopic, referenceFactId: string): ReferenceFact | null {
    return readJsonFile<ReferenceFact>(this.filePath(topic, referenceFactId))
  }

  list(topic: IntelligenceTopic): string[] {
    return listJsonBasenames(this.dir(topic))
  }
}
