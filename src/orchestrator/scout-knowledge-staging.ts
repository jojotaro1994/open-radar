import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import type { ScoutBrief } from "../state/scout-brief.js"
import type { StagedKnowledgeBundle, StagedKnowledgeItem } from "../state/staged-knowledge.js"
import { isAllowedScoutArtifact } from "./scout-ingestion-policy.js"

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

function now(): string {
  return new Date().toISOString()
}

function normalizeSourcePath(sourcePath: string): string {
  if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) return sourcePath
  return path.normalize(sourcePath).replace(/\\/g, "/").replace(/^\.\//, "")
}

function summarizeContent(content: string): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned.length > 220 ? `${cleaned.slice(0, 217)}...` : cleaned
}

function inferResearchDirection(sourcePath: string): string {
  const lower = sourcePath.toLowerCase()
  if (lower.includes("competitive")) return "competitive-intel"
  if (lower.includes("sales") || lower.includes("meeting")) return "sales-meeting"
  if (lower.includes("customer") || lower.includes("account")) return "customer-intel"
  if (lower.endsWith(".ts") || lower.endsWith(".js")) return "code-truth"
  return "knowledge-scout"
}

function inferDomain(sourcePath: string): string {
  const lower = sourcePath.toLowerCase()
  if (lower.includes("competitive")) return "competitive-intel"
  if (lower.includes("sales") || lower.includes("meeting")) return "sales-meeting"
  if (lower.includes("customer") || lower.includes("account")) return "customer-intel"
  if (lower.includes("overview")) return "overview"
  if (lower.includes("channel")) return "channel-domain"
  // For URLs, also check host/domain for relevant terms
  try {
    const urlLower = lower
    if (urlLower.includes("braze")) return "competitive-intel"
    if (urlLower.includes("omnichat")) return "competitive-intel"
    if (urlLower.includes("segmentation") || urlLower.includes("competitor")) return "competitive-intel"
  } catch { /* not a URL with host */ }
  return "general"
}

function inferSubdomain(sourcePath: string): string {
  const segments = sourcePath.split(/[\\/]/).filter(Boolean)
  return segments.length >= 2 ? segments[segments.length - 2]! : "root"
}

function inferPackageHint(sourcePath: string): string {
  // For URLs, use hostname + meaningful path segment as package hint
  if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) {
    try {
      const url = new URL(sourcePath)
      const segments = url.pathname.split("/").filter(Boolean)
      // Skip generic path segments
      const meaningful = segments.filter(s => !["docs", "user_guide", "engagement_tools", "segments", "www"].includes(s.toLowerCase()))
      if (meaningful.length > 0) return `${url.hostname}/${meaningful.join("/")}`
      return url.hostname
    } catch { return sourcePath }
  }
  const normalized = sourcePath.replace(/\\/g, "/")
  const marker = normalized.indexOf("riplus-knowledge-base/")
  if (marker >= 0) {
    const relative = normalized.slice(marker + "riplus-knowledge-base/".length)
    const parts = relative.split("/")
    if (parts.length > 1) return parts.slice(0, -1).join("/")
  }
  const segments = normalized.split("/").filter(Boolean)
  if (segments.length >= 2) return segments.slice(Math.max(segments.length - 2, 0)).join("/")
  return path.basename(sourcePath, path.extname(sourcePath))
}

function inferProjectionTargets(packageHint: string, domain: string): string[] {
  const lower = `${packageHint} ${domain}`.toLowerCase()
  if (lower.includes("competitive")) return ["CompetitivePack"]
  if (lower.includes("sales") || lower.includes("meeting")) return ["MeetingPacket"]
  if (lower.includes("customer")) return ["AccountIntelPack"]
  return ["DomainDossier", "CapabilitySlice"]
}

function inferSuggestedNodeKind(sourcePath: string): string {
  const lower = sourcePath.toLowerCase()
  if (lower.endsWith(".jsonl")) return "Evidence"
  if (lower.endsWith(".md")) return "KnowledgeSection"
  if (lower.endsWith(".ts") || lower.endsWith(".js")) return "SourceArtifact"
  // URLs are treated as markdown-like doc sources
  if (lower.startsWith("http://") || lower.startsWith("https://")) return "KnowledgeSection"
  return "SourceArtifact"
}

function inferFactCandidate(sourcePath: string, content: string): boolean {
  const lower = sourcePath.toLowerCase()
  if (lower.endsWith(".jsonl")) return true
  if (lower.includes("normalized-claims")) return true
  // URLs are typically substantive research docs — treat as fact candidates
  if (lower.startsWith("http://") || lower.startsWith("https://")) return true
  return summarizeContent(content).length > 80
}

