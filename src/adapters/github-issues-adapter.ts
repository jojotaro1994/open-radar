/**
 * GitHubIssuesAdapter
 *
 * Fetches open feature requests and enhancement issues from public GitHub repos.
 * Falls back to hardcoded mock data if the GitHub API fails (rate limit, etc.)
 *
 * Uses unauthenticated requests (60 req/hr limit).
 * For higher limits, set GITHUB_TOKEN env var.
 */

import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

interface GitHubIssue {
  id: number
  number: number
  title: string
  body: string | null
  user: { login: string }
  created_at: string
  labels: Array<{ name: string }>
  state: string
  pull_request?: { html_url: string }
}

const MOCK_FALLBACK_SIGNALS: Array<{
  id: string
  title: string
  body: string
  author: string
  createdAt: string
  tags: string[]
}> = [
  {
    id: "gh-vscode-001",
    title: "Add command to toggle minimap visibility",
    body: "It would be nice to have a command (with associated keybinding) to quickly toggle the minimap visibility. Currently you have to go through the menu: View > Toggle Minimap. A simple command like 'view.toggleMinimap' would be much faster.",
    author: "editor-power-user",
    createdAt: "2026-03-18T10:00:00Z",
    tags: ["feature-request", "editor", "minimap", "accessibility"]
  },
  {
    id: "gh-vscode-002",
    title: "Terminal should support bracketed paste mode",
    body: "When pasting multi-line content into the terminal, VS Code's integrated terminal doesn't handle it well. Many terminals support 'bracketed paste mode' which allows the terminal to distinguish pasted text from typed text. This would prevent escape sequences from being interpreted during paste.",
    author: "cli-developer",
    createdAt: "2026-03-17T14:30:00Z",
    tags: ["feature-request", "terminal", "paste", "usability"]
  },
  {
    id: "gh-vscode-003",
    title: "Remote SSH: support for config inheritance/includes",
    body: "When managing many remote servers via SSH, the ssh config can get very long. It would be great if VS Code's Remote SSH supported config file includes or host groups so I can define common settings once and reuse them across multiple hosts.",
    author: "devops-engineer",
    createdAt: "2026-03-16T09:15:00Z",
    tags: ["feature-request", "remote-ssh", "ssh-config", "organization"]
  },
  {
    id: "gh-vscode-004",
    title: "Notebook: native support for interactive widgets",
    body: "Jupyter widgets like ipywidgets, plotly, and bqplot don't render properly in VS Code Notebooks. They only work in the browser-based Jupyter. Would love to see VS Code Notebooks support these interactive widgets natively.",
    author: "data-scientist",
    createdAt: "2026-03-15T16:45:00Z",
    tags: ["feature-request", "notebooks", "jupyter", "widgets", "interactive"]
  },
  {
    id: "gh-vscode-005",
    title: "Diff viewer: show inline diff for collapsed regions",
    body: "When reviewing large diffs, collapsed regions show '... N lines collapsed' but don't show a summary of what changed. It would be useful to have an inline summary like '+50 lines, -20 lines' directly in the collapsed indicator.",
    author: "code-reviewer",
    createdAt: "2026-03-14T11:20:00Z",
    tags: ["feature-request", "diff-viewer", "ux", "code-review"]
  },
  {
    id: "gh-vscode-006",
    title: "Extension Host memory leak when using TreeView with large datasets",
    body: "I've built a TreeView extension that displays thousands of items. When the view is refreshed multiple times, memory usage grows and never gets released. The extension host process keeps growing until VS Code becomes unresponsive.",
    author: "extension-author",
    createdAt: "2026-03-13T08:00:00Z",
    tags: ["bug", "extension-host", "memory-leak", "treeview", "performance"]
  },
  {
    id: "gh-vscode-007",
    title: "Support for devcontainer.json as a template",
    body: "It would be great to have a 'devcontainer.json from template' option that lets you pick from a list of common dev container configurations (Node.js, Python, Go, Rust, etc.) instead of starting from scratch or copying from elsewhere.",
    author: "container-dev",
    createdAt: "2026-03-12T13:00:00Z",
    tags: ["feature-request", "devcontainers", "templates", "dx"]
  },
  {
    id: "gh-vscode-008",
    title: "Git: ability to stage individual hunks interactively",
    body: "When reviewing changes, I'd like to be able to interactively pick which hunks to stage and which to leave. The current 'Stage Hunk' command stages the entire hunk. An interactive mode where I can say 'stage this line, skip that line' would be perfect.",
    author: "git-power-user",
    createdAt: "2026-03-11T15:30:00Z",
    tags: ["feature-request", "git", "staging", "hunks", "interactive"]
  },
  {
    id: "gh-vscode-009",
    title: "Find and Replace: support for named capture groups in regex",
    body: "VS Code's find and replace doesn't support named capture groups like (?<name>pattern) in the replacement string. Only numbered groups ($1, $2) work. Named groups would make complex regex replacements much more readable and maintainable.",
    author: "regex-enthusiast",
    createdAt: "2026-03-10T10:45:00Z",
    tags: ["feature-request", "find-replace", "regex", "developer-tool"]
  },
  {
    id: "gh-vscode-010",
    title: "Settings: show unsaved changes indicator in tab and settings icon",
    body: "When there are unsaved settings changes, there's no visual indicator anywhere until you try to close VS Code. It would be helpful to have a dot indicator (like with file tabs) on the Settings editor tab and on the settings gear icon.",
    author: "settings-lover",
    createdAt: "2026-03-09T12:00:00Z",
    tags: ["feature-request", "settings", "ui", "unsaved-indicator"]
  }
]

