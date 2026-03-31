import { intelligenceCollectionDir, intelligenceObjectPath, type IntelligenceTopic } from "./intelligence-layout.js"
import { ensureDir, listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import type { ActionAsset } from "./action-asset.js"

export class ActionAssetStore {
  constructor(private dataDir: string) {}

  private dir(topic: IntelligenceTopic): string {
    return intelligenceCollectionDir(this.dataDir, topic, "action-assets")
  }

  private filePath(topic: IntelligenceTopic, actionAssetId: string): string {
    return intelligenceObjectPath(this.dataDir, topic, "action-assets", actionAssetId)
  }

  save(topic: IntelligenceTopic, actionAsset: ActionAsset): void {
    ensureDir(this.dir(topic))
    writeJsonFile(this.filePath(topic, actionAsset.actionAssetId), actionAsset)
  }

  load(topic: IntelligenceTopic, actionAssetId: string): ActionAsset | null {
    return readJsonFile<ActionAsset>(this.filePath(topic, actionAssetId))
  }

  list(topic: IntelligenceTopic): string[] {
    return listJsonBasenames(this.dir(topic))
  }
}
