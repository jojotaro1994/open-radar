/**
 * MultiSourceRouter
 *
 * Tries multiple source adapters in priority order:
 *  1. GitHub Issues (real API if token available, else falls back to vscode mock)
 *  2. Reddit (real public API, falls back to mock)
 *  3. Local JSON signal cache (always available as final fallback)
 *
 * The local JSON cache (data/signals-cache.json) can be manually populated
 * with any collected signals and serves as a durable fallback when all
 * remote sources fail or are rate-limited.
 *
 * Usage:
 *   const router = new MultiSourceRouter()
 *   await router.connect()
 *   const signals = await router.poll()
 *   // Use adapter.normalize() on each signal
 *   await router.disconnect()
 */

import * as fs from "fs"
import * as path from "path"
import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"
import { GitHubIssuesAdapter } from "./github-issues-adapter.js"
import { RedditAdapter } from "./reddit-adapter.js"

export interface RouterConfig {
  github?: {
    owner?: string
    repo?: string
    labels?: string[]
    perPage?: number
  }
  reddit?: {
    subreddit?: string
    sort?: "hot" | "new" | "top"
    limit?: number
  }
  /** Path to local JSON cache file (default: data/signals-cache.json) */
  localCachePath?: string
  /** Failover strategy: 'first-success' stops at first source with signals, 'all' collects all */
  failoverStrategy?: "first-success" | "all"
}

interface CachedSignal {
  id: string
  sourceId: string
  sourceName: string
  rawPayload: Record<string, unknown>
  fetchedAt: string
}

export class MultiSourceRouter implements SourceAdapter {
  name = "multi-source-router"

  private github: GitHubIssuesAdapter
  private reddit: RedditAdapter
  private localCachePath: string
  private failoverStrategy: "first-success" | "all"
  private connected = false
  private primarySource: string = ""

  constructor(private config: RouterConfig = {}) {
    const githubCfg = config.github ?? {}
    this.github = new GitHubIssuesAdapter(
      githubCfg.owner ?? "microsoft",
      githubCfg.repo ?? "vscode",
      githubCfg.labels ?? ["feature-request", "enhancement"],
      githubCfg.perPage ?? 10
    )

    const redditCfg = config.reddit ?? {}
    this.reddit = new RedditAdapter(
      redditCfg.subreddit ?? "technology",
      redditCfg.sort ?? "hot",
      redditCfg.limit ?? 50
    )

    this.localCachePath =
      config.localCachePath ??
      path.join(process.cwd(), "data", "signals-cache.json")
    this.failoverStrategy = config.failoverStrategy ?? "first-success"
  }

  async connect(): Promise<void> {
    console.log("[MultiSourceRouter] Connecting sources...")
    await this.github.connect()
    await this.reddit.connect()
    this.connected = true
    console.log("[MultiSourceRouter] All sources connected")
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error("Router not connected")
    const fetchedAt = new Date().toISOString()

    // Strategy 1: first-success — try sources in order, return first non-empty result
    if (this.failoverStrategy === "first-success") {
      // Try GitHub
      console.log("\n[MultiSourceRouter] Trying GitHub Issues...")
      try {
        const githubSignals = await this.github.poll()
        if (githubSignals.length > 0) {
          console.log(`[MultiSourceRouter] GitHub returned ${githubSignals.length} signals — using this source`)
          this.primarySource = "github"
          return githubSignals
        }
      } catch (err) {
        console.warn(`[MultiSourceRouter] GitHub failed: ${err}`)
      }

      // Try Reddit
      console.log("\n[MultiSourceRouter] Trying Reddit...")
      try {
        const redditSignals = await this.reddit.poll()
        if (redditSignals.length > 0) {
          console.log(`[MultiSourceRouter] Reddit returned ${redditSignals.length} signals — using this source`)
          this.primarySource = "reddit"
          return redditSignals
        }
      } catch (err) {
        console.warn(`[MultiSourceRouter] Reddit failed: ${err}`)
      }

      // Try local cache
      console.log("\n[MultiSourceRouter] Trying local cache...")
      const cachedSignals = this.readLocalCache()
      if (cachedSignals.length > 0) {
        console.log(`[MultiSourceRouter] Local cache returned ${cachedSignals.length} signals — using this source`)
        this.primarySource = "local-cache"
        return cachedSignals
      }

      console.warn("[MultiSourceRouter] All sources returned 0 signals!")
      return []
    }

    // Strategy 2: all — collect from all sources, deduplicate by title
    console.log("\n[MultiSourceRouter] [all] Collecting from all sources...")
    const allSignals: RawSignal[] = []
    const seenTitles = new Set<string>()

    const sources = [
      { name: "GitHub", adapter: this.github, signals: [] as RawSignal[] },
      { name: "Reddit", adapter: this.reddit, signals: [] as RawSignal[] },
    ]

    for (const source of sources) {
      try {
        source.signals = await source.adapter.poll()
        console.log(`[MultiSourceRouter] ${source.name}: ${source.signals.length} signals`)
      } catch (err) {
        console.warn(`[MultiSourceRouter] ${source.name} failed: ${err}`)
        source.signals = []
      }
    }

    // Deduplicate by title similarity
    for (const source of sources) {
      for (const signal of source.signals) {
        const titleKey = (signal.rawPayload.title as string)
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "")
          .trim()
          .slice(0, 50)
        if (!seenTitles.has(titleKey)) {
          seenTitles.add(titleKey)
          allSignals.push(signal)
        }
      }
    }

