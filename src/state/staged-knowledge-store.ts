import { listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import { stagedKnowledgeBundleDir, stagedKnowledgeBundlePath } from "./intelligence-layout.js"
import type { StagedKnowledgeBundle } from "./staged-knowledge.js"

export class StagedKnowledgeStore {
  constructor(private dataDir: string) {}

  save(bundle: StagedKnowledgeBundle): void {
    writeJsonFile(stagedKnowledgeBundlePath(this.dataDir, bundle.bundleId), bundle)
  }

  load(bundleId: string): StagedKnowledgeBundle | null {
    return readJsonFile<StagedKnowledgeBundle>(stagedKnowledgeBundlePath(this.dataDir, bundleId))
  }

  list(): string[] {
    return listJsonBasenames(stagedKnowledgeBundleDir(this.dataDir))
  }

  listByIntent(intentProfile: string): StagedKnowledgeBundle[] {
    return this.list()
      .map(id => this.load(id))
      .filter((bundle): bundle is StagedKnowledgeBundle => bundle !== null && bundle.intentProfile === intentProfile)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  }

  loadLatest(intentProfile: string): StagedKnowledgeBundle | null {
    const bundles = this.listByIntent(intentProfile)
    const preferred = bundles.filter(bundle => bundle.status !== "superseded")
    const source = preferred.length > 0 ? preferred : bundles
    return source.length > 0 ? source[source.length - 1]! : null
  }
}
