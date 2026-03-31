/**
 * ReviewQueue — Single authoritative source for triage state.
 *
 * Persistence model (per signalId):
 *   data/review-queue/{signalId}/status.json   — { status: string }
 *   data/review-queue/{signalId}/meta.json     — { signalId, scoredSignalId, cycleId, enqueuedAt }
 *   data/review-queue/{signalId}/triage.json  — { decision, reviewedBy, reviewedAt, reason? }
 *
 * ReviewQueueItem is assembled at runtime from these three files.
 * ScoredSignal is stored separately at data/scored-signals/{id}.json
 */

import { promises as fs } from "fs"
import path from "path"
import type { ScoredSignal } from "../adapters/source-adapter.js"

export type TriageDecision = "approved" | "rejected" | "deferred"
export type ReviewQueueStatus = "pending" | "approved" | "rejected" | "deferred"

export interface ReviewQueueItem {
  signalId: string
  scoredSignalId: string
  cycleId: string
  enqueuedAt: string
  status: ReviewQueueStatus
  triage?: {
    decision: TriageDecision
    reviewedBy: string
    reviewedAt: string
    reason?: string
  }
}

type EventHandler = (payload: unknown) => void

export class ReviewQueue {
  private handlers = new Map<string, EventHandler[]>()
  private queueDir: string

  constructor(baseDir: string = "./data") {
    this.queueDir = path.join(baseDir, "review-queue")
  }

  private signalDir(signalId: string) {
    return path.join(this.queueDir, signalId)
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8")
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  async enqueueAll(signals: ScoredSignal[], cycleId: string): Promise<void> {
    let enqueuedCount = 0

    for (const signal of signals) {
      const dir = this.signalDir(signal.id)
      const alreadyEnqueued = await this.exists(path.join(dir, "status.json"))

      if (alreadyEnqueued) {
        // Update cycleId so getApproved(cycleId) finds this signal
        await this.writeJson(path.join(dir, "meta.json"), {
          signalId: signal.id,
          scoredSignalId: signal.id,
          cycleId,
          enqueuedAt: new Date().toISOString(),
        })
        continue
      }

      await fs.mkdir(dir, { recursive: true })
      await this.writeJson(path.join(dir, "status.json"), { status: "pending" })
      await this.writeJson(path.join(dir, "meta.json"), {
        signalId: signal.id,
        scoredSignalId: signal.id,
        cycleId,
        enqueuedAt: new Date().toISOString(),
      })
      enqueuedCount++
    }

    if (enqueuedCount > 0) {
      const pending = await this.getPending()
      this.emit("queue.cycle-opened", { cycleId, enqueuedCount, queueDepth: pending.length })
    }
  }

  async getItem(signalId: string): Promise<ReviewQueueItem | null> {
    const meta = await this.readJson<{ signalId: string; scoredSignalId: string; cycleId: string; enqueuedAt: string }>(
      path.join(this.signalDir(signalId), "meta.json")
    )
    if (!meta) return null

    const statusData = await this.readJson<{ status: ReviewQueueStatus }>(
      path.join(this.signalDir(signalId), "status.json")
    )
    const triage = await this.readJson<ReviewQueueItem["triage"]>(
      path.join(this.signalDir(signalId), "triage.json")
    )

    return {
      signalId: meta.signalId,
      scoredSignalId: meta.scoredSignalId,
      cycleId: meta.cycleId,
      enqueuedAt: meta.enqueuedAt,
      status: statusData?.status ?? "pending",
      triage: triage ?? undefined,
    }
  }

  async getPending(): Promise<ReviewQueueItem[]> { return this.getByStatus("pending") }
  async getApproved(sinceCycleId?: string): Promise<ReviewQueueItem[]> {
    const items = await this.getByStatus("approved")
    return sinceCycleId ? items.filter(i => i.cycleId === sinceCycleId) : items
  }
  async getRejected(sinceCycleId?: string): Promise<ReviewQueueItem[]> {
    const items = await this.getByStatus("rejected")
    return sinceCycleId ? items.filter(i => i.cycleId === sinceCycleId) : items
  }
  async getDeferred(sinceCycleId?: string): Promise<ReviewQueueItem[]> {
    const items = await this.getByStatus("deferred")
    return sinceCycleId ? items.filter(i => i.cycleId === sinceCycleId) : items
  }

  private async getByStatus(status: ReviewQueueStatus): Promise<ReviewQueueItem[]> {
    const results: ReviewQueueItem[] = []
    try {
      const entries = await fs.readdir(this.queueDir)
      for (const entry of entries) {
        const statusData = await this.readJson<{ status: string }>(
          path.join(this.queueDir, entry, "status.json")
        )
        if (statusData?.status === status) {
          const item = await this.getItem(entry)
          if (item) results.push(item)
        }
      }
    } catch { /* empty */ }
    return results
  }

  async triage(signalId: string, decision: TriageDecision, reviewedBy: string, reason?: string): Promise<void> {
    const dir = this.signalDir(signalId)
    if (!(await this.exists(path.join(dir, "status.json")))) {
      throw new Error(`Signal ${signalId} not found in queue`)
    }

    await this.writeJson(path.join(dir, "status.json"), { status: decision })
    await this.writeJson(path.join(dir, "triage.json"), {
      decision,
      reviewedBy,
      reviewedAt: new Date().toISOString(),
      reason,
    })

    this.emit("triage.completed", { signalId, decision })
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler)
  }

  private emit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload)
    }
  }
}
