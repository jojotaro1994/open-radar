/**
 * RetrospectiveCaseStore — persists RetrospectiveCase objects.
 *
 * File location: data/review/retrospective/{retrospectiveCaseId}.json
 */

import { retrospectiveDir, retrospectivePath } from "./intelligence-layout.js"
import { ensureDir, listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import type { RetrospectiveCase } from "./retrospective-case.js"

export class RetrospectiveCaseStore {
  constructor(private dataDir: string) {}

  save(c: RetrospectiveCase): void {
    ensureDir(retrospectiveDir(this.dataDir))
    writeJsonFile(retrospectivePath(this.dataDir, c.retrospectiveCaseId), c)
  }

  load(retrospectiveCaseId: string): RetrospectiveCase | null {
    return readJsonFile<RetrospectiveCase>(retrospectivePath(this.dataDir, retrospectiveCaseId))
  }

  list(): string[] {
    return listJsonBasenames(retrospectiveDir(this.dataDir))
  }

  listByOriginalDecision(decisionObjectId: string): RetrospectiveCase[] {
    return this.list()
      .map(id => this.load(id))
      .filter((c): c is RetrospectiveCase => c !== null && c.originalDecisionObjectId === decisionObjectId)
  }
}
