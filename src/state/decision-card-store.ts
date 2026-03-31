import * as fs from "fs"
import { listJsonBasenames, readJsonFile, writeJsonFile, ensureDir } from "./intelligence-store-utils.js"
import { runtimeCardDir, runtimeCardJsonPath, runtimeCardMarkdownPath } from "./intelligence-layout.js"
import type { DecisionCard, DecisionCardStatus } from "./decision-card.js"

export type DecisionCardBucket = "inbox" | "processed" | "archive"

export class DecisionCardStore {
  constructor(private dataDir: string) {}

  save(card: DecisionCard, bucket: DecisionCardBucket = "inbox", markdown?: string): void {
    writeJsonFile(runtimeCardJsonPath(this.dataDir, bucket, card.cardId), card)
    if (markdown !== undefined) {
      ensureDir(runtimeCardDir(this.dataDir, bucket))
      fs.writeFileSync(runtimeCardMarkdownPath(this.dataDir, bucket, card.cardId), markdown)
    } else {
      const existingMarkdown = this.loadMarkdown(card.cardId)
      if (existingMarkdown) {
        ensureDir(runtimeCardDir(this.dataDir, bucket))
        fs.writeFileSync(runtimeCardMarkdownPath(this.dataDir, bucket, card.cardId), existingMarkdown)
      }
    }
  }

  load(cardId: string): { card: DecisionCard; bucket: DecisionCardBucket } | null {
    for (const bucket of ["inbox", "processed", "archive"] as const) {
      const card = readJsonFile<DecisionCard>(runtimeCardJsonPath(this.dataDir, bucket, cardId))
      if (card) return { card, bucket }
    }
    return null
  }

  loadMarkdown(cardId: string): string | null {
    for (const bucket of ["inbox", "processed", "archive"] as const) {
      const p = runtimeCardMarkdownPath(this.dataDir, bucket, cardId)
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8")
    }
    return null
  }

  list(bucket: DecisionCardBucket = "inbox"): string[] {
    return listJsonBasenames(runtimeCardDir(this.dataDir, bucket))
  }

  listAll(): Array<{ card: DecisionCard; bucket: DecisionCardBucket }> {
    return (["inbox", "processed", "archive"] as const)
      .flatMap(bucket => this.list(bucket).map(id => {
        const loaded = this.load(id)
        return loaded ? loaded : null
      }))
      .filter((x): x is { card: DecisionCard; bucket: DecisionCardBucket } => x !== null)
  }

  listByIntent(intentId: string, bucket?: DecisionCardBucket): Array<{ card: DecisionCard; bucket: DecisionCardBucket }> {
    const rows = bucket
      ? this.list(bucket).map(id => this.load(id)).filter((x): x is { card: DecisionCard; bucket: DecisionCardBucket } => x !== null)
      : this.listAll()
    return rows.filter(row => row.card.intentId === intentId)
  }

  transition(cardId: string, status: DecisionCardStatus, targetBucket: DecisionCardBucket): DecisionCard | null {
    const loaded = this.load(cardId)
    if (!loaded) return null
    const updated: DecisionCard = { ...loaded.card, status, updatedAt: new Date().toISOString() }
    const markdown = this.loadMarkdown(cardId) ?? undefined
    this.save(updated, targetBucket, markdown)

    const oldJson = runtimeCardJsonPath(this.dataDir, loaded.bucket, cardId)
    const oldMd = runtimeCardMarkdownPath(this.dataDir, loaded.bucket, cardId)
    if (loaded.bucket !== targetBucket) {
      if (fs.existsSync(oldJson)) fs.rmSync(oldJson)
      if (fs.existsSync(oldMd)) fs.rmSync(oldMd)
    }
    return updated
  }
}
