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

// ── Brief + Card runtime layout ───────────────────────────────────────────────

export function runtimeDir(dataDir: string): string {
  return path.join(dataDir, "runtime")
}

export function runtimeBriefDir(dataDir: string, kind: "scout" | "meeting"): string {
  return path.join(runtimeDir(dataDir), "briefs", kind)
}

export function runtimeBriefPath(dataDir: string, kind: "scout" | "meeting", id: string): string {
  return path.join(runtimeBriefDir(dataDir, kind), `${id}.json`)
}

export function runtimeCardDir(
  dataDir: string,
  bucket: "inbox" | "processed" | "archive",
): string {
  return path.join(runtimeDir(dataDir), "cards", bucket)
}

export function runtimeCardJsonPath(
  dataDir: string,
  bucket: "inbox" | "processed" | "archive",
  id: string,
): string {
  return path.join(runtimeCardDir(dataDir, bucket), `${id}.json`)
}

export function runtimeCardMarkdownPath(
  dataDir: string,
  bucket: "inbox" | "processed" | "archive",
  id: string,
): string {
  return path.join(runtimeCardDir(dataDir, bucket), `${id}.md`)
}

export function retrospectiveCandidateDir(dataDir: string): string {
  return path.join(reviewDir(dataDir), "retrospective-candidates")
}

export function retrospectiveCandidatePath(dataDir: string, candidateId: string): string {
  return path.join(retrospectiveCandidateDir(dataDir), `${candidateId}.json`)
}

// ── Staged knowledge + graph mapping review layout ──────────────────────────

export function stagedKnowledgeDir(dataDir: string): string {
  return path.join(runtimeDir(dataDir), "staged-knowledge")
}

export function stagedKnowledgeBundleDir(dataDir: string): string {
  return path.join(stagedKnowledgeDir(dataDir), "bundles")
}

export function stagedKnowledgeBundlePath(dataDir: string, bundleId: string): string {
  return path.join(stagedKnowledgeBundleDir(dataDir), `${bundleId}.json`)
}

export function graphMappingPlanDir(dataDir: string): string {
  return path.join(runtimeDir(dataDir), "graph-mapping-plans")
}

export function graphMappingPlanPath(dataDir: string, planId: string): string {
  return path.join(graphMappingPlanDir(dataDir), `${planId}.json`)
}
