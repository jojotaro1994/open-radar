/**
 * EvidenceRequestStore — persists EvidenceRequest objects.
 *
 * File location: data/review/evidence-requests/{requestId}.json
 */

import { evidenceRequestDir, evidenceRequestPath } from "./intelligence-layout.js"
import { ensureDir, listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import type { EvidenceRequest } from "./evidence-request.js"

export class EvidenceRequestStore {
  constructor(private dataDir: string) {}

  save(request: EvidenceRequest): void {
    ensureDir(evidenceRequestDir(this.dataDir))
    writeJsonFile(evidenceRequestPath(this.dataDir, request.requestId), request)
  }

  load(requestId: string): EvidenceRequest | null {
    return readJsonFile<EvidenceRequest>(evidenceRequestPath(this.dataDir, requestId))
  }

  list(): string[] {
    return listJsonBasenames(evidenceRequestDir(this.dataDir))
  }

  listByDecisionObject(decisionObjectId: string): EvidenceRequest[] {
    return this.list()
      .map(id => this.load(id))
      .filter((r): r is EvidenceRequest => r !== null && r.decisionObjectId === decisionObjectId)
  }
}
