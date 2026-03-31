import { listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import { retrospectiveCandidateDir, retrospectiveCandidatePath } from "./intelligence-layout.js"
import type { RetrospectiveCandidate } from "./retrospective-candidate.js"

export class RetrospectiveCandidateStore {
  constructor(private dataDir: string) {}

  save(candidate: RetrospectiveCandidate): void {
    writeJsonFile(retrospectiveCandidatePath(this.dataDir, candidate.candidateId), candidate)
  }

  load(candidateId: string): RetrospectiveCandidate | null {
    return readJsonFile<RetrospectiveCandidate>(retrospectiveCandidatePath(this.dataDir, candidateId))
  }

  list(): string[] {
    return listJsonBasenames(retrospectiveCandidateDir(this.dataDir))
  }

  listByDecisionObject(decisionObjectId: string): RetrospectiveCandidate[] {
    return this.list()
      .map(id => this.load(id))
      .filter((c): c is RetrospectiveCandidate => c !== null && c.decisionObjectId === decisionObjectId)
  }
}
