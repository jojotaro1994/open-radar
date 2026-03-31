/**
 * scout-graph-ingestion.ts
 *
 * Scout graph ingestion engine.
 *
 * Scout is the canonical write path into the Memgraph knowledge runtime.
 * Scout reads source targets and produces:
 *   ScoutTarget → SourceArtifact → KnowledgeSection → Evidence → ReferenceFact
 *   → KnowledgePackage → Projection
 *
 * Scout stops before:
 *   - Finding
 *   - DecisionObject
 *   - MeetingRecord
 *
 * This keeps Scout focused on knowledge maintenance rather than governance.
 */

import * as path from "path"
import * as fs from "fs"
import * as crypto from "crypto"
import * as https from "https"
import * as http from "http"
import { tmpdir } from "os"
import {
  saveScoutTarget,
  saveKnowledgePackage,
  findKnowledgePackageByPath,
  saveSourceArtifact,
  saveKnowledgeSection,
  saveEvidence,
  saveReferenceFact,
  saveProjection,
  saveScoutRun,
  linkProducer,
  linkContains,
  linkHasSection,
  linkSupports,
  linkDerives,
  linkDerivedFrom,
  linkIncludesFact,
  linkTouched,
  linkTouchedPackage,
  findArtifactsByHash,
  findArtifactByPathOrUrl,
  findSectionsByArtifact,
  findEvidenceBySection,
  findFactsByEvidence,
  findProjectionByKey,
} from "../state/graph/repositories.js"
import { isAllowedScoutArtifact } from "./scout-ingestion-policy.js"
import type {
  ScoutTarget,
  KnowledgePackage,
  SourceArtifact,
  KnowledgeSection,
  Evidence,
  ReferenceFact,
  Projection,
  ScoutRun,
  TargetKind,
  PackageKind,
  ArtifactKind,
  ProjectionKind,
  FreshnessStatus,
} from "../state/graph/types.js"

// ─── ID generation ────────────────────────────────────────────────────────────

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function now(): string {
  return new Date().toISOString()
}

function normalizeSourcePath(sourcePath: string): string {
  if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) return sourcePath
  return path.normalize(sourcePath).replace(/\\/g, "/").replace(/^\.\//, "")
}

function derivePackagePath(sourcePath: string, targetKind: TargetKind): string {
  // Strip the riplus-knowledge-base directory and everything before it.
  // This handles both /riplus-knowledge-base/ and riplus-knowledge-base patterns.
  const segments = sourcePath.split(/[\\/]/).filter(Boolean)
  const idx = segments.findIndex(s => s === "riplus-knowledge-base")
  if (idx >= 0) {
    // Take segments after riplus-knowledge-base
    const after = segments.slice(idx + 1)
    if (after.length === 0) return "default"
    if (targetKind === "local_dir") return after.join("/")
    // For files, take parent directory
    return after.slice(0, -1).join("/") || "default"
  }
  // No riplus-knowledge-base; use the last two segments as fallback
  if (targetKind === "local_dir") return segments.slice(-1).join("/") || "default"
  return segments.slice(-2, -1).join("/") || "default"
}

// ─── Content hashing ─────────────────────────────────────────────────────────

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)
}

// ─── ScoutTarget ─────────────────────────────────────────────────────────────

function inferTargetKind(sourcePath: string): TargetKind {
  if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) {
    return "website"
  }
  if (fs.existsSync(sourcePath)) {
    const stat = fs.statSync(sourcePath)
    if (stat.isDirectory()) return "local_dir"
    return "local_file"
  }
  return "repo_path"
}

async function createScoutTarget(
  locator: string,
  title: string,
  targetKind?: TargetKind
): Promise<ScoutTarget> {
  const node: ScoutTarget = {
    id: makeId("sct"),
    target_kind: targetKind ?? inferTargetKind(locator),
    locator,
    title,
    created_at: now(),
    updated_at: now(),
  }
  await saveScoutTarget(node)
  return node
}

// ─── KnowledgePackage ────────────────────────────────────────────────────────

