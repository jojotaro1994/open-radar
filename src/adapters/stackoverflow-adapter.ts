/**
 * StackOverflowAdapter
 *
 * Fetches feature-request tagged questions from Stack Exchange sites via the
 * public Stack Exchange API (no auth required).
 *
 * API: https://api.stackexchange.com/2.3/
 *
 * KEY FINDING (2026-03-21):
 *   - Stack Overflow main (stackoverflow.com) does NOT have a `feature-request` tag
 *   - Meta Stack Overflow (meta.stackoverflow.com) DOES have `feature-request` tagged questions
 *   - These are about the Stack Exchange platform itself — useful for understanding
 *     product feedback patterns but not third-party product signals
 *   - Other Stack Exchange sites (ux, apple, superuser) have mixed results
 *
 * Strategy:
 *   1. Primary: meta.stackoverflow.com — feature-request tagged, score > 50
 *   2. Fallback: text search on Stack Overflow main for product feedback keywords
 *
 * Maps: question_id→id, title→title, body→body, owner.display_name→author,
 *       creation_date→createdAt, tags→tags
 * sourceType: "stack-overflow"
 */

import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"

interface StackExchangeQuestion {
  question_id: number
  title: string
  body: string          // HTML body, returned with filter=withbody
  tags: string[]
  owner: {
    display_name: string
    user_id: number
    link: string
  }
  score: number
  creation_date: number   // Unix timestamp
  link: string
  answer_count: number
  view_count: number
  is_answered: boolean
  content_license: string
}

interface StackExchangeResponse {
  items: StackExchangeQuestion[]
  has_more: boolean
  quota_max: number
  quota_remaining: number
}

const FEATURE_REQUEST_KEYWORDS = [
  "would be nice",
  "would love",
  "please add",
  "please implement",
  "should have",
  "could we",
  "wishlist",
  "i wish",
  "it would be great",
  "suggestion:",
  "enhancement",
  "could be better",
  "needs a feature",
  "want a",
  "needs to have",
  "missing feature",
  "nobody has",
  "wish there was",
  "it would be awesome",
]

function stripHtml(html: string): string {
  return html.replace(/<[^<]+?>/g, " ").replace(/\s+/g, " ").trim()
}

function isFeatureRequestText(title: string, body: string): boolean {
  const text = `${title} ${body}`.toLowerCase()
  return FEATURE_REQUEST_KEYWORDS.some(kw => text.includes(kw))
}

function detectProducts(title: string, body: string): string[] {
  const text = `${title} ${body}`.toLowerCase()
  const tags: string[] = []

  const products: Array<[string, string[]]> = [
    ["stackoverflow", ["stack overflow", "stackoverflow", "so "]],
    ["dark-mode", ["dark mode", "dark-theme"]],
    ["notifications", ["notification", "notifications"]],
    ["mobile-app", ["mobile app", "ios app", "android app"]],
    ["search", ["search", "searching"]],
    ["voting", ["voting", "vote", "upvote", "downvote"]],
    ["review", ["review", "triage"]],
    ["duplicate", ["duplicate", "dupe"]],
    ["editor", ["editor", "code block", "snippet"]],
    ["moderation", ["moderat", "ban", "flag"]],
  ]

  for (const [tag, keywords] of products) {
    if (keywords.some(kw => text.includes(kw))) {
      tags.push(tag)
    }
  }

  return [...new Set(tags)]
}

export class StackOverflowAdapter implements SourceAdapter {
  name = "stack-overflow"
  private connected = false

  async connect(): Promise<void> {
    this.connected = true
    console.log("[StackOverflowAdapter] Connected (Meta Stack Overflow — feature-request)")
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error("Adapter not connected")

    const fetchedAt = new Date().toISOString()
    const allSignals: RawSignal[] = []

    // ── Primary: Meta Stack Overflow feature-requests ─────────────────────
    console.log("[StackOverflowAdapter] Fetching Meta Stack Overflow feature-requests...")
    const metaSignals = await this.fetchMetaSO(fetchedAt)
    console.log(`[StackOverflowAdapter] Meta SO: ${metaSignals.length} signals`)
    allSignals.push(...metaSignals)

    // ── Fallback: HN-style feature request detection on Stack Overflow main ─
    console.log("[StackOverflowAdapter] Fetching Stack Overflow product-feedback via text search...")
    const soSignals = await this.fetchStackOverflowMain(fetchedAt)
    console.log(`[StackOverflowAdapter] SO main: ${soSignals.length} signals`)
    allSignals.push(...soSignals)

    if (allSignals.length === 0) {
      console.log("[StackOverflowAdapter] No signals found. Using fallback.")
      return this.getFallbackSignals(fetchedAt)
    }

    return allSignals
  }

