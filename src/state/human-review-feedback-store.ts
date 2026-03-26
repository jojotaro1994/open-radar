/**
 * HumanReviewFeedbackStore — persists HumanReviewFeedback objects.
 *
 * File location: data/review/feedback/{feedbackId}.json
 */

import { reviewFeedbackDir, reviewFeedbackPath } from "./intelligence-layout.js"
import { ensureDir, listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import type { HumanReviewFeedback } from "./human-review-feedback.js"

export class HumanReviewFeedbackStore {
  constructor(private dataDir: string) {}

  save(feedback: HumanReviewFeedback): void {
    ensureDir(reviewFeedbackDir(this.dataDir))
    writeJsonFile(reviewFeedbackPath(this.dataDir, feedback.feedbackId), feedback)
  }

  load(feedbackId: string): HumanReviewFeedback | null {
    return readJsonFile<HumanReviewFeedback>(reviewFeedbackPath(this.dataDir, feedbackId))
  }

  list(): string[] {
    return listJsonBasenames(reviewFeedbackDir(this.dataDir))
  }

  listByDecisionObject(decisionObjectId: string): HumanReviewFeedback[] {
    const all = this.list()
    return all
      .map(id => this.load(id))
      .filter((f): f is HumanReviewFeedback => f !== null && f.decisionObjectId === decisionObjectId)
  }
}