function inferPackageKind(sourcePath: string, researchDirection?: string): PackageKind {
  // Priority 1: explicit research direction from staged metadata
  if (researchDirection) {
    const rd = researchDirection.toLowerCase()
    if (rd.includes("competitive")) return "competitive_intel"
    if (rd.includes("customer")) return "customer_intel"
    if (rd.includes("sales") || rd.includes("meeting")) return "sales_meeting"
    if (rd.includes("overview")) return "overview"
  }
  // Priority 2: path heuristic (fallback)
  // Note: "customer-intel" contains "intel" so we must check customer BEFORE intel
  const lower = sourcePath.toLowerCase()
  if (lower.includes("customer") || lower.includes("account")) return "customer_intel"
  if (lower.includes("competitive") || lower.includes("intel")) return "competitive_intel"
  if (lower.includes("sales") || lower.includes("meeting")) return "sales_meeting"
  if (lower.includes("overview")) return "overview"
  return "domain"
}

async function getOrCreateKnowledgePackage(
  packagePath: string,
  title: string,
  researchDirectionOverride?: string
): Promise<KnowledgePackage> {
  const existing = await findKnowledgePackageByPath(packagePath)
  if (existing) return existing

  const node: KnowledgePackage = {
    id: makeId("pkg"),
    package_path: packagePath,
    package_kind: inferPackageKind(packagePath, researchDirectionOverride),
    title,
    created_at: now(),
    updated_at: now(),
    last_verified_at: now(),
    freshness_window_days: 30,
    freshness_status: "fresh",
    confidence: 0.8,
  }
  await saveKnowledgePackage(node)
  return node
}

// ─── SourceArtifact ───────────────────────────────────────────────────────────

function inferArtifactKind(filePath: string): ArtifactKind {
  if (filePath.startsWith("http://") || filePath.startsWith("https://")) return "external_url"
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".md") return "markdown_doc"
  if (ext === ".json" || ext === ".jsonl") return "jsonl_doc"
  if (ext === ".csv") return "csv_doc"
  if (ext === ".pptx") return "pptx_doc"
  if (ext === ".xlsx") return "xlsx_doc"
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") return "image_asset"
  if (ext === ".ts" || ext === ".js" || ext === ".py") return "code_repo_path"
  return "markdown_doc"
}

async function createSourceArtifact(
  filePath: string,
  content: string,
  title: string,
  canonicalUrl?: string
): Promise<SourceArtifact> {
  // For website sources, canonicalUrl (the original URL) is the true identity.
  // The cached filePath is only an implementation detail.
  const artifactPathOrUrl = canonicalUrl ?? filePath
  const node: SourceArtifact = {
    id: makeId("art"),
    artifact_kind: inferArtifactKind(artifactPathOrUrl),
    artifact_path_or_url: artifactPathOrUrl,
    content_hash: contentHash(content),
    title,
    created_at: now(),
    updated_at: now(),
    last_verified_at: now(),
    freshness_status: "fresh",
  }
  await saveSourceArtifact(node)
  return node
}

// ─── KnowledgeSection ────────────────────────────────────────────────────────

