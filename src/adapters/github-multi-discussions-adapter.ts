/**
 * GitHubMultiDiscussionsAdapter
 *
 * Fetches GitHub Discussions from multiple repos in PARALLEL,
 * deduplicates by title similarity, and returns a unified signal list
 * with repo origin tagged.
 *
 * Target repos (high-signal for dev-tool / DX pain points):
 *   - vercel/next.js       — rate-limit exempt, SSR/framework DX pain points
 *   - remix-run/remix       — routing/SSR pain points
 *   - sveltejs/svelte       — reactive framework, compile-time pain points
 *   - vuejs/core            — progressive framework, reactivity/API pain points
 *   - golang/go             — language/stdlib, toolchain pain points
 *
 * Run: tsx src/orchestrator/github-multi-runner.ts
 */

import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"

interface RepoConfig {
  owner: string
  repo: string
  perPage?: number
  /** Only fetch from this category ID (optional) */
  categoryId?: number
}

// Default repos with Discussions enabled (iteration 9 findings)
const DEFAULT_DISCUSSION_REPOS: RepoConfig[] = [
  { owner: "vercel", repo: "next.js", perPage: 15 },
  { owner: "remix-run", repo: "remix", perPage: 15 },
  { owner: "sveltejs", repo: "svelte", perPage: 15 },
  { owner: "vuejs", repo: "core", perPage: 15 },
  { owner: "golang", repo: "go", perPage: 15 },
  // Expanded repos (iteration 12)
  { owner: "microsoft", repo: "vscode", perPage: 10 },
  { owner: "microsoft", repo: "TypeScript", perPage: 10 },
  { owner: "facebook", repo: "react", perPage: 10 },
  { owner: "denoland", repo: "deno", perPage: 10 },
  { owner: "prisma", repo: "prisma", perPage: 10 },
  { owner: "elastic", repo: "elasticsearch", perPage: 10 },
  { owner: "grafana", repo: "grafana", perPage: 10 },
]

interface GitHubDiscussion {
  id: number
  number: number
  title: string
  body: string | null
  user: { login: string }
  created_at: string
  updated_at: string
  labels: Array<{ name: string; description?: string }>
  state: string
  state_reason: string | null
  comments: number
  category: {
    name: string
    emoji: string
    description: string
  }
  reactions?: {
    total_count: number
    "+1": number
    "-1": number
  }
}

export const DEFAULT_REPOS: RepoConfig[] = [
  { owner: "vercel", repo: "next.js", perPage: 15 },
  { owner: "remix-run", repo: "remix", perPage: 15 },
  { owner: "sveltejs", repo: "svelte", perPage: 15 },
  { owner: "vuejs", repo: "core", perPage: 15 },
  { owner: "golang", repo: "go", perPage: 15 },
]

export class GitHubMultiDiscussionsAdapter implements SourceAdapter {
  name = "github-multi-discussions"

  private repos: RepoConfig[]
  private token: string | null
  private connected = false

  constructor(repos: RepoConfig[] = DEFAULT_DISCUSSION_REPOS, token: string | null = null) {
    this.repos = repos
    this.token = token ?? process.env.GITHUB_TOKEN ?? null
  }

  async connect(): Promise<void> {
    this.connected = true
    console.log(`[GitHubMultiDiscussionsAdapter] Connected (${this.repos.length} repos)`)
    for (const r of this.repos) {
      console.log(`    - ${r.owner}/${r.repo}`)
    }
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error("Adapter not connected")

    const fetchedAt = new Date().toISOString()

    // Fetch all repos in parallel
    const results = await Promise.allSettled(
      this.repos.map(repo => this.fetchRepo(repo, fetchedAt))
    )

    const allSignals: RawSignal[] = []
    const repoStats: Record<string, number> = {}
    const repoErrors: string[] = []

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const repo = this.repos[i]
      const repoKey = `${repo.owner}/${repo.repo}`

      if (result.status === "fulfilled") {
        const signals = result.value
        repoStats[repoKey] = signals.length
        allSignals.push(...signals)
      } else {
        repoErrors.push(`${repoKey}: ${result.reason}`)
        repoStats[repoKey] = 0
      }
    }

    // Deduplicate by title (case-insensitive, stripped)
    const deduplicated = this.deduplicate(allSignals)

    console.log(`[GitHubMultiDiscussionsAdapter] Repo results:`)
    for (const [repo, count] of Object.entries(repoStats)) {
      console.log(`    ${repo}: ${count} signals`)
    }
    if (repoErrors.length > 0) {
      console.warn(`    Errors: ${repoErrors.join("; ")}`)
    }
    console.log(`[GitHubMultiDiscussionsAdapter] Total before dedup: ${allSignals.length}, after: ${deduplicated.length}`)

