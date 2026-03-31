import { intelligenceCollectionDir, intelligenceObjectPath, type IntelligenceTopic } from "./intelligence-layout.js"
import { ensureDir, listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import type { DecisionObject } from "./decision-object.js"

export class DecisionObjectStore {
  constructor(private dataDir: string) {}

  private dir(topic: IntelligenceTopic): string {
    return intelligenceCollectionDir(this.dataDir, topic, "decision-objects")
  }

  private filePath(topic: IntelligenceTopic, decisionObjectId: string): string {
    return intelligenceObjectPath(this.dataDir, topic, "decision-objects", decisionObjectId)
  }

  save(topic: IntelligenceTopic, decisionObject: DecisionObject): void {
    ensureDir(this.dir(topic))
    writeJsonFile(this.filePath(topic, decisionObject.decisionObjectId), decisionObject)
  }

  load(topic: IntelligenceTopic, decisionObjectId: string): DecisionObject | null {
    return readJsonFile<DecisionObject>(this.filePath(topic, decisionObjectId))
  }

  list(topic: IntelligenceTopic): string[] {
    return listJsonBasenames(this.dir(topic))
  }
}
