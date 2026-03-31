/**
 * RedditAdapter
 *
 * Fetches public posts from Reddit via the public JSON API (no auth required).
 * Filters for posts containing feature request language and software/app mentions.
 *
 * Reddit JSON endpoint: https://www.reddit.com/r/{subreddit}/{sort}.json
 * Rate limit: ~10 requests/minute per IP ( Reddit is generous for public reads)
 *
 * Maps: title->title, selftext->body, author.name->author, created_utc->createdAt
 */

import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"

interface RedditPost {
  id: string
  name: string
  title: string
  selftext: string
  author: string
  created_utc: number
  subreddit: string
  permalink: string
  score: number
  num_comments: number
  link_flair_text: string | null
  is_self: boolean
  is_video: boolean
  removed_by_category: string | null
}

interface RedditListing {
  data: {
    children: Array<{
      data: RedditPost
    }>
    after: string | null
  }
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

function isFeatureRequest(post: RedditPost): boolean {
  const titleLower = post.title.toLowerCase()
  const bodyLower = post.selftext.toLowerCase()
  const text = `${titleLower} ${bodyLower}`

  // Must mention software/app related keywords
  const mentionsSoftware = SOFTWARE_APP_KEYWORDS.some(kw => text.includes(kw))
  if (!mentionsSoftware) return false

  // Must have feature request language
  const hasFeatureLanguage = FEATURE_REQUEST_KEYWORDS.some(kw => text.includes(kw))
  if (hasFeatureLanguage) return true

  // Fallback: check if post is primarily about a specific software product
  // and mentions "would" or "should" in a constructive context
  if (
    (text.includes("would") || text.includes("should") || text.includes("could")) &&
    bodyLower.length > 100
  ) {
    return true
  }

  return false
}

export class RedditAdapter implements SourceAdapter {
  name = "reddit"

  private subreddit: string
  private sort: "hot" | "new" | "top"
  private limit: number
  private connected = false
  private useFallback = false

  constructor(
    subreddit: string = "technology",
    sort: "hot" | "new" | "top" = "hot",
    limit: number = 50
  ) {
    this.subreddit = subreddit
    this.sort = sort
    this.limit = Math.min(limit, 100) // Reddit max is 100
  }