    // Also add local cache signals (only new ones)
    const cachedSignals = this.readLocalCache()
    for (const signal of cachedSignals) {
      const titleKey = (signal.rawPayload.title as string)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .slice(0, 50)
      if (!seenTitles.has(titleKey)) {
        seenTitles.add(titleKey)
        allSignals.push(signal)
      }
    }

    this.primarySource = "multi"
    console.log(`[MultiSourceRouter] Total unique signals after dedup: ${allSignals.length}`)
    return allSignals
  }

  /**
   * Get the active adapter for normalization.
   * Returns the adapter that was used for the last poll() call.
   */
  getActiveAdapter(): SourceAdapter {
    switch (this.primarySource) {
      case "github":
        return this.github
      case "reddit":
        return this.reddit
      default:
        // For multi-source or local-cache, fall back to github adapter
        // (normalize is generic enough to work with any RawSignal)
        return this.github
    }
  }

  normalize(raw: RawSignal): NormalizedSignal {
    // Delegate to the appropriate adapter based on source
    if (raw.sourceId === "reddit") {
      return this.reddit.normalize(raw)
    }
    if (raw.sourceId === "github-issues") {
      return this.github.normalize(raw)
    }
    // Default: use reddit adapter's normalize (generically handles tags/body)
    return this.reddit.normalize(raw)
  }

  private readLocalCache(): RawSignal[] {
    try {
      if (!fs.existsSync(this.localCachePath)) {
        console.log(`[MultiSourceRouter] Local cache not found: ${this.localCachePath}`)
        return []
      }
      const content = fs.readFileSync(this.localCachePath, "utf-8")
      const cached: CachedSignal[] = JSON.parse(content)
      console.log(`[MultiSourceRouter] Loaded ${cached.length} signals from local cache`)

      const fetchedAt = new Date().toISOString()
      return cached.map(signal => ({
        id: signal.id,
        sourceId: signal.sourceId,
        sourceName: signal.sourceName,
        rawPayload: signal.rawPayload as RawSignal["rawPayload"],
        fetchedAt: signal.fetchedAt || fetchedAt,
      } as RawSignal))
    } catch (err) {
      console.warn(`[MultiSourceRouter] Failed to read local cache: ${err}`)
      return []
    }
  }

  /**
   * Save signals to local cache for future fallback use.
   * Call this after a successful poll to populate the cache.
   */
  async saveToCache(signals: RawSignal[]): Promise<void> {
    try {
      const dir = path.dirname(this.localCachePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const cached: CachedSignal[] = signals.map(s => ({
        id: s.id,
        sourceId: s.sourceId,
        sourceName: s.sourceName,
        rawPayload: s.rawPayload as Record<string, unknown>,
        fetchedAt: s.fetchedAt,
      }))

      fs.writeFileSync(this.localCachePath, JSON.stringify(cached, null, 2), "utf-8")
      console.log(`[MultiSourceRouter] Saved ${signals.length} signals to local cache`)
    } catch (err) {
      console.warn(`[MultiSourceRouter] Failed to save to local cache: ${err}`)
    }
  }

  async disconnect(): Promise<void> {
    await this.github.disconnect()
    await this.reddit.disconnect()
    this.connected = false
    console.log("[MultiSourceRouter] Disconnected")
  }
}
