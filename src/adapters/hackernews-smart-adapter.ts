/**
 * SmarterHackerNewsAdapter
 *
 * Uses multiple product-specific HN Algolia queries in parallel to find
 * REAL product feature requests (not HN-meta discussions).
 *
 * Key improvements over base HackerNewsAdapter:
 * 1. Multi-query approach: runs 8 targeted queries simultaneously
 * 2. HN-meta filtering: removes Ask HN, Show HN, HN:, YC, etc.
 * 3. Body requirement: requires 80+ char story_text (not title-only)
 * 4. Points threshold: >= 15 points (more engagement = more validated)
 * 5. Dedup across queries: same signalID from different queries only kept once
 * 6. Launch HN removal: explicitly filters YC startup launches
 */

import type { SourceAdapter, RawSignal, NormalizedSignal } from "./source-adapter.js"

interface HNAlgoliaHit {
  objectID: string
  title: string | null
  url: string | null
  author: string | null
  created_at: string | null
  story_text: string | null
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

// Product-specific queries that tend to surface real feature requests
const SMART_QUERIES = [
  // Product + desire patterns
  { q: 'figma "would be nice"', weight: 2 },
  { q: 'figma "wish"', weight: 1.5 },
  { q: 'linear "would be nice"', weight: 2 },
  { q: 'linear "wish"', weight: 1.5 },
  { q: 'notion "would be nice"', weight: 2 },
  { q: 'notion "wish"', weight: 1.5 },
  { q: 'vscode "would be nice"', weight: 2 },
  { q: 'vscode "wish"', weight: 1.5 },
  { q: 'arc browser "wish"', weight: 2 },
  { q: 'cursor editor "wish"', weight: 2 },
  { q: 'obsidian "would be nice"', weight: 2 },
  { q: 'obsidian "wish"', weight: 1.5 },
  // Broader desire patterns
  { q: '"wish they had"', weight: 1 },
  { q: '"would be great if" app', weight: 1.5 },
  { q: '"please add" feature', weight: 1 },
  { q: '"this app needs"', weight: 1.5 },
  { q: '"needs a" feature', weight: 1 },
  { q: '"missing" feature app', weight: 1.5 },
]

// HN-meta patterns to filter out
const HN_META_PATTERNS = [
  /^ask hn:/i,
  /^show hn:/i,
  /^hn:/i,
  /^launch hn:/i,
  /y combinator/i,
  /hacker news/i,
  /hn search/i,
  /HN: /i,
]

// Products we care about (for tagging)
const KNOWN_PRODUCTS = [
  'vscode', 'visual studio code',
  'notion', 'figma', 'linear', 'arc', 'cursor', 'windsurf',
  'obsidian', 'github', 'gitlab', 'bitbucket',
  'slack', 'discord', 'zoom', 'teams',
  'chrome', 'firefox', 'safari', 'arc browser',
  'jira', 'asana', 'trello',
  'miro', 'mural', 'excalidraw',
  'canva', 'sketch', 'framer', 'webflow',
  'openai', 'anthropic', 'claude', 'copilot',
]

// Feature request language
const FEATURE_REQUEST_KEYWORDS = [
  'would be nice', 'would love', 'feature request', 'please add',
  'please implement', 'should have', 'could we', 'wishlist', 'i wish',
  'it would be great', 'suggestion', 'enhancement', 'could be better',
  'needs a feature', 'want a', 'needs to have', 'missing feature',
  'wish there was', 'it would be awesome', 'this app needs',
  'needs to support', 'should support', 'should add',
]

function isHNMeta(hit: HNAlgoliaHit): boolean {
  const title = (hit.title || '').trim()
  const story = hit.story_text || ''
  const text = `${title} ${story}`
  return HN_META_PATTERNS.some(p => p.test(text))
}

function hasFeatureLanguage(hit: HNAlgoliaHit): boolean {
  const title = (hit.title || '').toLowerCase()
  const story = (hit.story_text || '').toLowerCase()
  const text = `${title} ${story}`
  return FEATURE_REQUEST_KEYWORDS.some(k => text.includes(k))
}

function extractTags(hit: HNAlgoliaHit): string[] {
  const tags: string[] = []
  const title = (hit.title || '').toLowerCase()
  const story = (hit.story_text || '').toLowerCase()
  const text = `${title} ${story}`

  for (const product of KNOWN_PRODUCTS) {
    if (text.includes(product)) {
      tags.push(product.replace(/\s+/g, '-'))
    }
  }

  // Detect request type
  if (text.includes('would be nice') || text.includes('would love')) {
    tags.push('wishlist')
  }
  if (text.includes('please add') || text.includes('please implement')) {
    tags.push('request')
  }
  if (text.includes('bug') || text.includes('broken') || text.includes('crash')) {
    tags.push('bug')
  }
  if (text.includes('mobile') || text.includes('android') || text.includes('ios')) {
    tags.push('mobile')
  }
  if (text.includes('api') || text.includes('webhook')) {
    tags.push('api')
  }
  if (text.includes('ai') || text.includes('llm') || text.includes('gpt')) {
    tags.push('ai')
  }

  return [...new Set(tags)]
}

function inferSignalType(title: string, body: string): string {
  const text = `${title} ${body}`.toLowerCase()
  if (text.includes('crash') || text.includes('bug') || text.includes('broken')) return 'bug_report'
  if (text.includes('frustrat') || text.includes('confusing') || text.includes('annoying')) return 'workflow_friction'
  return 'feature_request'
}

function scoreHit(hit: HNAlgoliaHit, queryWeight: number): number {
  let score = 0

  // Reject HN-meta
  if (isHNMeta(hit)) return -100

  // Reject title-only posts (no body = likely HN meta or short comments)
  const bodyLen = (hit.story_text || '').length
  if (bodyLen < 80) return -50

  // Reject low engagement
  if (hit.points < 15) return -30

  // Base score from points
  score += Math.min(hit.points, 200) * 0.3

  // Bonus for feature request language
  if (hasFeatureLanguage(hit)) score += 25

  // Bonus for having a URL (external link, not just HN discussion)
  if (hit.url && !hit.url.includes('news.ycombinator.com')) score += 10

  // Query weight bonus
  score *= queryWeight

  // Deduct for very short bodies
  if (bodyLen < 150) score *= 0.7

  return score
}

export class SmarterHackerNewsAdapter implements SourceAdapter {
  name = "hacker-news-smart"