  async connect(): Promise<void> {
    this.connected = true
    console.log(`[RedditAdapter] Connected to r/${this.subreddit} (${this.sort})`)
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error("Adapter not connected")

    const fetchedAt = new Date().toISOString()

    try {
      const url = `https://www.reddit.com/r/${this.subreddit}/${this.sort}.json?limit=${this.limit}`
      console.log(`[RedditAdapter] Fetching ${url}`)

      const response = await fetch(url, {
        headers: {
          "User-Agent": "prj-prototype-rader/1.0 (prototype radar research project)",
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        console.warn(`[RedditAdapter] HTTP ${response.status}. Falling back to mock signals.`)
        this.useFallback = true
        return this.getFallbackSignals(fetchedAt)
      }

      const listing: RedditListing = (await response.json()) as RedditListing
      const posts = listing.data.children.map(c => c.data)

      console.log(`[RedditAdapter] Fetched ${posts.length} posts`)

      // Filter for feature requests
      const featureRequests = posts.filter(p => !p.is_video && !p.removed_by_category && isFeatureRequest(p))
      console.log(`[RedditAdapter] Filtered to ${featureRequests.length} feature requests`)

      if (featureRequests.length === 0) {
        console.log(`[RedditAdapter] No feature requests found. Using fallback mock signals.`)
        this.useFallback = true
        return this.getFallbackSignals(fetchedAt)
      }

      return featureRequests.map(post => this.mapToRawSignal(post, fetchedAt))

    } catch (err) {
      console.warn(`[RedditAdapter] Network error: ${err}. Falling back to mock signals.`)
      this.useFallback = true
      return this.getFallbackSignals(fetchedAt)
    }
  }

  private mapToRawSignal(post: RedditPost, fetchedAt: string): RawSignal {
    const tags = this.extractTags(post)
    const signalType = this.inferSignalType(post.title, post.selftext)

    return {
      id: `reddit-${post.id}`,
      sourceId: "reddit",
      sourceName: `Reddit r/${this.subreddit}`,
      rawPayload: {
        title: post.title,
        body: post.selftext,
        author: post.author,
        createdAt: new Date(post.created_utc * 1000).toISOString(),
        tags,
        signalType,
        subreddit: post.subreddit,
        permalink: post.permalink,
        score: post.score,
        numComments: post.num_comments,
        flair: post.link_flair_text,
      },
      fetchedAt,
    }
  }

  private extractTags(post: RedditPost): string[] {
    const tags: string[] = []
    const text = `${post.title} ${post.selftext}`.toLowerCase()

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
      ["gitHub", "github"],
      ["gitlab", "gitlab"],
      ["jira", "jira software"],
      ["slack", "slack app"],
      ["discord", "discord app"],
      ["zoom", "zoom app"],
      ["teams", "microsoft teams"],
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
    }> = [
      {
        id: "reddit-fallback-001",
        title: "Would love to see Notion integrate with Figma like Miro does",
        body: "Miro has this great Figma integration where you can just paste a Figma frame and it embeds as a live link. Notion only lets you attach static images. Would be amazing to have that in Notion too — especially for design docs and meeting notes where the design is changing frequently.",
        author: "product-designer-42",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["notion", "figma", "integration", "wishlist", "design"],
      },
      {
        id: "reddit-fallback-002",
        title: "Cursor should have a built-in terminal profiler like VS Code's but better",
        body: "I use the terminal constantly for git, npm, build scripts. VS Code's terminal is okay but lacks profiling — I can't see which command is slow without external tools. It would be great if Cursor (or VS Code) had a built-in terminal profiler that shows execution time per command in a sidebar. kind of like how Chrome DevTools shows network timing.",
        author: "devops-shad",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["cursor", "terminal", "profiling", "feature-request", "dx"],
      },
      {
        id: "reddit-fallback-003",
        title: "Linear's GitHub integration could auto-close issues with PR merge",
        body: "When I merge a PR that closes an issue, Linear doesn't pick it up automatically. I have to manually close issues. It would be nice if the GitHub integration was bidirectional — merge a PR with 'Fixes #123' and Linear auto-closes issue 123. Many teams have this workflow and it's a big time sink.",
        author: "swe-lead-mike",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["linear", "github", "automation", "integration", "workflow"],
      },
      {
        id: "reddit-fallback-004",
        title: "Arc browser needs tab search that's as fast as Spotlight",
        body: "I've been using Arc for 6 months and the one thing holding me back is tab search. When I have 50+ tabs open, finding a specific tab is slow. I'd love something like Spotlight-style search — press a hotkey, type a few chars of the tab title, boom. The current tab list is not usable at scale.",
        author: "browser-power-user",
        createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["arc", "browser", "tab-search", "feature-request", "ux"],
      },
      {
        id: "reddit-fallback-005",
        title: "Slack should let you schedule message drafts for later",
        body: "I often think of messages at weird hours but don't want to send them late at night. Slack has scheduled sends for channels you're actively in, but not for DMs you haven't opened yet. Also, there's no draft folder — if you close the app, your draft disappears. Please add a proper drafts feature with scheduling for DMs too!",
        author: "remote-worker-99",
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["slack", "messaging", "scheduling", "feature-request", "productivity"],
      },
      {
        id: "reddit-fallback-006",
        title: "Obsidian mobile needs a better handwriting mode for stylus",
        body: "I use Obsidian for meeting notes on my iPad with Apple Pencil. The current handwriting support via a plugin is clunky. What I want: native stylus support where my handwriting is recognized and converted to text, or at least smooth vector ink that doesn't look pixelated. Something like Notion's mobile app but for a PKM tool.",
        author: "knowledge-worker-77",
        createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["obsidian", "mobile", "handwriting", "stylus", "feature-request"],
      },
      {
        id: "reddit-fallback-007",
        title: "VS Code Remote SSH config inheritance would save me hours every week",
        body: "I manage 40+ dev servers via SSH. Each one has similar config: same identity file path, same local port forwarding rules, same remote port for debugging. In ~/.ssh/config I can use Include directives but VS Code's Remote SSH extension doesn't pick those up. It would be great if VS Code supported SSH config includes or host groups so I define common settings once.",
        author: "devops-architect",
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["vscode", "remote-ssh", "configuration", "devops", "feature-request"],
      },
      {
        id: "reddit-fallback-008",
        title: "Windsurf should show AI context window usage like Cursor does",
        body: "Cursor shows a little indicator of how much context window is being used as you add files to a chat. Windsurf doesn't have this — I often hit context limits mid-conversation and get degraded responses. Please add a context usage indicator!",
        author: "ai-coder-prime",
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["windsurf", "ai", "context-window", "ux", "feature-request"],
      },
      {
        id: "reddit-fallback-009",
        title: "GitHub mobile app needs better PR review notifications",
        body: "I review a lot of PRs on my phone using the GitHub mobile app. The notification system is all-or-nothing — I either get notified about every comment or silence everything. There's no way to say 'notify me only when my review is requested or when someone replies to my comment thread.' This is a huge gap for maintainers.",
        author: "oss-maintainer",
        createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["github", "mobile", "notifications", "pr-review", "feature-request"],
      },
      {
        id: "reddit-fallback-010",
        title: "Figma needs a presentation mode with speaker notes per artboard",
        body: "I do design reviews over Zoom and Figma's presentation mode is barebones — just the artboards with no speaker notes. I'd love something like Keynote's presenter view where I can see my notes on one screen and the audience sees only the artboards. The current workaround is exporting to PDF which breaks the interactive prototypes.",
        author: "ux-lead-nova",
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        tags: ["figma", "presentation", "design-review", "feature-request", "collaboration"],
      },
    ]

    return fallbacks.map(signal => ({
      id: signal.id,
      sourceId: "reddit",
      sourceName: `Reddit r/${this.subreddit} — mock fallback`,
      rawPayload: {
        title: signal.title,
        body: signal.body,
        author: signal.author,
        createdAt: signal.createdAt,
        tags: signal.tags,
        signalType: this.inferSignalType(signal.title, signal.body),
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
      sourceType: "reddit",
      author: raw.rawPayload.author as string,
      createdAt: raw.rawPayload.createdAt as string,
      tags,
      metadata: {
        originalSourceType: raw.sourceName,
        signalType,
        subreddit: (raw.rawPayload as any)?.subreddit,
        permalink: (raw.rawPayload as any)?.permalink,
        score: (raw.rawPayload as any)?.score,
        numComments: (raw.rawPayload as any)?.numComments,
        flair: (raw.rawPayload as any)?.flair,
        isFallback: (raw.rawPayload as any)?.isFallback ?? false,
      },
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    console.log(`[RedditAdapter] Disconnected`)
  }
}
