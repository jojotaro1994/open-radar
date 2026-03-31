/**
 * MockSourceAdapter - Produces deterministic mock signals for testing
 */

import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"

interface MockSignalDef {
  id: string
  sourceId: string
  sourceName: string
  title: string
  body: string
  author: string
  createdAt: string
  tags: string[]
}

const MOCK_SIGNALS: MockSignalDef[] = [
  // 2 high-relevance signals (product feedback about checkout friction)
  {
    id: "mock-confluence-001",
    sourceId: "mock",
    sourceName: "Mock Confluence",
    title: "Checkout flow is confusing users",
    body: "Multiple users have reported that the checkout process is too complicated. The cart summary is hard to find and users are abandoning checkout.",
    author: "Sarah Chen",
    createdAt: "2026-03-18T10:30:00Z",
    tags: ["product-feedback", "ux", "checkout"]
  },
  {
    id: "mock-slack-001",
    sourceId: "mock",
    sourceName: "Mock Slack",
    title: "Users dropping off at payment step",
    body: "Analytics show 40% drop-off at the payment step. Users mention credit card form is confusing with too many fields.",
    author: "Mike Rodriguez",
    createdAt: "2026-03-18T14:22:00Z",
    tags: ["analytics", "checkout", "conversion"]
  },
  // 2 medium-relevance signals (feature requests)
  {
    id: "mock-confluence-002",
    sourceId: "mock",
    sourceName: "Mock Confluence",
    title: "Request: Dark mode support",
    body: "Several customers have asked for a dark mode option for the dashboard. Would reduce eye strain during night usage.",
    author: "Alex Kim",
    createdAt: "2026-03-17T09:15:00Z",
    tags: ["feature-request", "ui", "accessibility"]
  },
  {
    id: "mock-github-001",
    sourceId: "mock",
    sourceName: "Mock GitHub",
    title: "API rate limiting is too aggressive",
    body: "Our integration keeps hitting rate limits during peak hours. Could we get higher limits for enterprise customers?",
    author: "Jordan Lee",
    createdAt: "2026-03-17T16:45:00Z",
    tags: ["feature-request", "api", "enterprise"]
  },
  // 1 low-relevance signal (random noise)
  {
    id: "mock-twitter-001",
    sourceId: "mock",
    sourceName: "Mock Twitter",
    title: "lol just saw the funniest meme",
    body: "This has nothing to do with our product but I thought it was funny.",
    author: "RandomUser123",
    createdAt: "2026-03-18T20:00:00Z",
    tags: ["noise"]
  },
  // 1 duplicate signal
  {
    id: "mock-confluence-003",
    sourceId: "mock",
    sourceName: "Mock Confluence",
    title: "Checkout flow is confusing users",
    body: "Duplicate of mock-confluence-001 - Same complaint about checkout confusion from a different team.",
    author: "Tom Wilson",
    createdAt: "2026-03-19T08:00:00Z",
    tags: ["product-feedback", "ux"]
  },
  // 1 signal with minimal metadata
  {
    id: "mock-email-001",
    sourceId: "mock",
    sourceName: "Mock Email",
    title: "Quick question",
    body: "Hi, just wanted to check if feature X is available?",
    author: "Unknown",
    createdAt: "2026-03-18T11:00:00Z",
    tags: []
  },
  // 1 signal that looks like a bug report
  {
    id: "mock-github-002",
    sourceId: "mock",
    sourceName: "Mock GitHub",
    title: "App crashes when uploading files over 10MB",
    body: "Steps to reproduce: 1. Go to upload page 2. Select file over 10MB 3. App crashes immediately. Expected: should show error message instead.",
    author: "DevTeam",
    createdAt: "2026-03-18T17:30:00Z",
    tags: ["bug", "crash", "upload"]
  }
]

export class MockSourceAdapter implements SourceAdapter {
  name = "mock"
  private connected = false

  async connect(): Promise<void> {
    this.connected = true
    console.log("[MockSourceAdapter] Connected")
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) {
      throw new Error("Adapter not connected")
    }
    const fetchedAt = new Date().toISOString()
    return MOCK_SIGNALS.map(signal => ({
      ...signal,
      rawPayload: {
        title: signal.title,
        body: signal.body,
        author: signal.author,
        createdAt: signal.createdAt,
        tags: signal.tags
      },
      fetchedAt
    }))
  }

  normalize(raw: RawSignal): NormalizedSignal {
    const idx = MOCK_SIGNALS.findIndex(s => s.id === raw.id)
    const normalizedId = idx >= 0 ? `norm-${raw.id}` : `norm-${raw.id}`
    return {
      id: normalizedId,
      rawSignalId: raw.id,
      title: raw.rawPayload.title,
      body: raw.rawPayload.body,
      sourceType: this.name,
      author: raw.rawPayload.author,
      createdAt: raw.rawPayload.createdAt,
      tags: raw.rawPayload.tags || [],
      metadata: {},
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    console.log("[MockSourceAdapter] Disconnected")
  }
}