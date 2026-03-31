/**
 * full-signal-runner.ts — Legacy runner (deprecated)
 *
 * ⚠️ DEPRECATED: This runner is not maintained and does not reflect current architecture.
 * Active runner: src/orchestrator/riplus-ma-runner.ts
 *
 * Run: npx tsx src/orchestrator/full-signal-runner.ts
 *
 * Historical purpose: Multi-source exploration (GitHub Discussions, Stack Overflow, Riplus Mock).
 * GitHub discussions have been removed from the riplus-ma intent per product owner guidance.
 * Does not use the Intent/SourceRegistry architecture.
 */

import * as path from "path"
import * as fs from "fs"

const DATA_DIR = path.join(process.cwd(), "data")
process.env.RADAR_DATA_DIR = DATA_DIR

import { EventBus } from "../infrastructure/event-bus.js"
import { StorageHelper } from "../infrastructure/storage-helper.js"
import { StackOverflowAdapter } from "../adapters/stackoverflow-adapter.js"
import { GitHubMultiDiscussionsAdapter } from "../adapters/github-multi-discussions-adapter.js"
import { GitHubSearchAdapter } from "../adapters/github-search-adapter.js"
import { RiplusMockSourceAdapter } from "../adapters/riplus-mock-source-adapter.js"
import { getGitHubToken } from "../lib/get-github-token.js"
import { ReviewQueue } from "../engine/review-queue.js"
import { ThemeEngine } from "../engine/theme-engine.js"
import { OpportunityAssembly } from "../engine/opportunity-assembly.js"
import { augment } from "../filters/agent-filter.js"
import { addQualification } from "../filters/qualification-filter.js"
import { RadarDigestConsumer } from "../consumers/radar-digest.js"
import { PrototypeBriefConsumer } from "../consumers/prototype-brief.js"
import { StitchProjectConsumer } from "../consumers/stitch-project.js"
import { VideoBriefConsumer } from "../consumers/video-brief.js"
import { JiraDraftConsumer } from "../consumers/jira-draft.js"

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// ── Triage ───────────────────────────────────────────────────────────────────

type TriageDecision = "approved" | "rejected" | "deferred"

interface TriageResult {
  decision: TriageDecision
  reason: string
}

