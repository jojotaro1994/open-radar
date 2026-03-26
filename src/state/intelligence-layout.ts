import path from "path"

export type IntelligenceTopic =
  | "customer-intel"
  | "sales-intel"
  | "competitive-intel"
  | "market-intel"
  | (string & {})

export type IntelligenceCollection =
  | "sources"
  | "evidence"
  | "findings"
  | "decision-objects"
  | "action-assets"
  | "runs"
  | "manifests"
  | "watchlists"

export function referenceDir(dataDir: string): string {
  return path.join(dataDir, "reference")
}

export function referenceObjectPath(dataDir: string, kind: string, id: string): string {
  return path.join(referenceDir(dataDir), kind, `${id}.json`)
}

/**
 * Canonical local-folder layout for the intelligence operating model.
 *
 * This keeps local folders as the source of record while staying graph-compatible
 * through explicit IDs and lineage fields inside each object.
 */
export function intelligenceTopicDir(dataDir: string, topic: IntelligenceTopic): string {
  return path.join(dataDir, "intelligence", "topics", topic)
}

export function intelligenceCollectionDir(
  dataDir: string,
  topic: IntelligenceTopic,
  collection: IntelligenceCollection,
): string {
  return path.join(intelligenceTopicDir(dataDir, topic), collection)
}

export function intelligenceObjectPath(
  dataDir: string,
  topic: IntelligenceTopic,
  collection: IntelligenceCollection,
  id: string,
): string {
  return path.join(intelligenceCollectionDir(dataDir, topic, collection), `${id}.json`)
}

// ── Review + Learning directory layout ─────────────────────────────────────────

export function reviewDir(dataDir: string): string {
  return path.join(dataDir, "review")
}

export function reviewFeedbackDir(dataDir: string): string {
  return path.join(reviewDir(dataDir), "feedback")
}

export function reviewFeedbackPath(dataDir: string, feedbackId: string): string {
  return path.join(reviewFeedbackDir(dataDir), `${feedbackId}.json`)
}

export function evidenceRequestDir(dataDir: string): string {
  return path.join(reviewDir(dataDir), "evidence-requests")
}

export function evidenceRequestPath(dataDir: string, requestId: string): string {
  return path.join(evidenceRequestDir(dataDir), `${requestId}.json`)
}

export function retrospectiveDir(dataDir: string): string {
  return path.join(reviewDir(dataDir), "retrospective")
}

export function retrospectivePath(dataDir: string, retrospectiveCaseId: string): string {
  return path.join(retrospectiveDir(dataDir), `${retrospectiveCaseId}.json`)
}

export function learningMemoryDir(dataDir: string): string {
  return path.join(reviewDir(dataDir), "learning-memory")
}

export function learningMemoryPath(dataDir: string, memoryId: string): string {
  return path.join(learningMemoryDir(dataDir), `${memoryId}.json`)
}
