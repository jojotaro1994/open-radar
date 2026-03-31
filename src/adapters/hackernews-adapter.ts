/**
 * HackerNewsAdapter
 *
 * Fetches stories from Hacker News via the Algolia Search API (free, no auth required).
 * HN Algolia: ~10k requests/hour rate limit.
 *
 * API: GET https://hn.algolia.com/api/v1/search?query=feature+request&tags=story&hitsPerPage=20
 *
 * Maps: objectID→id, title→title, author→author, created_at→createdAt,
 *       url→body (fallback), story_text→body
 * Filter: only stories with >10 points (relevance signal)
 * sourceType: "hacker-news"
 */

import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"

interface HNAlgoliaHit {
  objectID: string
  title: string | null
  url: string | null
  author: string | null
  created_at: string | null
  story_text?: string | null
  points: number
  tags: string[]
  _tags: string[]
  num_comments: number | null
  rewritten_url?: string | null
}

interface HNAlgoliaResponse {
  hits: HNAlgoliaHit[]
  nbHits: number
  page: number
  nbPages: number
  hitsPerPage: number
}

const FEATURE_REQUEST_KEYWORDS = [
  "would be nice",
  "would love",
  "feature request",
  "request:",
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

const SOFTWARE_APP_KEYWORDS = [
  "app",
  "software",
  "tool",
  "extension",
  "plugin",
  "browser",
  "editor",
  "ide",
  "os",
  "android",
  "ios",
  "windows",
  "macos",
  "linux",
  "website",
  "platform",
  "service",
]

function isFeatureRequest(hit: HNAlgoliaHit): boolean {
  const title = hit.title ?? ""
  const body = hit.story_text ?? hit.story_text ?? ""
  const text = `${title} ${body}`.toLowerCase()

  if (!title && !body) return false

  // Must mention software/app related keywords
  const mentionsSoftware = SOFTWARE_APP_KEYWORDS.some(kw => text.includes(kw))
  if (!mentionsSoftware) return false

  // Must have feature request language
  const hasFeatureLanguage = FEATURE_REQUEST_KEYWORDS.some(kw => text.includes(kw))
  if (hasFeatureLanguage) return true

  // Fallback: check if body is substantive and mentions "would" or "should"
  if (
    (text.includes("would") || text.includes("should") || text.includes("could")) &&
    body.length > 100
  ) {
    return true
  }

  return false
}

export class HackerNewsAdapter implements SourceAdapter {
  name = "hacker-news"

  private query: string
  private hitsPerPage: number
  private connected = false

  constructor(query: string = "feature request", hitsPerPage: number = 20) {
    this.query = query
    this.hitsPerPage = Math.min(hitsPerPage, 50) // Algolia max is ~50 per page
  }

  async connect(): Promise<void> {
    this.connected = true
    console.log(`[HackerNewsAdapter] Connected (query="${this.query}", hitsPerPage=${this.hitsPerPage})`)
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error("Adapter not connected")

    const fetchedAt = new Date().toISOString()

    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(this.query)}&tags=story&hitsPerPage=${this.hitsPerPage}`
      console.log(`[HackerNewsAdapter] Fetching ${url}`)

      const response = await fetch(url, {
        headers: {
          "User-Agent": "prj-prototype-rader/1.0 (prototype radar research project)",
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        console.warn(`[HackerNewsAdapter] HTTP ${response.status}. Falling back to mock signals.`)
        return this.getFallbackSignals(fetchedAt)
      }

      const data: HNAlgoliaResponse = (await response.json()) as HNAlgoliaResponse
      const allHits = data.hits ?? []

      console.log(`[HackerNewsAdapter] Fetched ${allHits.length} hits`)

      // Filter: only stories with >10 points
      const highSignalHits = allHits.filter(hit => hit.points > 10)
      console.log(`[HackerNewsAdapter] Filtered to ${highSignalHits.length} stories with >10 points`)

      // Filter: feature request language
      const featureRequests = highSignalHits.filter(hit => isFeatureRequest(hit))
      console.log(`[HackerNewsAdapter] Filtered to ${featureRequests.length} feature requests`)

      if (featureRequests.length === 0) {
        console.log(`[HackerNewsAdapter] No feature requests found. Using fallback mock signals.`)
        return this.getFallbackSignals(fetchedAt)
      }

      return featureRequests.map(hit => this.mapToRawSignal(hit, fetchedAt))

    } catch (err) {
      console.warn(`[HackerNewsAdapter] Network error: ${err}. Falling back to mock signals.`)
      return this.getFallbackSignals(fetchedAt)
    }
  }

  private mapToRawSignal(hit: HNAlgoliaHit, fetchedAt: string): RawSignal {
    const tags = this.extractTags(hit)
    const signalType = this.inferSignalType(hit.title ?? "", hit.story_text ?? "")

    // body priority: story_text (full HTML content) > url (link) > empty
    const body = hit.story_text ?? hit.story_text ?? hit.url ?? ""

    return {
      id: `hn-${hit.objectID}`,
      sourceId: "hacker-news",
      sourceName: "Hacker News (Algolia)",
      rawPayload: {
        title: hit.title ?? "(no title)",
        body,
        author: hit.author ?? "anonymous",
        createdAt: hit.created_at ?? fetchedAt,
        tags,
        signalType,
        url: hit.url,
        points: hit.points,
        numComments: hit.num_comments,
        objectID: hit.objectID,
      },
      fetchedAt,
    }
  }

  private extractTags(hit: HNAlgoliaHit): string[] {
    const tags: string[] = []
    const title = hit.title ?? ""
    const body = hit.story_text ?? hit.story_text ?? ""
    const text = `${title} ${body}`.toLowerCase()

    // Detect product/platform mentions
    const products = [
      ["vscode", "vs code"],
      ["visual studio code", "vscode"],
      ["chrome", "google chrome"],
      ["firefox", "mozilla firefox"],
      ["arc", "arc browser"],
      ["cursor", "cursor editor"],
      ["windsurf", "windsurf editor"],
      ["notion", "notion app"],
      ["obsidian", "obsidian md"],
      ["linear", "linear app"],
      ["figma", "figma design"],
      ["sketch", "sketch app"],
      ["adobe", "adobe xd"],
      ["github", "github"],
      ["gitlab", "gitlab"],
      ["jira", "jira software"],
      ["slack", "slack app"],
      ["discord", "discord app"],
      ["zoom", "zoom app"],
      ["teams", "microsoft teams"],
      ["hacker news", "hn"],
      ["algolia", "algolia search"],
      ["openai", "openai"],
      ["anthropic", "anthropic"],
      ["claude", "claude ai"],
      ["copilot", "github copilot"],
    ]

    for (const [name, ...aliases] of products) {
      const allNames = [name, ...aliases]
      if (allNames.some(n => text.includes(n))) {
        tags.push(name.toLowerCase().replace(/\s+/g, '-'))
      }
    }

    // Detect request type
    if (text.includes("would be nice") || text.includes("would love")) {
      tags.push("wishlist")
    }
    if (text.includes("please add") || text.includes("please implement")) {
      tags.push("request")
    }
    if (text.includes("bug") || text.includes("broken") || text.includes("crash")) {
      tags.push("bug")
    }
    if (text.includes("mobile") || text.includes("android") || text.includes("ios")) {
      tags.push("mobile")
    }
    if (text.includes("api") || text.includes("webhook")) {
      tags.push("api")
    }
    if (text.includes("ai") || text.includes("llm") || text.includes("gpt") || text.includes("model")) {
      tags.push("ai")
    }

    return [...new Set(tags)] // dedupe
  }

  private inferSignalType(title: string, body: string): string {
    const text = `${title} ${body}`.toLowerCase()

    if (text.includes("crash") || text.includes("bug") || text.includes("broken") || text.includes("error ") || text.includes("fix")) {
      return "bug_report"
    }
    if (text.includes("would be nice") || text.includes("would love") || text.includes("wish") || text.includes("suggestion")) {
      return "feature_request"
    }
    if (text.includes("frustrat") || text.includes("confusing") || text.includes("annoying") || text.includes("complaint")) {
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
      points: number
    }> = [
      {
        id: "hn-fallback-001",
        title: "Ask HN: Would love a VS Code extension that visualizes git branch history",
        body: "I find git branch visualizations useful but have to leave the terminal. Something like GitLens but more interactive would be great. When I'm onboarding to a new codebase, being able to see branch history as a graph would save me hours. Is there anything like this already or would this be worth building?",
        author: "devtools-builder",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["vscode", "git", "visualization", "extension", "dx"],
        points: 42,
      },
      {
        id: "hn-fallback-002",
        title: "Notion lacks a proper embedding system for Figma frames — would be a game changer",
        body: "Miro and Confluence both have live Figma embeds. Notion only shows static images. When designs change frequently (which is always), our design docs go stale within hours. A proper Figma embedding system in Notion would be transformative for design-engineering workflows. The API could support this if Notion wanted to build it.",
        author: "product-engineer-99",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["notion", "figma", "integration", "design", "workflow"],
        points: 38,
      },
      {
        id: "hn-fallback-003",
        title: "Linear's GitHub integration should auto-close issues when PRs merge",
        body: "Many teams use 'Fixes #123' in PR descriptions to auto-close Linear issues. But Linear doesn't pick this up unless you use their specific GitHub integration setup. It would be great if Linear's GitHub integration was truly bidirectional — automatically closing issues when a PR that references them is merged. This is table stakes for any serious development workflow.",
        author: "swe-lead-nova",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["linear", "github", "automation", "integration", "workflow"],
        points: 55,
      },
      {
        id: "hn-fallback-004",
        title: "Arc browser needs better tab search — something like Spotlight for tabs",
        body: "With 50+ tabs open, finding a specific one is painful. Arc's current tab list doesn't scale. What I'd love: a global hotkey that opens a Spotlight-style fuzzy search for tabs, where I can type a few characters of the title and jump directly. Even just a fast keyboard-navigable tab list would help. This is my #1 requested feature for Arc.",
        author: "browser-power-user",
        createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["arc", "browser", "tab-search", "feature-request", "ux"],
        points: 31,
      },
      {
        id: "hn-fallback-005",
        title: "Slack needs a proper drafts folder with DM scheduling",
        body: "I often draft messages at odd hours but don't want to send them late at night. Slack has scheduled sends for channels but not for DMs to people you haven't messaged recently. Also drafts disappear when you close the app. A proper drafts feature with scheduling for all message types and a drafts folder would be huge for async-first teams.",
        author: "remote-worker-88",
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["slack", "messaging", "scheduling", "async", "productivity"],
        points: 27,
      },
      {
        id: "hn-fallback-006",
        title: "Cursor should show a context window usage indicator like Claude Desktop does",
        body: "When using AI coding assistants, I often hit context limits mid-conversation and don't realize it until responses become degraded. Cursor doesn't show how much context is being used. Something like Claude Desktop's indicator showing token usage as you add files would help developers understand when they're approaching limits. This would improve the UX significantly.",
        author: "ai-coder-beta",
        createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["cursor", "ai", "context-window", "ux", "llm"],
        points: 33,
      },
      {
        id: "hn-fallback-007",
        title: "GitHub mobile app needs granular notification controls for PR reviews",
        body: "As an OSS maintainer who reviews many PRs on mobile, the GitHub app's notification system is all-or-nothing. I either get spammed with every comment or turn off all notifications. There's no way to say 'only notify me when my review is requested or when someone replies to my thread.' This is a critical gap for maintainers who need to stay responsive on mobile.",
        author: "oss-maintainer",
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["github", "mobile", "notifications", "pr-review", "maintainers"],
        points: 48,
      },
      {
        id: "hn-fallback-008",
        title: "Figma presentation mode needs speaker notes — Keynote has this figured out",
        body: "I do a lot of design reviews over Zoom using Figma. The presentation mode shows artboards but has no speaker notes. Keynote's presenter view shows notes on my screen while the audience sees only the slides. The current workaround is exporting to PDF which breaks interactive prototypes. A proper presenter notes feature in Figma would transform design reviews.",
        author: "ux-lead-piper",
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["figma", "presentation", "design-review", "collaboration", "zoom"],
        points: 22,
      },
      {
        id: "hn-fallback-009",
        title: "VS Code Remote SSH config should support SSH config Include directives",
        body: "I manage 40+ dev servers via SSH and use Include directives in ~/.ssh/config for common settings like identity files and port forwarding. But VS Code's Remote SSH extension doesn't read Include directives — it only sees the top-level config. This means I have to duplicate config across hosts. Supporting SSH config Includes would be a huge quality-of-life improvement for devops engineers.",
        author: "devops-architect",
        createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["vscode", "remote-ssh", "configuration", "devops", "ssh"],
        points: 35,
      },
      {
        id: "hn-fallback-010",
        title: "Obsidian on iPad needs native stylus support with handwriting-to-text",
        body: "I take meeting notes on my iPad with Apple Pencil using Obsidian. The handwriting support via community plugins is clunky — the ink looks pixelated and there's no smooth vector rendering. What I want is native stylus support where handwriting is either converted to text (like Nebo) or rendered as smooth vector ink. Notion does this well on mobile. Obsidian as a PKM tool with proper stylus support would be incredible.",
        author: "knowledge-worker-55",
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["obsidian", "mobile", "stylus", "handwriting", "ipad", "pkm"],
        points: 29,
      },
    ]

    return fallbacks.map(signal => ({
      id: signal.id,
      sourceId: "hacker-news",
      sourceName: "Hacker News (Algolia) — mock fallback",
      rawPayload: {
        title: signal.title,
        body: signal.body,
        author: signal.author,
        createdAt: signal.createdAt,
        tags: signal.tags,
        signalType: this.inferSignalType(signal.title, signal.body),
        points: signal.points,
        isFallback: true,
      },
      fetchedAt,
    }))
  }

  normalize(raw: RawSignal): NormalizedSignal {
    const tags = (raw.rawPayload.tags as string[]) ?? []
    const signalType = (raw.rawPayload as any)?.signalType ?? "feature_request"

    return {
      id: `norm-${raw.id}`,
      rawSignalId: raw.id,
      title: raw.rawPayload.title as string,
      body: raw.rawPayload.body as string,
      sourceType: "hacker-news",
      author: raw.rawPayload.author as string,
      createdAt: raw.rawPayload.createdAt as string,
      tags,
      metadata: {
        originalSourceType: raw.sourceName,
        signalType,
        url: (raw.rawPayload as any)?.url,
        points: (raw.rawPayload as any)?.points,
        numComments: (raw.rawPayload as any)?.numComments,
        isFallback: (raw.rawPayload as any)?.isFallback ?? false,
      },
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    console.log(`[HackerNewsAdapter] Disconnected`)
  }
}