  private async fetchMetaSO(fetchedAt: string): Promise<RawSignal[]> {
    try {
      // Fetch feature-request tagged questions with score > 50
      const url =
        `https://api.stackexchange.com/2.3/search/advanced` +
        `?order=desc&sort=votes&site=meta.stackoverflow` +
        `&pagesize=20&min=50&tagged=feature-request&filter=withbody`

      const response = await fetch(url, {
        headers: {
          "User-Agent": "prj-prototype-rader/1.0 (product feedback research)",
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        console.warn(`[StackOverflowAdapter] Meta SO HTTP ${response.status}`)
        return []
      }

      const data: StackExchangeResponse = (await response.json()) as StackExchangeResponse
      const questions = data.items ?? []

      console.log(`[StackOverflowAdapter] Meta SO fetched ${questions.length} questions (score > 50)`)

      return questions
        .filter(q => q.score > 50)
        .map(q => this.mapToRawSignal(q, fetchedAt, "meta.stackoverflow"))

    } catch (err) {
      console.warn(`[StackOverflowAdapter] Meta SO error: ${err}`)
      return []
    }
  }

  private async fetchStackOverflowMain(fetchedAt: string): Promise<RawSignal[]> {
    try {
      // Search Stack Overflow main for product feedback keywords
      // These are questions where people are asking about missing product features
      const queries = [
        "feature request please add",
        "would be nice tool",
        "missing feature app",
      ]

      const allQuestions: StackExchangeQuestion[] = []

      for (const query of queries) {
        const url =
          `https://api.stackexchange.com/2.3/search/advanced` +
          `?order=desc&sort=votes&site=stackoverflow` +
          `&pagesize=10&min=30&q=${encodeURIComponent(query)}&filter=withbody`

        const response = await fetch(url, {
          headers: {
            "User-Agent": "prj-prototype-rader/1.0 (product feedback research)",
            Accept: "application/json",
          },
        })

        if (!response.ok) continue

        const data: StackExchangeResponse = (await response.json()) as StackExchangeResponse
        allQuestions.push(...(data.items ?? []))
      }

      // Dedupe by question_id
      const seen = new Set<number>()
      const unique = allQuestions.filter(q => {
        if (seen.has(q.question_id)) return false
        seen.add(q.question_id)
        return true
      })

      console.log(`[StackOverflowAdapter] SO main fetched ${unique.length} unique questions`)

      return unique
        .filter(q => isFeatureRequestText(q.title, stripHtml(q.body)))
        .filter(q => q.score > 20)
        .slice(0, 10)
        .map(q => this.mapToRawSignal(q, fetchedAt, "stackoverflow"))

    } catch (err) {
      console.warn(`[StackOverflowAdapter] SO main error: ${err}`)
      return []
    }
  }

  private mapToRawSignal(q: StackExchangeQuestion, fetchedAt: string, site: string): RawSignal {
    const tags = detectProducts(q.title, stripHtml(q.body))
    const bodyText = stripHtml(q.body)
    const signalType = this.inferSignalType(q.title, bodyText)

    return {
      id: `so-${q.question_id}`,
      sourceId: "stack-overflow",
      sourceName: site === "meta.stackoverflow"
        ? "Meta Stack Overflow"
        : "Stack Overflow",
      rawPayload: {
        title: q.title,
        body: bodyText,
        author: q.owner?.display_name ?? "anonymous",
        createdAt: new Date(q.creation_date * 1000).toISOString(),
        tags: [...q.tags, ...tags],
        signalType,
        url: q.link,
        score: q.score,
        answerCount: q.answer_count,
        viewCount: q.view_count,
        site,
      },
      fetchedAt,
    }
  }

  private inferSignalType(title: string, body: string): string {
    const text = `${title} ${body}`.toLowerCase()

    if (text.includes("would be nice") || text.includes("would love") || text.includes("wish")) {
      return "feature_request"
    }
    if (text.includes("please add") || text.includes("please implement")) {
      return "feature_request"
    }
    if (text.includes("bug") || text.includes("broken") || text.includes("crash")) {
      return "bug_report"
    }
    if (text.includes("frustrat") || text.includes("confusing") || text.includes("annoying")) {
      return "workflow_friction"
    }
    return "feature_request"
  }

  private getFallbackSignals(fetchedAt: string): RawSignal[] {
    const fallbacks: Array<{
      id: string
      title: string
      body: string
      author: string
      createdAt: string
      tags: string[]
      score: number
      site: string
    }> = [
      {
        id: "so-fallback-001",
        title: "Why is there no dark theme on SO?",
        body: "Feature request from Meta Stack Overflow: Users have been requesting a dark mode for Stack Overflow for years. The lack of a dark theme forces users to use third-party browser extensions or deal with eye strain during long coding sessions. This is a basic quality-of-life feature that many developer tools now provide by default.",
        author: "Wicelo",
        createdAt: new Date(1413220756 * 1000).toISOString(),
        tags: ["feature-request", "dark-mode", "stackoverflow"],
        score: 1048,
        site: "meta.stackoverflow",
      },
      {
        id: "so-fallback-002",
        title: "It's time to reward the duplicate finders",
        body: "Feature request: Stack Overflow sees many repeated questions. Experienced users who find and close duplicates as such perform an important curatorial role, but there's no reputation incentive to do this. The proposal is to award reputation points to users who correctly identify duplicates, encouraging more community curation.",
        author: "都已走过",
        createdAt: new Date(1520000000 * 1000).toISOString(),
        tags: ["feature-request", "duplicate-questions", "reputation", "curation"],
        score: 752,
        site: "meta.stackoverflow",
      },
      {
        id: "so-fallback-003",
        title: "Please unpin the accepted answer from the top",
        body: "Feature request: Accepted answers are pinned to the top even when they're outvoted by other answers. This creates a misleading signal to future readers. The request is to sort accepted answers by votes alone, treating the accept vote as a tiebreaker rather than a super-vote.",
        author: "Robert Columbia",
        createdAt: new Date(1500000000 * 1000).toISOString(),
        tags: ["feature-request", "accepted-answer", "voting", "sorting"],
        score: 645,
        site: "meta.stackoverflow",
      },
      {
        id: "so-fallback-004",
        title: "Add VueJS to preset snippet options",
        body: "Feature request: Stack Overflow's code snippet feature only supports certain JavaScript frameworks (React, Angular, Knockout). VueJS is increasingly popular but not available as a preset. Adding VueJS support would reduce the friction for Vue developers asking questions about their framework-specific issues.",
        author: "manyxcxi",
        createdAt: new Date(1480000000 * 1000).toISOString(),
        tags: ["feature-request", "code-snippet", "vuejs", "javascript"],
        score: 438,
        site: "meta.stackoverflow",
      },
      {
        id: "so-fallback-005",
        title: "Triage needs to be fixed urgently",
        body: "Feature request: The Triage review queue is not working as intended. Questions that should be closed as off-topic or unclear are being approved instead. The request is to fix the Triage workflow so that questions are properly categorized and low-quality content doesn't reach the main site.",
        author: "Shog9",
        createdAt: new Date(1470000000 * 1000).toISOString(),
        tags: ["feature-request", "triage", "review", "moderation", "quality"],
        score: 521,
        site: "meta.stackoverflow",
      },
    ]

    return fallbacks.map(signal => ({
      id: signal.id,
      sourceId: "stack-overflow",
      sourceName: signal.site === "meta.stackoverflow"
        ? "Meta Stack Overflow — mock fallback"
        : "Stack Overflow — mock fallback",
      rawPayload: {
        title: signal.title,
        body: signal.body,
        author: signal.author,
        createdAt: signal.createdAt,
        tags: signal.tags,
        signalType: "feature_request",
        url: `https://${signal.site}/questions/${signal.id.split("-")[2]}`,
        score: signal.score,
        site: signal.site,
        isFallback: true,
      },
      fetchedAt,
    }))
  }

  normalize(raw: RawSignal): NormalizedSignal {
    const tags = (raw.rawPayload.tags as string[]) ?? []
    const signalType = (raw.rawPayload as any)?.signalType ?? "feature_request"
    const site = (raw.rawPayload as any)?.site ?? "stackoverflow"

    return {
      id: `norm-${raw.id}`,
      rawSignalId: raw.id,
      title: raw.rawPayload.title as string,
      body: raw.rawPayload.body as string,
      sourceType: `stack-overflow:${site}`,
      author: raw.rawPayload.author as string,
      createdAt: raw.rawPayload.createdAt as string,
      tags,
      metadata: {
        originalSourceType: raw.sourceName,
        signalType,
        url: (raw.rawPayload as any)?.url,
        score: (raw.rawPayload as any)?.score,
        answerCount: (raw.rawPayload as any)?.answerCount,
        viewCount: (raw.rawPayload as any)?.viewCount,
        site,
        isFallback: (raw.rawPayload as any)?.isFallback ?? false,
      },
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    console.log("[StackOverflowAdapter] Disconnected")
  }
}
