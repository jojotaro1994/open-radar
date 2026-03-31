/**
 * GitHubSearchAdapter
 *
 * Uses GitHub's /search/issues endpoint to find feature requests across
 * ALL repos (or specific repos) in a single query.
 *
 * Requires authentication for higher rate limits (5,000/hr vs 60/hr).
 * Falls back to empty results if unauthenticated.
 *
 * API: GET /search/issues?q=feature+request+in:title+is:issue+state:open&per_page=20
 */

import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"

interface GitHubSearchIssue {
  id: number
  number: number
  title: string
  body: string | null
  user: { login: string }
  created_at: string
  updated_at: string
  labels: Array<{ name: string; color: string; description?: string }>
  state: string
  repository_url: string
  pull_request?: { html_url: string }
  score: number
}

interface GitHubSearchResponse {
  total_count: number
  incomplete_results: boolean
  items: GitHubSearchIssue[]
}

interface SearchConfig {
  /** Custom search query (e.g. 'feature request in:title is:issue state:open repo:owner/repo') */
  query?: string
  /** Custom per-page limit (default 20, max 100) */
  perPage?: number
  /** Label filter (applied as 'label:labelname') */
  label?: string
  /** Specific repo to search ('owner/repo') */
  repo?: string
}

export class GitHubSearchAdapter implements SourceAdapter {
  name = "github-search"

  private token: string | null
  private config: SearchConfig
  private connected = false

  constructor(token: string | null, config: SearchConfig = {}) {
    this.token = token
    this.config = config
  }

  async connect(): Promise<void> {
    this.connected = true
    console.log(`[GitHubSearchAdapter] Connected (token: ${!!this.token})`)
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error("Adapter not connected")
    if (!this.token) {
      console.warn("[GitHubSearchAdapter] No token — skipping search API")
      return []
    }

    const fetchedAt = new Date().toISOString()
    const allSignals: RawSignal[] = []

    // Build search queries targeting different categories
    const queries = this.buildQueries()

    for (const query of queries) {
      const signals = await this.search(query, fetchedAt)
      allSignals.push(...signals)
    }

    // Dedupe by id
    const seen = new Set<string>()
    const unique = allSignals.filter(s => {
      if (seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })

    console.log(`[GitHubSearchAdapter] Total signals after dedup: ${unique.length}`)
    return unique
  }

  private buildQueries(): string[] {
    const { label, repo } = this.config

    const queries: string[] = []

    // If custom query provided, use it
    if (this.config.query) {
      return [this.config.query]
    }

    // Broad feature request search across high-signal repos
    const highSignalRepos = [
      "microsoft/vscode",
      "facebook/react",
      "vercel/next.js",
      "remix-run/remix",
      "sveltejs/svelte",
      "vuejs/core",
      "golang/go",
      "microsoft/TypeScript",
      "denoland/deno",
      "prisma/prisma",
    ]

    const repoList = repo
      ? [repo]
      : highSignalRepos

    for (const r of repoList) {
      // Feature request in title, open issues, no PRs
      const base = `is:issue is:open repo:${r}`
      queries.push(`${base} "feature request" in:title`)
      queries.push(`${base} "would be nice" in:title`)
      queries.push(`${base} "enhancement" in:title`)
    }

    // Broad cross-repo search for highly voted feature requests
    if (!repo) {
      queries.push("is:issue is:open \"feature request\" in:title score:>100")
      queries.push("is:issue is:open \"would be nice\" in:title score:>50")
    }

    // Apply label filter if provided
    if (label) {
      return queries.map(q => `${q} label:${label}`)
    }

    return queries.slice(0, 5) // limit to 5 queries to conserve rate limit
  }

  private async search(query: string, fetchedAt: string): Promise<RawSignal[]> {
    try {
      const url = new URL("https://api.github.com/search/issues")
      url.searchParams.set("q", query)
      url.searchParams.set("per_page", String(this.config.perPage ?? 20))
      url.searchParams.set("sort", "score")
      url.searchParams.set("order", "desc")

      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "prj-prototype-rader/1.0",
        Authorization: `token ${this.token}`,
      }

      console.log(`[GitHubSearchAdapter] Query: ${query}`)
      const response = await fetch(url.toString(), { headers })

      if (response.status === 403) {
        const remaining = response.headers.get("X-RateLimit-Remaining")
        console.warn(`[GitHubSearchAdapter] Rate limited (${remaining} remaining). Waiting...`)
        return []
      }

      if (!response.ok) {
        console.warn(`[GitHubSearchAdapter] Search failed: ${response.status}`)
        return []
      }

      const data: GitHubSearchResponse = await response.json() as GitHubSearchResponse
      console.log(`[GitHubSearchAdapter] Found ${data.items.length} items (total: ${data.total_count})`)

      return data.items
        .filter(item => !item.pull_request) // exclude PRs
        .map(item => this.mapToRawSignal(item, fetchedAt))

    } catch (err) {
      console.warn(`[GitHubSearchAdapter] Search error: ${err}`)
      return []
    }
  }