function chunkMarkdown(content: string, artifactId: string): KnowledgeSection[] {
  const sections: KnowledgeSection[] = []
  const lines = content.split("\n")
  let currentHeading = "Document start"
  let currentKey = `${artifactId}:0`
  let sectionOrder = 0
  let buffer: string[] = []

  function flushSection() {
    if (buffer.length === 0) return
    const body = buffer.join("\n").trim()
    if (body.length < 20) { buffer = []; return }
    const summary = body.slice(0, 120).replace(/[#*`]/g, "").trim()
    sections.push({
      id: makeId("sec"),
      section_key: currentKey,
      heading: currentHeading,
      section_order: sectionOrder++,
      body_summary: summary + (body.length > 120 ? "…" : ""),
      created_at: now(),
      updated_at: now(),
      last_verified_at: now(),
      freshness_status: "fresh",
    })
    buffer = []
  }

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/)
    const h3Match = line.match(/^### (.+)/)
    if (h2Match || h3Match) {
      flushSection()
      currentHeading = h2Match ? h2Match[1] : h3Match![1]
      currentKey = `${artifactId}:${sectionOrder}`
    } else {
      buffer.push(line)
    }
  }
  flushSection()
  return sections
}

async function createSections(
  artifactId: string,
  content: string,
): Promise<KnowledgeSection[]> {
  const sections = chunkMarkdown(content, artifactId)
  for (const section of sections) {
    await saveKnowledgeSection(section)
    await linkHasSection(artifactId, section.id)
  }
  return sections
}

// ─── Evidence ────────────────────────────────────────────────────────────────

interface ExtractedEvidence {
  statement: string
  evidence_type: string
  source_locator: string
}

function extractEvidenceFromSection(section: KnowledgeSection, artifactPath: string): ExtractedEvidence[] {
  const evidence: ExtractedEvidence[] = []
  const body = section.body_summary

  // Extract bullet points as individual evidence items
  const lines = body.split("\n").filter(l => l.trim().startsWith("- ") || l.trim().startsWith("* "))
  for (const line of lines) {
    const statement = line.replace(/^[\-\*]\s+/, "").trim()
    if (statement.length > 10) {
      evidence.push({
        statement,
        evidence_type: "bullet_point",
        source_locator: `${artifactPath}#${section.section_key}`,
      })
    }
  }

  // If no bullets found, treat the whole section summary as one evidence item
  if (evidence.length === 0 && body.length > 20) {
    evidence.push({
      statement: body,
      evidence_type: "section_summary",
      source_locator: `${artifactPath}#${section.section_key}`,
    })
  }

  return evidence
}

async function createEvidence(
  section: KnowledgeSection,
  artifactPath: string
): Promise<Evidence[]> {
  const extracted = extractEvidenceFromSection(section, artifactPath)
  const results: Evidence[] = []

  for (const ex of extracted) {
    const node: Evidence = {
      id: makeId("ev"),
      evidence_type: ex.evidence_type,
      statement: ex.statement,
      source_locator: ex.source_locator,
      created_at: now(),
      updated_at: now(),
      last_verified_at: now(),
      freshness_status: "fresh",
      confidence: 0.7,
    }
    await saveEvidence(node)
    await linkSupports(section.id, node.id)
    results.push(node)
  }

  return results
}

// ─── ReferenceFact promotion ─────────────────────────────────────────────────

function shouldPromoteToFact(evidence: Evidence): boolean {
  // Only promote evidence that represents a stable, reusable truth
  // Reject: opinions, temporal statements, vague claims
  const lower = evidence.statement.toLowerCase()
  if (lower.includes("might") || lower.includes("maybe") || lower.includes("possibly")) return false
  if (lower.includes("we think") || lower.includes("in our view")) return false
  if (lower.includes("as of") || lower.includes("currently")) return false
  if (evidence.statement.length < 15 || evidence.statement.length > 500) return false
  return true
}

async function promoteToReferenceFact(evidence: Evidence): Promise<ReferenceFact | null> {
  if (!shouldPromoteToFact(evidence)) return null

  const node: ReferenceFact = {
    id: makeId("fact"),
    fact_type: evidence.evidence_type,
    statement: evidence.statement,
    canonical_scope: evidence.source_locator.split("#")[0] ?? evidence.source_locator,
    created_at: now(),
    updated_at: now(),
    last_verified_at: now(),
    freshness_window_days: 90,
    freshness_status: "fresh",
    confidence: evidence.confidence * 0.9,
  }
  await saveReferenceFact(node)
  await linkDerives(evidence.id, node.id)
  return node
}

// ─── Projection refresh ─────────────────────────────────────────────────────

async function collectFactsForArtifact(artifactId: string): Promise<ReferenceFact[]> {
  const sections = await findSectionsByArtifact(artifactId)
  const factsById = new Map<string, ReferenceFact>()
  for (const section of sections) {
    const evidenceList = await findEvidenceBySection(section.id)
    for (const evidence of evidenceList) {
      const facts = await findFactsByEvidence(evidence.id)
      for (const fact of facts) factsById.set(fact.id, fact)
    }
  }
  return Array.from(factsById.values())
}

async function refreshProjections(
  pkg: KnowledgePackage,
  facts: ReferenceFact[],
): Promise<Projection[]> {
  const projections: Projection[] = []

  const kinds: ProjectionKind[] =
    pkg.package_kind === "customer_intel"
      ? ["AccountIntelPack", "MeetingPacket"]
      : pkg.package_kind === "competitive_intel"
      ? ["CompetitivePack", "MeetingPacket"]
      : pkg.package_kind === "sales_meeting"
      ? ["MeetingPacket"]
      : pkg.package_kind === "domain"
      ? ["DomainDossier", "CapabilitySlice"]
      : pkg.package_kind === "overview"
      ? ["DomainDossier"]
      : ["DomainDossier"]

  for (const kind of kinds) {
    const key = `${pkg.package_path}:${kind}`
    const existing = await findProjectionByKey(key)

    const projection: Projection = {
      id: existing?.id ?? makeId("proj"),
      projection_kind: kind,
      projection_key: key,
      title: buildProjectionTitle(kind, pkg.package_path),
      summary: buildProjectionSummary(kind, facts),
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
      last_verified_at: now(),
      freshness_status: "fresh",
    }
    await saveProjection(projection)
    await linkDerivedFrom(projection.id, pkg.id)

    // Link the most relevant facts for this projection kind
    const linkedFacts = selectFactsForProjection(kind, facts)
    for (const fact of linkedFacts.slice(0, 20)) {
      await linkIncludesFact(projection.id, fact.id)
    }

    projections.push(projection)
  }

  return projections
}

/**
 * Build a human-readable title for a projection.
 */
function buildProjectionTitle(kind: ProjectionKind, packagePath: string): string {
  const name = packagePath.split("/").pop() ?? packagePath
  switch (kind) {
    case "DomainDossier": return `Domain overview: ${name}`
    case "CapabilitySlice": return `Capability truth: ${name}`
    case "CompetitivePack": return `Competitive analysis: ${name}`
    case "AccountIntelPack": return `Account intelligence: ${name}`
    case "MeetingPacket": return `Meeting brief: ${name}`
    default: return `${kind} for ${packagePath}`
  }
}

/**
 * Build a kind-specific summary for a projection.
 * Each projection kind uses different selection and framing logic.
 */
function buildProjectionSummary(kind: ProjectionKind, facts: ReferenceFact[]): string {
  if (facts.length === 0) return "No facts available for this projection."

  switch (kind) {
    case "DomainDossier": {
      // Broad overview: mix of fact types, lead with overview-friendly ones
      const overview = facts
        .filter(f => f.fact_type === "product_truth" || f.fact_type === "terminology")
        .slice(0, 4)
      const rest = facts.filter(f => !overview.includes(f)).slice(0, 3)
      const selected = [...overview, ...rest]
      return selected.map(f => f.statement).join(" | ")
    }

    case "CapabilitySlice": {
      // Narrow capability truth: emphasize boundaries and constraints
      const boundaries = facts.filter(f => f.fact_type === "capability_boundary" || f.fact_type === "known_limitation")
      const constraints = facts.filter(f => f.fact_type === "pricing_packaging_constraint")
      const rest = facts.filter(f => !boundaries.includes(f) && !constraints.includes(f))
      const selected = [...boundaries.slice(0, 3), ...constraints.slice(0, 2), ...rest.slice(0, 3)]
      if (selected.length === 0) return facts.slice(0, 4).map(f => f.statement).join(" | ")
      return selected.map(f => `[${f.fact_type}] ${f.statement}`).join(" | ")
    }

    case "CompetitivePack": {
      // Competitor claims: confirmed high-confidence facts first
      const confirmed = facts
        .filter(f => f.confidence >= 0.7)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
      const uncertain = facts.filter(f => f.confidence < 0.7 && !confirmed.includes(f)).slice(0, 3)
      const selected = [...confirmed, ...uncertain]
      return selected.map(f => f.confidence >= 0.7 ? f.statement : `[uncertain] ${f.statement}`).join(" | ")
    }

    case "AccountIntelPack": {
      // Account patterns: usage signals, risks, upsell themes
      const usage = facts.filter(f => f.canonical_scope?.includes("usage") || f.statement.toLowerCase().includes("adoption"))
      const risk = facts.filter(f => f.statement.toLowerCase().includes("risk") || f.statement.toLowerCase().includes("churn"))
      const upsell = facts.filter(f => f.statement.toLowerCase().includes("upsell") || f.statement.toLowerCase().includes("expansion"))
      const rest = facts.filter(f => !usage.includes(f) && !risk.includes(f) && !upsell.includes(f))
      const selected = [...usage.slice(0, 3), ...upsell.slice(0, 2), ...risk.slice(0, 2), ...rest.slice(0, 2)]
      if (selected.length === 0) return facts.slice(0, 4).map(f => f.statement).join(" | ")
      return selected.map(f => f.statement).join(" | ")
    }

    case "MeetingPacket": {
      // Meeting-ready: highlights, gaps, next actions
      const highConf = facts.filter(f => f.confidence >= 0.6).slice(0, 4)
      const gaps = facts.filter(f => f.statement.toLowerCase().includes("open") || f.statement.toLowerCase().includes("unknown") || f.statement.toLowerCase().includes("gap"))
      const rest = facts.filter(f => !highConf.includes(f) && !gaps.includes(f)).slice(0, 3)
      const selected = [...highConf, ...gaps.slice(0, 2), ...rest]
      return selected.map(f => f.statement).join(" | ")
    }

    default:
      return facts.slice(0, 5).map(f => f.statement).join(" | ")
  }
}

/**
 * Select facts in an order suitable for the projection kind.
 * The top N are linked to the projection; ordering reflects priority.
 */
function selectFactsForProjection(kind: ProjectionKind, facts: ReferenceFact[]): ReferenceFact[] {
  switch (kind) {
    case "DomainDossier":
      // Mix of all types, prefer product_truth and terminology first
      return [
        ...facts.filter(f => f.fact_type === "product_truth"),
        ...facts.filter(f => f.fact_type === "terminology"),
        ...facts.filter(f => f.fact_type === "capability_boundary"),
        ...facts.filter(f => f.fact_type === "known_limitation"),
        ...facts.filter(f => f.fact_type === "pricing_packaging_constraint"),
      ]

    case "CapabilitySlice":
      // Lead with boundaries and constraints
      return [
        ...facts.filter(f => f.fact_type === "capability_boundary"),
        ...facts.filter(f => f.fact_type === "known_limitation"),
        ...facts.filter(f => f.fact_type === "pricing_packaging_constraint"),
        ...facts.filter(f => f.fact_type === "product_truth"),
        ...facts.filter(f => f.fact_type === "terminology"),
      ]

    case "CompetitivePack":
      // High-confidence confirmed claims first
      return [...facts].sort((a, b) => b.confidence - a.confidence)

    case "AccountIntelPack":
      // Signals, usage, risk patterns first
      return [
        ...facts.filter(f => f.statement.toLowerCase().includes("usage") || f.statement.toLowerCase().includes("adoption")),
        ...facts.filter(f => f.statement.toLowerCase().includes("upsell") || f.statement.toLowerCase().includes("expansion")),
        ...facts.filter(f => f.statement.toLowerCase().includes("risk") || f.statement.toLowerCase().includes("churn")),
        ...facts.filter(f => f.confidence >= 0.7),
        ...facts,
      ].filter((v, i, a) => a.indexOf(v) === i) // dedup

    case "MeetingPacket":
      // High-confidence and gap-exposing facts first
      return [
        ...facts.filter(f => f.confidence >= 0.6),
        ...facts.filter(f => f.statement.toLowerCase().includes("open") || f.statement.toLowerCase().includes("gap")),
        ...facts,
      ].filter((v, i, a) => a.indexOf(v) === i) // dedup

    default:
      return facts
  }
}

// ─── URL fetching ─────────────────────────────────────────────────────────────

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http
    const req = protocol.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject)
        return
      }
      if (status !== 200) {
        reject(new Error(`HTTP ${status} for ${url}`))
        return
      }
      let data = ""
      res.on("data", chunk => data += chunk)
      res.on("end", () => resolve(data))
    })
    req.on("error", reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)) })
  })
}

