/**
 * GitHubMultiRunner — Historical experiment runner (deprecated)
 *
 * ⚠️ DEPRECATED: This runner is not maintained and does not reflect current architecture.
 * Active runner: src/orchestrator/riplus-ma-runner.ts
 *
 * Historical purpose: Multi-repo GitHub Discussions as primary signal source (pre-Intent design).
 * GitHub is NOT part of riplus-ma Intent. Kept for reference only.
 *
 * Run: npx tsx src/orchestrator/github-multi-runner.ts
 *
 * Features:
 *   1. GitHubMultiDiscussionsAdapter — polls 4 repos in parallel
 *   2. Optional: RiplusMockSourceAdapter — MA-domain signals mixed in
 *   3. Improved triage — APPROVE / REJECT / DEFER based on richer criteria
 *   4. Full pipeline: augment → qualify → triage → cluster → assemble → brief
 *
 * Mixed source test:
 *   Pass --mix-riplus to include riplus mock signals alongside GitHub signals.
 *   This tests whether the qualification layer correctly handles different domains.
 */

import * as path from "path"
import * as fs from "fs"

const DATA_DIR = path.join(process.cwd(), "data")
process.env.RADAR_DATA_DIR = DATA_DIR

import { EventBus } from "../infrastructure/event-bus.js"
import { StorageHelper } from "../infrastructure/storage-helper.js"
import { GitHubMultiDiscussionsAdapter } from "../adapters/github-multi-discussions-adapter.js"
import { RiplusMockSourceAdapter } from "../adapters/riplus-mock-source-adapter.js"
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

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// ── Improved triage ─────────────────────────────────────────────────────────

type TriageDecision = "approved" | "rejected" | "deferred"

interface TriageResult {
  decision: TriageDecision
  reason: string
}

/**
 * Smarter simulated human triage:
 *
 * APPROVE if:
 *   - Specific problem described with expected behavior
 *   - Real use case / scenario stated
 *   - Body is substantive (not just "it would be nice")
 *
 * REJECT if:
 *   - Vague: "would be nice to have X" without detail
 *   - Duplicate signals, "already exists", "I don't understand X"
 *   - Noise: dark mode, memes, quick questions
 *   - Bug (not an opportunity — belongs in bug tracker)
 *
 * DEFER if:
 *   - Good signal but needs more context
 *   - Needs cross-repo confirmation
 *   - Workflow friction that needs more research
 */