function inferSourceType(sourcePath: string): string {
  if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) return "website"
  if (!fs.existsSync(sourcePath)) return "repo_path"
  const stat = fs.statSync(sourcePath)
  return stat.isDirectory() ? "local_dir" : "local_file"
}

function discoverDefaultTargets(cwd: string): string[] {
  const topLevel = fs.readdirSync(cwd, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.toLowerCase().includes("knowledge-base"))
    .map(entry => path.join(cwd, entry.name))
  return topLevel.length > 0 ? topLevel : [cwd]
}

function scanForStagedArtifacts(rootPath: string): string[] {
  // Handle URLs directly — they are "files" from scout's perspective
  if (rootPath.startsWith("http://") || rootPath.startsWith("https://")) return [rootPath]
  if (!fs.existsSync(rootPath)) return []
  const stat = fs.statSync(rootPath)
  if (stat.isFile()) return [rootPath]

  const results: string[] = []
  const entries = fs.readdirSync(rootPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name)
    if (entry.isDirectory()) {
      if (fullPath.includes("node_modules") || fullPath.includes(".git")) continue
      results.push(...scanForStagedArtifacts(fullPath))
      continue
    }
    const ext = path.extname(entry.name).toLowerCase()
    const codeLike = [".ts", ".js", ".tsx", ".jsx", ".json", ".jsonl", ".md", ".csv", ".txt"].includes(ext)
    if (!codeLike) continue
    // Always check allowlist for knowledge-base paths; competitive-intel dirs are also covered
    // Use normalized path (strips .openclaw home dir prefix) for policy checks
    const normalizedPath = normalizeSourcePath(fullPath)
    if (!isAllowedScoutArtifact(normalizedPath)) continue
    results.push(fullPath)
  }
  return results
}

export interface StageScoutKnowledgeResult {
  bundle: StagedKnowledgeBundle
  filesScanned: number
  itemsCreated: number
}

export function resolveScoutTargets(brief: ScoutBrief, cwd: string): string[] {
  const explicit = brief.sourceScope.map(value => normalizeSourcePath(value.trim())).filter(Boolean)
  return explicit.length > 0 ? explicit : discoverDefaultTargets(cwd).map(normalizeSourcePath)
}

export function stageScoutKnowledge(brief: ScoutBrief, cwd: string): StageScoutKnowledgeResult {
  const bundleId = makeId("skb")
  const createdAt = now()
  const sourceLocators = resolveScoutTargets(brief, cwd)
  const items: StagedKnowledgeItem[] = []
  let filesScanned = 0

  for (const locator of sourceLocators) {
    const paths = scanForStagedArtifacts(locator)
    for (const sourcePath of paths) {
      filesScanned += 1
      const isUrl = sourcePath.startsWith("http://") || sourcePath.startsWith("https://")
      let content = ""
      if (!isUrl) {
        try {
          content = fs.readFileSync(sourcePath, "utf-8")
        } catch {
          continue
        }
      }
      const domain = inferDomain(sourcePath)
      const packageHint = inferPackageHint(sourcePath)
      items.push({
        itemId: makeId("ski"),
        bundleId,
        title: path.basename(sourcePath),
        summary: summarizeContent(content),
        domain,
        subdomain: inferSubdomain(sourcePath),
        topicTags: Array.from(new Set([domain, inferSubdomain(sourcePath), sourcePath.startsWith("http") ? "website" : path.extname(sourcePath).replace(".", "")].filter(Boolean))),
        sourceType: inferSourceType(sourcePath),
        sourceLocator: sourcePath,
        collectedAt: createdAt,
        collector: "scout",
        lastVerifiedAt: createdAt,
        freshnessWindowDays: 30,
        freshnessStatus: "fresh",
        packageHint,
        sectionType: sourcePath.startsWith("http") ? "website" : (path.extname(sourcePath).replace(".", "") || "artifact"),
        suggestedNodeKind: inferSuggestedNodeKind(sourcePath),
        factCandidate: inferFactCandidate(sourcePath, content),
        projectionTargets: inferProjectionTargets(packageHint, domain),
        knowledgeReviewStatus: "draft",
        graphMappingStatus: "unplanned",
      })
    }
  }

  const bundle: StagedKnowledgeBundle = {
    bundleId,
    scoutRunId: makeId("sr"),
    intentProfile: brief.intentId,
    researchDirection: inferResearchDirection(sourceLocators[0] ?? cwd),
    sourceLocators,
    status: "draft",
    createdAt,
    updatedAt: createdAt,
    items,
  }

  return { bundle, filesScanned, itemsCreated: items.length }
}