    return deduplicated
  }

  private async fetchRepo(repo: RepoConfig, fetchedAt: string): Promise<RawSignal[]> {
    const url = new URL(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/discussions`
    )
    url.searchParams.set("per_page", String(repo.perPage ?? 15))
    url.searchParams.set("sort", "created")
    url.searchParams.set("direction", "desc")
    if (repo.categoryId) {
      url.searchParams.set("category_id", String(repo.categoryId))
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "prj-prototype-rader/1.0",
    }
    if (this.token) {
      headers["Authorization"] = `token ${this.token}`
    }

    const response = await fetch(url.toString(), { headers })

    if (!response.ok) {
      const status = response.status
      if (status === 410 || status === 404) {
        console.warn(`[GitHubMultiDiscussionsAdapter] Discussions disabled or repo not found: ${repo.owner}/${repo.repo} (${status})`)
      } else {
        console.warn(`[GitHubMultiDiscussionsAdapter] API error for ${repo.owner}/${repo.repo}: ${status}`)
      }
      return []
    }

    const discussions: GitHubDiscussion[] = await response.json() as GitHubDiscussion[]
    console.log(`[GitHubMultiDiscussionsAdapter] ${repo.owner}/${repo.repo}: fetched ${discussions.length} discussions`)

    return discussions.map(d => this.mapToRawSignal(d, repo, fetchedAt))
  }

  private mapToRawSignal(
    discussion: GitHubDiscussion,
    repo: RepoConfig,
    fetchedAt: string
  ): RawSignal {
    return {
      id: `gh-disc-${repo.owner}-${repo.repo}-${discussion.id}`,
      sourceId: "github-multi-discussions",
      sourceName: `GitHub Discussions (${repo.owner}/${repo.repo})`,
      rawPayload: {
        title: discussion.title,
        body: discussion.body ?? "",
        author: discussion.user.login,
        createdAt: discussion.created_at,
        updatedAt: discussion.updated_at,
        tags: discussion.labels.map(l => l.name),
        discussionNumber: discussion.number,
        state: discussion.state,
        stateReason: discussion.state_reason,
        commentCount: discussion.comments,
        category: discussion.category?.name ?? "",
        categoryEmoji: discussion.category?.emoji ?? "",
        reactionCount: discussion.reactions?.total_count ?? 0,
        repo: `${repo.owner}/${repo.repo}`,
        signalType: this.inferSignalType(discussion),
      },
      fetchedAt,
    }
  }

  private inferSignalType(discussion: GitHubDiscussion): string {
    const bodyLower = (discussion.body ?? "").toLowerCase()
    const titleLower = discussion.title.toLowerCase()
    const categoryName = (discussion.category?.name ?? "").toLowerCase()
    const labels = discussion.labels.map(l => l.name.toLowerCase())

    if (
      categoryName.includes("idea") ||
      categoryName.includes("feature") ||
      categoryName.includes("proposal") ||
      categoryName.includes("request")
    ) {
      return "feature_request"
    }

    if (categoryName.includes("q&a") || categoryName.includes("question")) {
      if (bodyLower.includes("would be nice") || bodyLower.includes("should support") || bodyLower.includes("could we")) {
        return "feature_request"
      }
      return "noise"
    }

    if (labels.some(l => l.includes("feature") || l.includes("enhancement") || l.includes("proposal"))) {
      return "feature_request"
    }

    const featureWords = ["would be nice", "should support", "could we", "it would be", "looking for", "ability to", "feature request"]
    if (featureWords.some(w => bodyLower.includes(w) || titleLower.includes(w))) {
      return "feature_request"
    }

    if (
      bodyLower.includes("bug") ||
      bodyLower.includes("crash") ||
      bodyLower.includes("doesn't work") ||
      bodyLower.includes("not working") ||
      bodyLower.includes("error")
    ) {
      return "bug"
    }

    if (
      bodyLower.includes("confusing") ||
      bodyLower.includes("frustrat") ||
      bodyLower.includes("annoying") ||
      bodyLower.includes("workflow")
    ) {
      return "workflow_friction"
    }

    return "feature_request"
  }

  normalize(raw: RawSignal): NormalizedSignal {
    const tags = (raw.rawPayload.tags as string[]) ?? []
    const signalType = (raw.rawPayload as any)?.signalType ?? "feature_request"

    return {
      id: `norm-${raw.id}`,
      rawSignalId: raw.id,
      title: raw.rawPayload.title as string,
      body: raw.rawPayload.body as string,
      sourceType: "github-multi-discussions",
      author: raw.rawPayload.author as string,
      createdAt: raw.rawPayload.createdAt as string,
      tags,
      metadata: {
        originalSourceType: raw.sourceName,
        signalType,
        discussionNumber: (raw.rawPayload as any)?.discussionNumber,
        state: (raw.rawPayload as any)?.state,
        commentCount: (raw.rawPayload as any)?.commentCount ?? 0,
        category: (raw.rawPayload as any)?.category ?? "",
        reactionCount: (raw.rawPayload as any)?.reactionCount ?? 0,
        repo: (raw.rawPayload as any)?.repo ?? "",
      },
    }
  }

  private deduplicate(signals: RawSignal[]): RawSignal[] {
    const seen = new Map<string, RawSignal>()

    for (const signal of signals) {
      const title = (signal.rawPayload.title as string ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .slice(0, 60)

      if (!seen.has(title)) {
        seen.set(title, signal)
      }
    }

    return Array.from(seen.values())
  }

  async disconnect(): Promise<void> {
    this.connected = false
    console.log("[GitHubMultiDiscussionsAdapter] Disconnected")
  }
}