export class GitHubIssuesAdapter implements SourceAdapter {
  name = "github-issues"

  // Configurable repo (default: microsoft/vscode)
  private owner: string
  private repo: string
  private labels: string[]
  private perPage: number

  private connected = false
  private useFallback = false

  constructor(
    owner: string = "microsoft",
    repo: string = "vscode",
    labels: string[] = ["feature-request", "enhancement"],
    perPage: number = 10
  ) {
    this.owner = owner
    this.repo = repo
    this.labels = labels
    this.perPage = perPage
  }

  async connect(): Promise<void> {
    this.connected = true
    console.log(`[GitHubIssuesAdapter] Connected to ${this.owner}/${this.repo}`)
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error("Adapter not connected")

    const fetchedAt = new Date().toISOString()

    try {
      const url = new URL(
        `https://api.github.com/repos/${this.owner}/${this.repo}/issues`
      )
      url.searchParams.set("state", "open")
      url.searchParams.set("labels", this.labels.join(","))
      url.searchParams.set("per_page", String(this.perPage))
      url.searchParams.set("sort", "created")
      url.searchParams.set("direction", "desc")

      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "prj-prototype-rader/1.0",
      }
      if (GITHUB_TOKEN) {
        headers["Authorization"] = `token ${GITHUB_TOKEN}`
      }

      console.log(`[GitHubIssuesAdapter] Fetching ${url.toString()}`)
      const response = await fetch(url.toString(), { headers })

      if (!response.ok) {
        const status = response.status
        if (status === 403) {
          console.warn(`[GitHubIssuesAdapter] Rate limited or forbidden (403). Falling back to mock data.`)
        } else if (status === 404) {
          console.warn(`[GitHubIssuesAdapter] Repo not found (404): ${this.owner}/${this.repo}. Falling back to mock data.`)
        } else {
          console.warn(`[GitHubIssuesAdapter] API error ${status}. Falling back to mock data.`)
        }
        this.useFallback = true
        return this.getFallbackSignals(fetchedAt)
      }

      const issues: GitHubIssue[] = await response.json() as GitHubIssue[]

      // Filter out pull requests (GitHub API returns PRs as issues)
      const actualIssues = issues.filter(issue => !issue.pull_request)

      console.log(`[GitHubIssuesAdapter] Fetched ${actualIssues.length} open issues (from ${issues.length} total results)`)

      // If no actual issues (e.g. rate limited, filtered out PRs, etc.), use fallback
      if (actualIssues.length === 0) {
        console.log(`[GitHubIssuesAdapter] No issues fetched. Using fallback mock data.`)
        this.useFallback = true
        return this.getFallbackSignals(fetchedAt)
      }

      return actualIssues.map(issue => this.mapToRawSignal(issue, fetchedAt))

    } catch (err) {
      console.warn(`[GitHubIssuesAdapter] Network error: ${err}. Falling back to mock data.`)
      this.useFallback = true
      return this.getFallbackSignals(fetchedAt)
    }
  }

  private getFallbackSignals(fetchedAt: string): RawSignal[] {
    return MOCK_FALLBACK_SIGNALS.map(signal => ({
      id: signal.id,
      sourceId: "github-issues",
      sourceName: `GitHub Issues (${this.owner}/${this.repo}) — mock fallback`,
      rawPayload: {
        title: signal.title,
        body: signal.body,
        author: signal.author,
        createdAt: signal.createdAt,
        tags: signal.tags,
        signalType: this.inferSignalType(signal.tags, signal.body),
      },
      fetchedAt,
    }))
  }

  private mapToRawSignal(issue: GitHubIssue, fetchedAt: string): RawSignal {
    return {
      id: `gh-${this.owner}-${this.repo}-${issue.id}`,
      sourceId: "github-issues",
      sourceName: `GitHub Issues (${this.owner}/${this.repo})`,
      rawPayload: {
        title: issue.title,
        body: issue.body ?? "",
        author: issue.user.login,
        createdAt: issue.created_at,
        tags: issue.labels.map(l => l.name),
        issueNumber: issue.number,
        signalType: this.inferSignalType(
          issue.labels.map(l => l.name),
          issue.body ?? ""
        ),
      },
      fetchedAt,
    }
  }

  /**
   * Infer signal type from labels and body content.
   * Labels take priority; body keywords are a secondary signal.
   */
  private inferSignalType(tags: string[], body: string): string {
    const tagSet = new Set(tags.map(t => t.toLowerCase()))
    const bodyLower = (body ?? "").toLowerCase()

    // Bug keywords
    if (tagSet.has("bug") || tagSet.has("defect") || tagSet.has("crash")) {
      return "bug"
    }

    // Feature request / enhancement
    if (
      tagSet.has("feature-request") ||
      tagSet.has("enhancement") ||
      tagSet.has("feature") ||
      tagSet.has("request")
    ) {
      // Check for noise in body
      const noiseWords = ["dark mode", "meme", "just curious", "quick question"]
      if (noiseWords.some(w => bodyLower.includes(w))) {
        return "noise"
      }
      return "feature_request"
    }

    // Workflow friction
    if (
      tagSet.has("workflow") ||
      tagSet.has("usability") ||
      tagSet.has("ux") ||
      bodyLower.includes("confusing") ||
      bodyLower.includes("frustrat")
    ) {
      return "workflow_friction"
    }

    // Default to feature_request for open enhancement requests
    if (tagSet.has("open")) {
      return "feature_request"
    }

    return "feature_request"  // default assumption for GitHub issues
  }

  normalize(raw: RawSignal): NormalizedSignal {
    const tags = (raw.rawPayload.tags as string[]) ?? []
    const signalType = (raw.rawPayload as any)?.signalType ?? "feature_request"

    return {
      id: `norm-${raw.id}`,
      rawSignalId: raw.id,
      title: raw.rawPayload.title as string,
      body: raw.rawPayload.body as string,
      sourceType: "github-issues",
      author: raw.rawPayload.author as string,
      createdAt: raw.rawPayload.createdAt as string,
      tags,
      metadata: {
        originalSourceType: raw.sourceName,
        signalType,
        issueNumber: (raw.rawPayload as any)?.issueNumber,
      },
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    console.log(`[GitHubIssuesAdapter] Disconnected`)
  }
}
