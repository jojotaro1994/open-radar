/**
 * GitHubDiscussionsAdapter
 *
 * Fetches feature discussions from public GitHub repos using the Discussions API.
 * GitHub Discussions are independent of rate limits that apply to the Issues API.
 * Discussions are enabled on many popular repos (e.g., vercel/next.js, microsoft/vscode-docs).
 */

import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

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

export class GitHubDiscussionsAdapter implements SourceAdapter {
  name = "github-discussions"

  private owner: string
  private repo: string
  private perPage: number
  private categoryId?: number

  private connected = false

  constructor(
    owner: string = "vercel",
    repo: string = "next.js",
    perPage: number = 20,
    categoryId?: number
  ) {
    this.owner = owner
    this.repo = repo
    this.perPage = perPage
    this.categoryId = categoryId
  }

  async connect(): Promise<void> {
    this.connected = true
    console.log(`[GitHubDiscussionsAdapter] Connected to ${this.owner}/${this.repo}`)
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error("Adapter not connected")

    const fetchedAt = new Date().toISOString()

    try {
      const url = new URL(
        `https://api.github.com/repos/${this.owner}/${this.repo}/discussions`
      )
      url.searchParams.set("per_page", String(this.perPage))
      url.searchParams.set("sort", "created")
      url.searchParams.set("direction", "desc")
      if (this.categoryId) {
        url.searchParams.set("category_id", String(this.categoryId))
      }

      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "prj-prototype-rader/1.0",
      }
      if (GITHUB_TOKEN) {
        headers["Authorization"] = `token ${GITHUB_TOKEN}`
      }

      console.log(`[GitHubDiscussionsAdapter] Fetching ${url.toString()}`)
      const response = await fetch(url.toString(), { headers })

      if (!response.ok) {
        const status = response.status
        if (status === 410 || status === 404) {
          console.warn(`[GitHubDiscussionsAdapter] Discussions disabled or repo not found (${status}). Returning empty.`)
        } else {
          console.warn(`[GitHubDiscussionsAdapter] API error ${status}. Returning empty.`)
        }
        return []
      }

      const discussions: GitHubDiscussion[] = await response.json() as GitHubDiscussion[]

      console.log(`[GitHubDiscussionsAdapter] Fetched ${discussions.length} discussions`)

      if (discussions.length === 0) {
        return []
      }

      return discussions.map(d => this.mapToRawSignal(d, fetchedAt))

    } catch (err) {
      console.warn(`[GitHubDiscussionsAdapter] Network error: ${err}. Returning empty.`)
      return []
    }
  }

  private mapToRawSignal(discussion: GitHubDiscussion, fetchedAt: string): RawSignal {
    return {
      id: `gh-disc-${this.owner}-${this.repo}-${discussion.id}`,
      sourceId: "github-discussions",
      sourceName: `GitHub Discussions (${this.owner}/${this.repo})`,
      rawPayload: {
        title: discussion.title,
        body: discussion.body ?? "",
        author: discussion.user.login,
        createdAt: discussion.created_at,
        updatedAt: discussion.updated_at,
        tags: discussion.labels.map(l => l.name),
        discussionNumber: discussion.number,
        state: discussion.state,
        commentCount: discussion.comments,
        category: discussion.category?.name ?? "",
        categoryEmoji: discussion.category?.emoji ?? "",
        reactionCount: discussion.reactions?.total_count ?? 0,
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

    // Idea / feature discussion
    if (
      categoryName.includes("idea") ||
      categoryName.includes("feature") ||
      categoryName.includes("proposal") ||
      categoryName.includes("request")
    ) {
      return "feature_request"
    }

    // Q&A - may contain feature seeds
    if (categoryName.includes("q&a") || categoryName.includes("question")) {
      if (bodyLower.includes("would be nice") || bodyLower.includes("should support") || bodyLower.includes("could we")) {
        return "feature_request"
      }
      return "noise"
    }

    // Check labels
    if (labels.some(l => l.includes("feature") || l.includes("enhancement") || l.includes("proposal"))) {
      return "feature_request"
    }

    // Check body for feature language
    const featureWords = ["would be nice", "should support", "could we", "it would be", "looking for", "ability to", "feature request"]
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
      sourceType: "github-discussions",
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
      },
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    console.log(`[GitHubDiscussionsAdapter] Disconnected`)
  }
}