function cacheWebsiteContent(url: string, content: string): string {
  const cacheDir = path.join(tmpdir(), "radar-scout-cache")
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16)
  const ext = url.endsWith(".md") ? ".md" : url.endsWith(".json") ? ".json" : url.endsWith(".html") ? ".html" : ".txt"
  const cachePath = path.join(cacheDir, `${hash}${ext}`)
  fs.writeFileSync(cachePath, content, "utf-8")
  return cachePath
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim()
}



async function scanDirectory(dirPath: string): Promise<string[]> {
  const files: string[] = []
  if (!fs.existsSync(dirPath)) return files

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await scanDirectory(fullPath)))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if ([".md", ".txt", ".json", ".jsonl", ".csv"].includes(ext)) {
        if (isAllowedScoutArtifact(fullPath)) {
          files.push(fullPath)
        }
      }
    }
  }
  return files
}

// ─── Main ingestion function ─────────────────────────────────────────────────

export interface ScoutIngestResult {
  runId: string
  targetId: string
  packageId: string
  artifactsCreated: number
  sectionsCreated: number
  evidenceExtracted: number
  factsPromoted: number
  projectionsRefreshed: number
  errors: string[]
}

export async function scoutIngest(
  sourcePath: string,
  title?: string,
  packageHintOverride?: string,
  researchDirectionOverride?: string
): Promise<ScoutIngestResult> {
  const errors: string[] = []
  const runId = makeId("run")
  const startedAt = now()

  // Create ScoutRun first
  const run: ScoutRun = {
    run_id: runId,
    mode: "ingest",
    status: "running",
    started_at: startedAt,
  }
  await saveScoutRun(run)

  const normalizedSourcePath = normalizeSourcePath(sourcePath)

  // Determine the actual source to ingest
  let sourcePaths: string[] = []
  let targetTitle = title ?? path.basename(normalizedSourcePath)
  const targetKind = inferTargetKind(normalizedSourcePath)
  // For website sources, the original URL is the canonical identity on the graph.
  // The cached file path is an implementation detail only.
  let canonicalUrl: string | undefined

  if (targetKind === "local_dir") {
    sourcePaths = await scanDirectory(normalizedSourcePath)
    if (sourcePaths.length === 0) {
      errors.push(`No readable files found in ${normalizedSourcePath}`)
    }
  } else if (targetKind === "local_file") {
    sourcePaths = [normalizedSourcePath]
  } else if (targetKind === "website") {
    // Fetch URL, cache locally, and process as local_file.
    // canonicalUrl preserves the original URL as graph identity.
    try {
      const rawContent = await fetchUrl(normalizedSourcePath)
      const textContent = rawContent.trim().startsWith("<") ? extractTextFromHtml(rawContent) : rawContent
      const cachedPath = cacheWebsiteContent(normalizedSourcePath, textContent)
      sourcePaths = [cachedPath]
      canonicalUrl = normalizedSourcePath
    } catch (fetchErr) {
      errors.push(`Failed to fetch website ${normalizedSourcePath}: ${fetchErr}`)
      return { runId, targetId: "", packageId: "", artifactsCreated: 0, sectionsCreated: 0, evidenceExtracted: 0, factsPromoted: 0, projectionsRefreshed: 0, errors }
    }
  } else {
    errors.push(`Unsupported target kind: ${targetKind}`)
    return { runId, targetId: "", packageId: "", artifactsCreated: 0, sectionsCreated: 0, evidenceExtracted: 0, factsPromoted: 0, projectionsRefreshed: 0, errors }
  }

  // Create ScoutTarget
  const target = await createScoutTarget(normalizedSourcePath, targetTitle, targetKind).catch(err => {
    errors.push(`Failed to create ScoutTarget: ${err}`)
    throw err
  })
  await linkTouched(runId, target.id)

  // Determine package path
  const packagePath = packageHintOverride ?? derivePackagePath(normalizedSourcePath, targetKind)
  const pkg = await getOrCreateKnowledgePackage(packagePath || "default", targetTitle, researchDirectionOverride).catch(err => {
    errors.push(`Failed to create KnowledgePackage: ${err}`)
    throw err
  })
  await linkTouchedPackage(runId, pkg.id)

  let artifactsCreated = 0
  let sectionsCreated = 0
  let evidenceExtracted = 0
  let factsPromoted = 0
  let projectionsRefreshed = 0

  for (const filePath of sourcePaths) {
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const fileTitle = path.basename(filePath, path.extname(filePath))
      const sourceLocatorBase = canonicalUrl ?? filePath

      let existingArtifact: SourceArtifact | null = null
      if (canonicalUrl) {
        existingArtifact = await findArtifactByPathOrUrl(canonicalUrl)
      }

      // Fall back to content hash dedup only when we do not already have a
      // website artifact keyed by the canonical URL.
      if (!existingArtifact) {
        const hash = contentHash(content)
        const existingArtifacts = await findArtifactsByHash(hash)
        if (existingArtifacts.length > 0) {
          if (canonicalUrl) {
            existingArtifact = existingArtifacts.find((artifact) =>
              artifact.artifact_kind === "external_url" ||
              artifact.artifact_path_or_url.includes("radar-scout-cache") ||
              artifact.artifact_path_or_url.startsWith("http://") ||
              artifact.artifact_path_or_url.startsWith("https://")
            ) ?? null
          }
          if (!existingArtifact) {
            existingArtifact = existingArtifacts[0] ?? null
          }
        }
      }

      if (existingArtifact) {
        // Reuse existing artifact graph, but still attach it to this package and
        // refresh projections for the package so package/path based retrieval works.
        // If we have a canonical URL and the existing artifact doesn't use it,
        // migrate the artifact identity to the URL. This ensures website sources
        // always show the original URL as canonical graph identity, not a cached temp path.
        if (canonicalUrl && existingArtifact.artifact_path_or_url !== canonicalUrl) {
          const updatedArtifact: SourceArtifact = {
            ...existingArtifact,
            artifact_path_or_url: canonicalUrl,
            updated_at: now(),
          }
          await saveSourceArtifact(updatedArtifact)
        }

        await linkProducer(target.id, "ScoutTarget", existingArtifact.id, "SourceArtifact")
        await linkContains(pkg.id, existingArtifact.id)
        const existingFacts = await collectFactsForArtifact(existingArtifact.id)
        const reusedProjections = await refreshProjections(pkg, existingFacts)
        projectionsRefreshed += reusedProjections.length
        continue
      }

      const artifact = await createSourceArtifact(filePath, content, fileTitle, canonicalUrl)
      await linkProducer(target.id, "ScoutTarget", artifact.id, "SourceArtifact")
      await linkContains(pkg.id, artifact.id)
      artifactsCreated++

      // Chunk into sections
      const sections = await createSections(artifact.id, content)
      sectionsCreated += sections.length

      // Extract evidence from sections
      const allFacts: ReferenceFact[] = []
      for (const section of sections) {
        const evidenceList = await createEvidence(section, sourceLocatorBase)
        evidenceExtracted += evidenceList.length

        // Promote evidence to ReferenceFact
        for (const ev of evidenceList) {
          const fact = await promoteToReferenceFact(ev)
          if (fact) {
            factsPromoted++
            allFacts.push(fact)
          }
        }
      }

      // Refresh projections for this package
      const newProjections = await refreshProjections(pkg, allFacts)
      projectionsRefreshed += newProjections.length
    } catch (err) {
      errors.push(`Error processing ${filePath}: ${err}`)
    }
  }

  // Update ScoutRun status
  await saveScoutRun({
    ...run,
    status: errors.length > 0 && errors.length >= sourcePaths.length ? "failed" : "completed",
    finished_at: now(),
  })

  return {
    runId,
    targetId: target.id,
    packageId: pkg.id,
    artifactsCreated,
    sectionsCreated,
    evidenceExtracted,
    factsPromoted,
    projectionsRefreshed,
    errors,
  }
}

export async function scoutRefresh(packagePath: string): Promise<ScoutIngestResult> {
  // Refresh = re-run ingestion for the same path
  return scoutIngest(packagePath)
}