  private mapToRawSignal(item: GitHubSearchIssue, fetchedAt: string): RawSignal {
    // Extract owner/repo from repository_url
    const repoPath = item.repository_url.replace("https://api.github.com/repos/", "")
    const [owner, repo] = repoPath.split("/")

    return {
      id: `gh-search-${item.id}`,
      sourceId: "github-search",
      sourceName: `GitHub Search (${owner}/${repo})`,
      rawPayload: {
        title: item.title,
        body: item.body ?? "",
        author: item.user.login,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        tags: item.labels.map(l => l.name),
        labelDescriptions: item.labels.map(l => l.description ?? ""),
        issueNumber: item.number,
        state: item.state,
        score: item.score,
        repo: `${owner}/${repo}`,
        owner,
        repoName: repo,
        searchQuery: this.config.query ?? "feature-request search",
        signalType: this.inferSignalType(item),
      },
      fetchedAt,
    }
  }

  private inferSignalType(item: GitHubSearchIssue): string {
    const titleLower = item.title.toLowerCase()
    const bodyLower = (item.body ?? "").toLowerCase()
    const labelNames = item.labels.map(l => l.name.toLowerCase())

    if (labelNames.some(l => l.includes("bug") || l.includes("defect") || l.includes("crash"))) {
      return "bug"
    }

    if (labelNames.some(l => l.includes("feature") || l.includes("enhancement") || l.includes("proposal"))) {
      return "feature_request"
    }

    if (bodyLower.includes("would be nice") || bodyLower.includes("should support") || titleLower.includes("feature request")) {
      return "feature_request"
    }

    if (bodyLower.includes("confusing") || bodyLower.includes("frustrat") || bodyLower.includes("annoying")) {
      return "workflow_friction"
    }

    return "feature_request"
  }

  normalize(raw: RawSignal): NormalizedSignal {
    const tags = (raw.rawPayload.tags as string[]) ?? []
    const signalType = (raw.rawPayload as any)?.signalType ?? "feature_request"
    const repo = (raw.rawPayload as any)?.repo ?? "unknown"
    const owner = (raw.rawPayload as any)?.owner ?? "unknown"
    const repoName = (raw.rawPayload as any)?.repoName ?? "unknown"

    return {
      id: `norm-${raw.id}`,
      rawSignalId: raw.id,
      title: raw.rawPayload.title as string,
      body: raw.rawPayload.body as string,
      sourceType: "github-search",
      author: raw.rawPayload.author as string,
      createdAt: raw.rawPayload.createdAt as string,
      tags,
      metadata: {
        originalSourceType: raw.sourceName,
        signalType,
        issueNumber: (raw.rawPayload as any)?.issueNumber,
        state: (raw.rawPayload as any)?.state,
        score: (raw.rawPayload as any)?.score,
        repo,
        owner,
        repoName,
        searchQuery: (raw.rawPayload as any)?.searchQuery,
      },
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    console.log("[GitHubSearchAdapter] Disconnected")
  }
}