async function humanSimulatedTriage(signal: any): Promise<TriageResult> {
  const title = (signal.title ?? "").trim()
  const body = (signal.body ?? "").trim()
  const text = `${title} ${body}`.toLowerCase()
  const score = signal.relevanceScore ?? 0.5
  const qualification = signal.qualification?.qualification ?? "unknown"
  const sourceType = signal.sourceType ?? ""
  const metadata = signal.metadata ?? {}

  if (qualification === "bug") {
    return { decision: "rejected", reason: "Bug report — belongs in bug tracker" }
  }

  if (qualification === "support_friction") {
    return { decision: "rejected", reason: "Support friction — known pain, not new opportunity" }
  }

  if (
    title.toLowerCase().includes("release") ||
    title.toLowerCase().includes("announcing") ||
    text.includes("we are excited to announce")
  ) {
    return { decision: "rejected", reason: "Announcement / release notes" }
  }

  if (title.toLowerCase().startsWith("how ") || title.toLowerCase().startsWith("why ")) {
    return { decision: "rejected", reason: "Q&A / question — not an opportunity signal" }
  }

  const isNoise =
    text.includes("dark mode") ||
    text.includes("meme") ||
    text.includes("just curious") ||
    text.includes("quick question") ||
    text.includes("off topic") ||
    text.includes("lol")

  if (isNoise) {
    return { decision: "rejected", reason: "Noise / off-topic content" }
  }

  if (
    (text.includes("already") && text.includes("exist")) ||
    text.includes("same as") ||
    text.includes("duplicate of") ||
    text.includes("already available")
  ) {
    return { decision: "rejected", reason: "Already exists / implemented" }
  }

  if (title.length < 12) {
    return { decision: "rejected", reason: "Title too short / vague" }
  }

  const hasExpectedBehavior =
    body.includes("expected") ||
    body.includes("should ") ||
    body.includes("would be ") ||
    (body.includes("currently ") && body.includes("instead"))

  const hasSpecificProblem =
    body.includes("problem") ||
    body.includes("issue") ||
    body.includes("when") ||
    body.includes("scenario") ||
    body.includes("steps to") ||
    body.includes("use case") ||
    text.includes("does not") ||
    text.includes("unable to")

  const hasBenefitLanguage =
    body.includes("would help") ||
    body.includes("would be nice") ||
    body.includes("could we") ||
    body.includes("it would") ||
    body.includes("should support") ||
    body.includes("looking for") ||
    body.includes("it would be great") ||
    body.includes("would be useful")

  const hasSubstantiveBody = body.length > 80

  const specificWithUseCase = hasSpecificProblem && hasBenefitLanguage && hasSubstantiveBody
  const clearFeatureRequest = hasBenefitLanguage && hasExpectedBehavior && hasSubstantiveBody
  const highScoreAndSubstantive = score > 0.7 && hasSubstantiveBody && (hasSpecificProblem || hasBenefitLanguage)

  if (specificWithUseCase || clearFeatureRequest || highScoreAndSubstantive) {
    return { decision: "approved", reason: `Feature request with problem description [source: ${sourceType}]` }
  }

  if (qualification === "workflow_friction" && body.length < 60) {
    return { decision: "deferred", reason: "Workflow friction — needs more detail" }
  }

  if (body.length < 50 && !hasBenefitLanguage) {
    return { decision: "deferred", reason: "Lacks specificity" }
  }

  if (score > 0.5 && hasBenefitLanguage && body.length > 40) {
    return { decision: "approved", reason: `Above-threshold feature request [source: ${sourceType}]` }
  }

  return { decision: "deferred", reason: "Borderline — defer for cross-source confirmation" }
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const cycleId = `full-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`

  // Get GitHub token (from env or gh CLI)
  const githubToken = await getGitHubToken()

  console.log(`\n=== FULL SIGNAL RUNNER: ${cycleId} ===`)
  console.log(`GitHub token: ${!!githubToken} (${githubToken ? "gh auth token" : "not available"})`)
  console.log(`Sources: GitHub Search + GitHub Discussions + Stack Overflow + Riplus Mock\n`)

  const eventBus = new EventBus()
  const storage = new StorageHelper(DATA_DIR)
  const reviewQueue = new ReviewQueue(DATA_DIR)
  const themeEngine = new ThemeEngine()
  const oppAssembly = new OpportunityAssembly(eventBus)

  const radarDigest = new RadarDigestConsumer(eventBus, storage)
  const protoBrief = new PrototypeBriefConsumer(eventBus, storage)
  const stitchProject = new StitchProjectConsumer(eventBus, storage)
  const videoBrief = new VideoBriefConsumer(eventBus, storage)
  const jiraDraft = new JiraDraftConsumer(eventBus, storage)

  eventBus.on("opportunity.created", async (payload: any) => {
    await protoBrief.process("opportunity.created", payload)
    await stitchProject.process("opportunity.created", payload)
    await jiraDraft.process("opportunity.created", payload)
  })
  eventBus.on("prototypeBrief.created", async (payload: any) => {
    await videoBrief.process("prototypeBrief.created", payload)
  })

  ensureDir(path.join(DATA_DIR, "prompts"))
  const srcDir = path.join(process.cwd(), "templates", "prompts")
  const destDir = path.join(DATA_DIR, "prompts")
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
    if (fs.existsSync(srcDir)) {
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file))
      }
    }
  }

  // ── Step 1: Source Ingestion ──────────────────────────────────────────────
  console.log("[1] SOURCE INGESTION")

  // 1a: GitHub Search (token required)
  console.log("\n[1a] GITHUB SEARCH (cross-repo feature requests)")
  const searchSignals: any[] = []
  if (githubToken) {
    const searchAdapter = new GitHubSearchAdapter(githubToken)
    await searchAdapter.connect()
    const raw = await searchAdapter.poll()
    await searchAdapter.disconnect()
    searchSignals.push(...raw)
    console.log(`    GitHub Search signals: ${raw.length}`)
    // Breakdown by repo
    const repoBreakdown: Record<string, number> = {}
    for (const s of raw) {
      const repo = (s.rawPayload as any)?.repo ?? "unknown"
      repoBreakdown[repo] = (repoBreakdown[repo] ?? 0) + 1
    }
    for (const [repo, count] of Object.entries(repoBreakdown)) {
      console.log(`      ${repo}: ${count}`)
    }
  } else {
    console.log(`    SKIPPED — no GitHub token`)
  }

  // 1b: GitHub Discussions (multi-repo)
  console.log("\n[1b] GITHUB DISCUSSIONS (12 repos)")
  const discAdapter = new GitHubMultiDiscussionsAdapter(undefined, githubToken)
  await discAdapter.connect()
  const discSignals = await discAdapter.poll()
  await discAdapter.disconnect()
  const discRepoCounts: Record<string, number> = {}
  for (const s of discSignals) {
    const repo = (s.rawPayload as any)?.repo ?? "unknown"
    discRepoCounts[repo] = (discRepoCounts[repo] ?? 0) + 1
  }
  console.log("    Repo breakdown:")
  for (const [repo, count] of Object.entries(discRepoCounts)) {
    console.log(`      ${repo}: ${count}`)
  }

  // 1c: Stack Overflow
  console.log("\n[1c] STACK OVERFLOW (Meta SO feature-requests)")
  const soAdapter = new StackOverflowAdapter()
  await soAdapter.connect()
  const soRawSignals = await soAdapter.poll()
  await soAdapter.disconnect()
  const soSources: Record<string, number> = {}
  for (const s of soRawSignals) {
    const site = (s.rawPayload as any)?.site ?? "stackoverflow"
    soSources[site] = (soSources[site] ?? 0) + 1
  }
  for (const [site, count] of Object.entries(soSources)) {
    console.log(`    ${site}: ${count}`)
  }

  // 1d: Riplus Mock
  console.log("\n[1d] RIPLUS MOCK SIGNALS")
  const riplusAdapter = new RiplusMockSourceAdapter()
  await riplusAdapter.connect()
  const riplusRawSignals = await riplusAdapter.poll()
  await riplusAdapter.disconnect()
  console.log(`    Riplus signals: ${riplusRawSignals.length}`)

  // Combine all
  const allRawSignals = [...searchSignals, ...discSignals, ...soRawSignals, ...riplusRawSignals]
  const sourceCounts = {
    "github-search": searchSignals.length,
    "github-discussions": discSignals.length,
    "stack-overflow": soRawSignals.length,
    "riplus": riplusRawSignals.length,
  }
  console.log(`\n    TOTAL signals: ${allRawSignals.length}`)
  for (const [src, count] of Object.entries(sourceCounts)) {
    console.log(`      ${src}: ${count}`)
  }

  if (allRawSignals.length === 0) {
    console.log("\n=== NO SIGNALS — ABORTING ===")
    return
  }

  // ── Step 2: Normalize ────────────────────────────────────────────────────
  console.log("\n[2] NORMALIZATION")
  const normalized = allRawSignals.map(s => {
    if (s.sourceId === "github-search") return new GitHubSearchAdapter(githubToken).normalize(s)
    if (s.sourceId === "github-multi-discussions") return discAdapter.normalize(s)
    if (s.sourceId === "stack-overflow") return soAdapter.normalize(s)
    return riplusAdapter.normalize(s)
  })
  console.log(`    Normalized: ${normalized.length}`)
  ensureDir(path.join(DATA_DIR, "normalized-signals"))
  for (const sig of normalized) {
    fs.writeFileSync(
      path.join(DATA_DIR, "normalized-signals", `${sig.id}.json`),
      JSON.stringify(sig, null, 2)
    )
  }

  // ── Step 3: Augment ──────────────────────────────────────────────────────
  console.log("\n[3] AGENT AUGMENTATION")
  const scored = augment(normalized, cycleId)
  ensureDir(path.join(DATA_DIR, "scored-signals"))
  console.log(`    Scored: ${scored.length}`)
  for (const sig of scored) {
    fs.writeFileSync(
      path.join(DATA_DIR, "scored-signals", `${sig.id}.json`),
      JSON.stringify(sig, null, 2)
    )
    const source = sig.sourceType ?? "unknown"
    console.log(`    - ${sig.id} [${source}]: score=${sig.relevanceScore.toFixed(2)} cat=${sig.category}`)
  }

  // ── Step 4: Qualification ───────────────────────────────────────────────
  console.log("\n[4] QUALIFICATION FILTER")
  const qualified = addQualification(scored)
  const qualCounts: Record<string, number> = {}
  for (const sig of qualified) {
    const q = sig.qualification.qualification
    qualCounts[q] = (qualCounts[q] ?? 0) + 1
  }
  console.log(`    Summary: ${JSON.stringify(qualCounts)}`)

  // ── Step 5: Enqueue ─────────────────────────────────────────────────────
  console.log("\n[5] REVIEW QUEUE")
  await reviewQueue.enqueueAll(scored, cycleId)
  const pending = await reviewQueue.getPending()
  console.log(`    Enqueued: ${scored.length}, pending: ${pending.length}`)

  // ── Step 6: Simulated human triage ─────────────────────────────────────
  console.log("\n[6] SIMULATED HUMAN TRIAGE")
  for (const item of pending) {
    const signal = qualified.find((s: any) => s.id === item.signalId)
    if (!signal) continue
    const { decision, reason } = await humanSimulatedTriage(signal)
    await reviewQueue.triage(item.signalId, decision, "full-signal-agent", reason)
    const icon = decision === "approved" ? "APPROVE" : decision === "rejected" ? "REJECT" : "DEFER"
    const source = signal.sourceType ?? "unknown"
    console.log(`    ${icon} [${source}] ${signal.title.slice(0, 55)}`)
    console.log(`      Reason: ${reason}`)
  }

  const approved = await reviewQueue.getApproved()
  const rejected = await reviewQueue.getRejected()
  const deferred = await reviewQueue.getDeferred()
  console.log(
    `\n    Approved: ${approved.length} | Rejected: ${rejected.length} | Deferred: ${deferred.length}`
  )

  // ── Step 7: Theme clustering ────────────────────────────────────────────
  console.log("\n[7] THEME CLUSTERING")
  const approvedSignals = approved
    .map((item: any) => scored.find((s: any) => s.id === item.signalId))
    .filter((s: any): s is any => !!s)

  const themes = themeEngine.cluster(approvedSignals, cycleId)
  console.log(`    Themes: ${themes.length}`)
  for (const theme of themes) {
    const sources = [...new Set(
      approvedSignals
        .filter((s: any) => theme.signalIds.includes(s.id))
        .map((s: any) => s.sourceType ?? "unknown")
    )]
    console.log(`    - ${theme.id}: "${theme.themeTitle}" (${theme.signalIds.length} signals) [${sources.join(", ")}]`)
  }

  // ── Step 8: Opportunity assembly ───────────────────────────────────────
  console.log("\n[8] OPPORTUNITY ASSEMBLY")
  const opportunities = await oppAssembly.assemble(themes)
  console.log(`    Opportunities: ${opportunities.length}`)
  for (const opp of opportunities) {
    console.log(`    - ${opp.id}: "${opp.title}"`)
    console.log(`      Theme: ${opp.themeCandidateId} | Pain cards: ${opp.painCardIds.length}`)
  }

  // ── Step 9: Consumers ──────────────────────────────────────────────────
  console.log("\n[9] CONSUMERS")

  // ── Step 10: Digest ─────────────────────────────────────────────────────
  console.log("\n[10] RADAR DIGEST")
  const digest = await radarDigest.generateDigest(cycleId)
  if (digest) {
    console.log(`    Digest: ${digest.id}`)
    console.log(`    Summary: ${digest.themeSummary}`)
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n=== FULL SIGNAL RUNNER COMPLETE ===`)
  console.log(`Cycle: ${cycleId}`)
  console.log(`Token: ${!!githubToken}`)
  console.log(`Sources: GitHub Search=${searchSignals.length}, GitHub Discussions=${discSignals.length}, SO=${soRawSignals.length}, Riplus=${riplusRawSignals.length}`)
  console.log(`Total signals: ${allRawSignals.length} | Approved: ${approved.length} | Themes: ${themes.length} | Opps: ${opportunities.length}`)

  // ── Output files ────────────────────────────────────────────────────────
  console.log("\n--- OUTPUT FILES ---")
  const dirs = ["normalized-signals", "scored-signals", "themes", "opportunities", "briefs/prototype", "digests"]
  for (const d of dirs) {
    const dirPath = path.join(DATA_DIR, d)
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath)
      if (files.length > 0) {
        console.log(`  data/${d}/: ${files.length} file(s)`)
        for (const f of files.slice(0, 3)) {
          console.log(`    - ${f}`)
        }
        if (files.length > 3) console.log(`    ... and ${files.length - 3} more`)
      }
    }
  }
}

run().catch(err => { console.error("Runner failed:", err); process.exit(1) })