async function humanSimulatedTriage(
  signal: any
): Promise<TriageResult> {
  const title = (signal.title ?? "").trim()
  const body = (signal.body ?? "").trim()
  const text = `${title} ${body}`.toLowerCase()
  const score = signal.relevanceScore ?? 0.5
  const qualification = signal.qualification?.qualification ?? "unknown"
  const repo = signal.metadata?.repo ?? ""

  // ── Hard reject criteria ────────────────────────────────────────────────

  // Bug → reject (belongs in bug tracker, not opportunity radar)
  if (qualification === "bug") {
    return {
      decision: "rejected",
      reason: "Bug report — belongs in bug tracker, not opportunity radar",
    }
  }

  // Support friction → reject
  if (qualification === "support_friction") {
    return {
      decision: "rejected",
      reason: "Support friction — known pain, not a new product opportunity",
    }
  }

  // Noise signals
  const isNoise =
    text.includes("dark mode") ||
    text.includes("meme") ||
    text.includes("just curious") ||
    text.includes("quick question") ||
    text.includes("off topic") ||
    text.includes("lol") ||
    text.includes("funny")

  if (isNoise) {
    return { decision: "rejected", reason: "Noise / off-topic content" }
  }

  // Already implemented / duplicate
  if (
    (text.includes("already") && text.includes("exist")) ||
    text.includes("same as") ||
    text.includes("duplicate of") ||
    text.includes("already available")
  ) {
    return {
      decision: "rejected",
      reason: "Describes something that already exists",
    }
  }

  // Vague title
  if (title.length < 12) {
    return { decision: "rejected", reason: "Title too short / vague to assess" }
  }

  // ── Approve criteria ────────────────────────────────────────────────────

  const hasExpectedBehavior =
    body.includes("expected") ||
    body.includes("should ") ||
    body.includes("would be ") ||
    body.includes("currently ") && body.includes("instead")

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
    body.includes("looking for")

  const hasSubstantiveBody = body.length > 80

  // High bar for approval: must have specificity + benefit
  const specificWithUseCase =
    hasSpecificProblem && hasBenefitLanguage && hasSubstantiveBody

  const clearFeatureRequest =
    hasBenefitLanguage && hasExpectedBehavior && hasSubstantiveBody

  const highScoreAndSubstantive =
    score > 0.7 && hasSubstantiveBody && (hasSpecificProblem || hasBenefitLanguage)

  if (specificWithUseCase || clearFeatureRequest || highScoreAndSubstantive) {
    return {
      decision: "approved",
      reason: "Specific feature request with problem description and expected behavior",
    }
  }

  // ── Defer criteria ──────────────────────────────────────────────────────

  // Workflow friction without enough detail
  if (qualification === "workflow_friction" && body.length < 60) {
    return {
      decision: "deferred",
      reason: "Workflow friction signal — needs more detail to turn into a prototype brief",
    }
  }

  // Borderline: has some good signals but lacking specificity
  if (body.length < 50 && !hasBenefitLanguage) {
    return {
      decision: "deferred",
      reason: "Lacks specificity — needs more context, user research, or cross-repo validation",
    }
  }

  if (score > 0.5 && hasBenefitLanguage && body.length > 40) {
    return {
      decision: "approved",
      reason: "Above-threshold feature request with benefit stated",
    }
  }

  // Default: defer
  return {
    decision: "deferred",
    reason: "Borderline signal — defer for more context or cross-repo confirmation",
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const includeRiplus = process.argv.includes("--mix-riplus")
  const cycleId = `ghmulti-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`

  console.log(`\n=== GITHUB MULTI RUNNER: ${cycleId} ===`)
  console.log(`GitHub token: ${!!GITHUB_TOKEN}`)
  console.log(`Mixed riplus: ${includeRiplus}\n`)

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

  // ── Step 1: Multi-repo GitHub Discussions ingestion ───────────────────
  console.log("[1] SOURCE INGESTION")

  const ghAdapter = new GitHubMultiDiscussionsAdapter()
  await ghAdapter.connect()
  const ghRawSignals = await ghAdapter.poll()
  await ghAdapter.disconnect()

  const repoCounts: Record<string, number> = {}
  for (const s of ghRawSignals) {
    const r = (s.rawPayload as any)?.repo ?? "unknown"
    repoCounts[r] = (repoCounts[r] ?? 0) + 1
  }
  console.log("    GitHub repos returning signals:")
  for (const [repo, count] of Object.entries(repoCounts)) {
    console.log(`      ${repo}: ${count}`)
  }

  // ── Step 1b: Optional Riplus mock ─────────────────────────────────────
  let riplusRawSignals: any[] = []
  if (includeRiplus) {
    console.log("\n[1b] RIPLUS MOCK INGESTION (mixed-source test)")
    const riplusAdapter = new RiplusMockSourceAdapter()
    await riplusAdapter.connect()
    riplusRawSignals = await riplusAdapter.poll()
    await riplusAdapter.disconnect()
    console.log(`    Riplus signals: ${riplusRawSignals.length}`)
  }

  // Combine
  const allRawSignals = [...ghRawSignals, ...riplusRawSignals]
  const totalSources = Object.keys(repoCounts).length + (includeRiplus ? 1 : 0)
  console.log(`\n    Total signals (combined): ${allRawSignals.length}`)
  console.log(`    Total source repos: ${totalSources}`)

  if (allRawSignals.length === 0) {
    console.log("\n=== NO SIGNALS — ABORTING ===")
    return
  }

  // ── Step 2: Normalize (per-adapter) ──────────────────────────────────
  console.log("\n[2] NORMALIZATION (per-source adapter)")
  const normalized = allRawSignals.map(s => {
    if (s.sourceId === "riplus") {
      return new RiplusMockSourceAdapter().normalize(s)
    }
    return ghAdapter.normalize(s)
  })
  console.log(`    Normalized: ${normalized.length}`)
  ensureDir(path.join(DATA_DIR, "normalized-signals"))
  for (const sig of normalized) {
    fs.writeFileSync(
      path.join(DATA_DIR, "normalized-signals", `${sig.id}.json`),
      JSON.stringify(sig, null, 2)
    )
  }

  // ── Step 3: Augment ───────────────────────────────────────────────────
  console.log("\n[3] AGENT AUGMENTATION")
  const scored = augment(normalized, cycleId)
  ensureDir(path.join(DATA_DIR, "scored-signals"))
  console.log(`    Scored: ${scored.length}`)
  for (const sig of scored) {
    fs.writeFileSync(
      path.join(DATA_DIR, "scored-signals", `${sig.id}.json`),
      JSON.stringify(sig, null, 2)
    )
    const repo = (sig as any).metadata?.repo ?? ""
    console.log(
      `    - ${sig.id} [${repo || "riplus"}]: score=${sig.relevanceScore.toFixed(2)} cat=${sig.category}`
    )
  }

  // ── Step 4: Qualification ─────────────────────────────────────────────
  console.log("\n[4] QUALIFICATION FILTER")
  const qualified = addQualification(scored)
  const qualCounts: Record<string, number> = {}
  for (const sig of qualified) {
    const q = sig.qualification.qualification
    qualCounts[q] = (qualCounts[q] ?? 0) + 1
    const isComm = sig.qualification.commercialRelevance ? "COMMERCIAL" : "excluded"
    console.log(`    - ${sig.id}: ${q} [${isComm}]`)
    console.log(`      ${sig.qualification.reasoning.slice(0, 80)}...`)
  }
  console.log(`    Summary: ${JSON.stringify(qualCounts)}`)

  // ── Step 5: Enqueue ───────────────────────────────────────────────────
  console.log("\n[5] REVIEW QUEUE")
  await reviewQueue.enqueueAll(scored, cycleId)
  const pending = await reviewQueue.getPending()
  console.log(`    Enqueued: ${scored.length}, pending: ${pending.length}`)

  // ── Step 6: Simulated human triage ────────────────────────────────────
  console.log("\n[6] IMPROVED SIMULATED HUMAN TRIAGE")
  for (const item of pending) {
    const signal = qualified.find((s: any) => s.id === item.signalId)
    if (!signal) continue

    const { decision, reason } = await humanSimulatedTriage(signal)
    await reviewQueue.triage(item.signalId, decision, "agent-simulated-v2", reason)

    const icon = decision === "approved" ? "APPROVE" : decision === "rejected" ? "REJECT" : "DEFER"
    const repo = (signal as any).metadata?.repo ?? "riplus"
    console.log(`    ${icon} [${repo}] ${signal.title.slice(0, 60)}`)
    console.log(`      Reason: ${reason}`)
  }

  const approved = await reviewQueue.getApproved()
  const rejected = await reviewQueue.getRejected()
  const deferred = await reviewQueue.getDeferred()
  console.log(
    `\n    Approved: ${approved.length} | Rejected: ${rejected.length} | Deferred: ${deferred.length}`
  )

  // ── Step 7: Theme clustering ─────────────────────────────────────────
  console.log("\n[7] THEME CLUSTERING")
  const approvedSignals = approved
    .map((item: any) => scored.find((s: any) => s.id === item.signalId))
    .filter((s: any): s is any => !!s)

  const themes = themeEngine.cluster(approvedSignals, cycleId)
  console.log(`    Themes: ${themes.length}`)
  for (const theme of themes) {
    console.log(`    - ${theme.id}: "${theme.themeTitle}" (${theme.signalIds.length} signals)`)
  }

  // ── Step 8: Opportunity assembly ─────────────────────────────────────
  console.log("\n[8] OPPORTUNITY ASSEMBLY")
  const opportunities = await oppAssembly.assemble(themes)
  console.log(`    Opportunities: ${opportunities.length}`)
  for (const opp of opportunities) {
    console.log(`    - ${opp.id}: "${opp.title}"`)
  }

  // ── Step 9: Consumers ─────────────────────────────────────────────────
  console.log("\n[9] CONSUMERS")

  // ── Step 10: Digest ───────────────────────────────────────────────────
  console.log("\n[10] RADAR DIGEST")
  const digest = await radarDigest.generateDigest(cycleId)
  if (digest) {
    console.log(`    Digest: ${digest.id}`)
    console.log(`    Summary: ${digest.themeSummary}`)
  }

  // ── Done ───────────────────────────────────────────────────────────────
  console.log(`\n=== GITHUB MULTI RUNNER COMPLETE ===`)
  console.log(`Cycle: ${cycleId}`)
  console.log(`Repos returning signals: ${Object.entries(repoCounts).map(([k,v]) => `${k}=${v}`).join(", ")}`)
  console.log(`Riplus: ${includeRiplus ? riplusRawSignals.length : 0}`)
  console.log(`Signals: ${scored.length} | Approved: ${approved.length} | Themes: ${themes.length} | Opps: ${opportunities.length}`)

  // ── Output files ──────────────────────────────────────────────────────
  console.log("\n--- OUTPUT FILES ---")
  const dirs = [
    "normalized-signals",
    "scored-signals",
    "themes",
    "opportunities",
    "briefs/prototype",
    "digests",
  ]
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