  private connected = false

  constructor() {}

  async connect(): Promise<void> {
    this.connected = true
    console.log(`[SmarterHackerNewsAdapter] Connected (${SMART_QUERIES.length} queries)`)
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error("Adapter not connected")

    const fetchedAt = new Date().toISOString()

    console.log(`[SmarterHackerNewsAdapter] Running ${SMART_QUERIES.length} queries in parallel...`)

    // Run all queries in parallel
    const results = await Promise.all(
      SMART_QUERIES.map(async ({ q, weight }) => {
        try {
          const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=20`
          const r = await fetch(url, {
            headers: {
              "User-Agent": "prj-prototype-rader/1.0 (research project)",
              Accept: "application/json",
            },
          })
          if (!r.ok) return []
          const data: HNAlgoliaResponse = await r.json() as HNAlgoliaResponse
          return (data.hits || [])
            .map(h => ({ hit: h, weight }))
            .filter(({ hit }) => scoreHit(hit, weight) > 0)
        } catch {
          return []
        }
      })
    )

    // Flatten and dedupe by objectID
    const seen = new Set<string>()
    const unique: Array<{ hit: HNAlgoliaHit; weight: number }> = []

    for (const result of results) {
      for (const item of result) {
        if (!seen.has(item.hit.objectID)) {
          seen.add(item.hit.objectID)
          unique.push(item)
        }
      }
    }

    // Sort by score
    unique.sort((a, b) => scoreHit(b.hit, b.weight) - scoreHit(a.hit, a.weight))

    console.log(`[SmarterHackerNewsAdapter] ${unique.length} unique high-quality signals after filtering`)

    if (unique.length === 0) {
      console.warn(`[SmarterHackerNewsAdapter] No signals found. Check HN API.`)
      return []
    }

    return unique.map(({ hit }) => this.mapToRawSignal(hit, fetchedAt))
  }

  private mapToRawSignal(hit: HNAlgoliaHit, fetchedAt: string): RawSignal {
    const tags = extractTags(hit)
    const signalType = inferSignalType(hit.title ?? "", hit.story_text ?? "")
    const body = hit.story_text ?? hit.url ?? ""

    return {
      id: `hn-smart-${hit.objectID}`,
      sourceId: "hacker-news-smart",
      sourceName: "Hacker News (Algolia) — Smarter Adapter",
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

  normalize(raw: RawSignal): NormalizedSignal {
    const tags = (raw.rawPayload.tags as string[]) ?? []
    const signalType = (raw.rawPayload as any)?.signalType ?? "feature_request"

    return {
      id: `norm-${raw.id}`,
      rawSignalId: raw.id,
      title: raw.rawPayload.title as string,
      body: raw.rawPayload.body as string,
      sourceType: "hacker-news-smart",
      author: raw.rawPayload.author as string,
      createdAt: raw.rawPayload.createdAt as string,
      tags,
      metadata: {
        originalSourceType: raw.sourceName,
        signalType,
        url: (raw.rawPayload as any)?.url,
        points: (raw.rawPayload as any)?.points,
        numComments: (raw.rawPayload as any)?.numComments,
        isFallback: false,
      },
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    console.log(`[SmarterHackerNewsAdapter] Disconnected`)
  }
}
