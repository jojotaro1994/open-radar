/**
 * MarketingAutomationAdapter
 *
 * Fetches GitHub Discussions from MA (Marketing Automation) tool repos in PARALLEL,
 * tags signals with MA domain (email/SMS/CRM/messaging/push), and returns
 * a unified signal list with source type "github-discussions-ma".
 *
 * Confirmed repos with discussions enabled (2026-03-21):
 *   - twilio/twilio-node       — SMS / WhatsApp API  (domain: SMS/whatsapp)
 *   - intercom/intercom-node   — customer messaging  (domain: messaging/support)
 *   - firebase/firebase-admin-node — push notifications (domain: push/mobile)
 *
 * Run: npx tsx src/orchestrator/ma-domain-runner.ts
 */

import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

interface RepoConfig {
  owner: string
  repo: string
  /** MA domain tag applied to all signals from this repo */
  domain: "sms/whatsapp" | "messaging/support" | "push/mobile" | "email" | "analytics"
  perPage?: number
  /** Only fetch from this category ID (optional) */
  categoryId?: number
}

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

/** MA-tool repos with GitHub Discussions enabled */
export const MA_REPOS: RepoConfig[] = [
  {
    owner: "twilio",
    repo: "twilio-node",
    domain: "sms/whatsapp",
    perPage: 20,
  },
  {
    owner: "intercom",
    repo: "intercom-node",
    domain: "messaging/support",
    perPage: 20,
  },
  {
    owner: "firebase",
    repo: "firebase-admin-node",
    domain: "push/mobile",
    perPage: 20,
  },
]

export class MarketingAutomationAdapter implements SourceAdapter {
  name = "github-discussions-ma"

  private repos: RepoConfig[]
  private connected = false

  constructor(repos: RepoConfig[] = MA_REPOS) {
    this.repos = repos
  }

  async connect(): Promise<void> {
    this.connected = true
    console.log(`[MarketingAutomationAdapter] Connected (${this.repos.length} MA repos)`)
    for (const r of this.repos) {
      console.log(`    - ${r.owner}/${r.repo} [${r.domain}]`)
    }
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error("Adapter not connected")

    const fetchedAt = new Date().toISOString()

    // Fetch all MA repos in parallel
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

    console.log(`[MarketingAutomationAdapter] Repo results:`)
    for (const [repo, count] of Object.entries(repoStats)) {
      console.log(`    ${repo}: ${count} signals`)
    }
    if (repoErrors.length > 0) {
      console.warn(`    Errors: ${repoErrors.join("; ")}`)
    }
    console.log(`[MarketingAutomationAdapter] Total before dedup: ${allSignals.length}, after: ${deduplicated.length}`)

    return deduplicated
  }

  private async fetchRepo(repo: RepoConfig, fetchedAt: string): Promise<RawSignal[]> {
    const url = new URL(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/discussions`
    )
    url.searchParams.set("per_page", String(repo.perPage ?? 20))
    url.searchParams.set("sort", "created")
    url.searchParams.set("direction", "desc")
    if (repo.categoryId) {
      url.searchParams.set("category_id", String(repo.categoryId))
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "prj-prototype-rader/1.0",
    }
    if (GITHUB_TOKEN) {
      headers["Authorization"] = `token ${GITHUB_TOKEN}`
    }

    const response = await fetch(url.toString(), { headers })

    if (!response.ok) {
      const status = response.status
      if (status === 410 || status === 404) {
        console.warn(`[MarketingAutomationAdapter] Discussions disabled or repo not found: ${repo.owner}/${repo.repo} (${status})`)
      } else {
        console.warn(`[MarketingAutomationAdapter] API error for ${repo.owner}/${repo.repo}: ${status}`)
      }
      return []
    }

    const discussions: GitHubDiscussion[] = await response.json() as GitHubDiscussion[]
    console.log(`[MarketingAutomationAdapter] ${repo.owner}/${repo.repo}: fetched ${discussions.length} discussions`)

    return discussions.map(d => this.mapToRawSignal(d, repo, fetchedAt))
  }

  private mapToRawSignal(
    discussion: GitHubDiscussion,
    repo: RepoConfig,
    fetchedAt: string
  ): RawSignal {
    return {
      id: `ma-disc-${repo.owner}-${repo.repo}-${discussion.id}`,
      sourceId: "github-discussions-ma",
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
        domain: repo.domain,  // MA domain tag
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

    // Announcement / Q&A → noise
    if (
      categoryName.includes("announcement") ||
      categoryName.includes("q&a") ||
      categoryName.includes("question")
    ) {
      return "noise"
    }

    // Idea / feature discussion
    if (
      categoryName.includes("idea") ||
      categoryName.includes("feature") ||
      categoryName.includes("proposal") ||
      categoryName.includes("request")
    ) {
      return "feature_request"
    }

    // Check labels
    if (labels.some(l => l.includes("feature") || l.includes("enhancement") || l.includes("proposal"))) {
      return "feature_request"
    }

    // Check body for feature language
    const featureWords = [
      "would be nice", "should support", "could we", "it would be",
      "looking for", "ability to", "feature request", "it would be great",
      "it would be nice", "would help", "would be useful"
    ]
    if (featureWords.some(w => bodyLower.includes(w) || titleLower.includes(w))) {
      return "feature_request"
    }

    // Bug / problem report
    if (
      bodyLower.includes("bug") ||
      bodyLower.includes("crash") ||
      bodyLower.includes("doesn't work") ||
      bodyLower.includes("not working") ||
      bodyLower.includes("error")
    ) {
      return "bug"
    }

    // Workflow friction
    if (
      bodyLower.includes("confusing") ||
      bodyLower.includes("frustrat") ||
      bodyLower.includes("annoying") ||
      bodyLower.includes("workflow")
    ) {
      return "workflow_friction"
    }

    // Default to feature_request for MA context
    return "feature_request"
  }

  normalize(raw: RawSignal): NormalizedSignal {
    const tags = (raw.rawPayload.tags as string[]) ?? []
    const signalType = (raw.rawPayload as any)?.signalType ?? "feature_request"
    const domain = (raw.rawPayload as any)?.domain ?? "unknown"

    return {
      id: `norm-${raw.id}`,
      rawSignalId: raw.id,
      title: raw.rawPayload.title as string,
      body: raw.rawPayload.body as string,
      sourceType: "github-discussions-ma",
      author: raw.rawPayload.author as string,
      createdAt: raw.rawPayload.createdAt as string,
      tags,
      metadata: {
        originalSourceType: raw.sourceName,
        signalType,
        domain,  // MA domain
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
    console.log("[MarketingAutomationAdapter] Disconnected")
  }
}
