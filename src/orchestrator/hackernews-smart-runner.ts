/**
 * SmarterHackerNewsRunner — Historical experiment runner (deprecated)
 *
 * ⚠️ DEPRECATED: This runner is not maintained and does not reflect current architecture.
 * Active runner: src/orchestrator/riplus-ma-runner.ts
 *
 * Historical purpose: SmarterHackerNewsAdapter as primary signal source (pre-Intent design).
 * HackerNews is NOT part of riplus-ma Intent. Kept for reference only.
 *
 * Run: npx tsx src/orchestrator/hackernews-smart-runner.ts
 */

import * as path from "path"
import * as fs from "fs"

const DATA_DIR = path.join(process.cwd(), "data")
process.env.RADAR_DATA_DIR = DATA_DIR

import { EventBus } from "../infrastructure/event-bus.js"
import { StorageHelper } from "../infrastructure/storage-helper.js"
import { SmarterHackerNewsAdapter } from "../adapters/hackernews-smart-adapter.js"
import { ReviewQueue } from "../engine/review-queue.js"
import { ThemeEngine } from "../engine/theme-engine.js"
import { OpportunityAssembly } from "../engine/opportunity-assembly.js"
import { augment } from "../filters/agent-filter.js"
import { addQualification, type Qualification } from "../filters/qualification-filter.js"
import { RadarDigestConsumer } from "../consumers/radar-digest.js"
import { PrototypeBriefConsumer } from "../consumers/prototype-brief.js"
import { StitchProjectConsumer } from "../consumers/stitch-project.js"
import { VideoBriefConsumer } from "../consumers/video-brief.js"
import { JiraDraftConsumer } from "../consumers/jira-draft.js"

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function humanSimulatedTriage(
  signal: any,
): Promise<{ decision: "approved" | "rejected" | "deferred"; reason: string }> {
  const title = signal.title ?? ""
  const body = signal.body ?? ""
  const text = `${title} ${body}`.toLowerCase()
  const score = signal.relevanceScore ?? 0.5
  const tags = signal.tags ?? []

  const isNoise =
    text.includes("meme") ||
    text.includes("just curious") ||
    text.includes("quick question") ||
    text.includes("unpopular opinion") ||
    text.includes("ask hn")

  const isAlreadyImplemented =
    (text.includes("already") && text.includes("exist")) ||
    text.includes("i wish they would stop")

  const isDuplicateContext =
    text.includes("same as") ||
    text.includes("duplicate of") ||
    text.includes("already posted")

  const isComplaintWithoutSolution =
    body.length < 60 &&
    !text.includes("would") &&
    !text.includes("should") &&
    !text.includes("could") &&
    (text.includes("hate") || text.includes("terrible") || text.includes("worst"))

  if (isNoise) return { decision: "rejected", reason: "Signal is noise or off-topic" }
  if (isAlreadyImplemented || isDuplicateContext) return { decision: "rejected", reason: "Already exists or duplicate" }
  if (isComplaintWithoutSolution) return { decision: "rejected", reason: "Complaint without actionable feature request" }

  const needsMoreDetail =
    (body.length < 80 && title.length < 50) ||
    (!text.includes("would") && !text.includes("should") && !text.includes("could") && !text.includes("wish"))

  const isHypothetical =
    text.includes("if someone were to") || text.includes("theorety") ||
    (text.includes("would be cool") && body.length < 100)

  if (needsMoreDetail && score < 0.6) return { decision: "deferred", reason: "Lacks specificity" }
  if (isHypothetical) return { decision: "deferred", reason: "Hypothetical suggestion" }

  const hasClearBenefit =
    text.includes("would be") || text.includes("would love") || text.includes("would be great") ||
    text.includes("should support") || text.includes("should add") || text.includes("could we") ||
    text.includes("it would") || text.includes("wish there") ||
    (body.length > 100 && score > 0.5)

  const hasSpecificUseCase =
    text.includes("when") || text.includes("use case") || text.includes("scenario") ||
    text.includes("steps to") || text.includes("for example")

  const mentionsSpecificProduct =
    tags.some((t: string) =>
      ["vscode", "notion", "figma", "linear", "slack", "arc", "obsidian", "cursor",
       "windsurf", "github", "discord", "chrome", "firefox", "copilot", "claude",
       "openai", "algolia", "zoom", "teams", "git", "gitlab", "jira"].includes(t)
    )

  if (hasClearBenefit && hasSpecificUseCase && mentionsSpecificProduct) {
    return { decision: "approved", reason: "Specific feature request with clear use case, benefit, and specific product" }
  }
  if (hasClearBenefit && body.length > 150 && mentionsSpecificProduct) {
    return { decision: "approved", reason: "Detailed feature request for specific product" }
  }
  if (score > 0.75 && body.length > 80 && mentionsSpecificProduct) {
    return { decision: "approved", reason: "High-scoring substantive signal for specific product" }
  }
  if (hasClearBenefit && hasSpecificUseCase && body.length > 120) {
    return { decision: "approved", reason: "Actionable feature request with clear use case" }
  }
  if (score > 0.7 && body.length > 100) {
    return { decision: "approved", reason: "High-scoring signal with substantive content" }
  }

  return { decision: "deferred", reason: "Borderline signal — needs more context" }
}

async function run(): Promise<void> {
  const cycleId = `hn-smart-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`
  console.log(`\n=== SMARTER HACKER NEWS RUNNER: ${cycleId} ===\n`)

  const eventBus = new EventBus()
  const storage = new StorageHelper(DATA_DIR)

  const adapter = new SmarterHackerNewsAdapter()
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

  const srcPromptsDir = path.join(process.cwd(), "templates", "prompts")
  const destPromptsDir = path.join(DATA_DIR, "prompts")
  if (!fs.existsSync(destPromptsDir)) {
    fs.mkdirSync(destPromptsDir, { recursive: true })
    if (fs.existsSync(srcPromptsDir)) {
      for (const file of fs.readdirSync(srcPromptsDir)) {
        fs.copyFileSync(path.join(srcPromptsDir, file), path.join(destPromptsDir, file))
      }
    }
  }

  // Step 1: Source ingestion
  console.log("[1] SOURCE INGESTION (SmarterHackerNewsAdapter)")
  await adapter.connect()
  const rawSignals = await adapter.poll()
  console.log(`    Raw signals: ${rawSignals.length}`)

  rawSignals.slice(0, 10).forEach((s) => {
    const st = (s.rawPayload as any)?.signalType ?? "unknown"
    const author = (s.rawPayload as any)?.author ?? "unknown"
    const title = (s.rawPayload as any)?.title ?? ""
    const points = (s.rawPayload as any)?.points ?? 0
    console.log(`    - ${s.id} [${st}] @${author} pts=${points}: ${title.slice(0, 60)}`)
  })
  if (rawSignals.length > 10) console.log(`    ... and ${rawSignals.length - 10} more`)

  if (rawSignals.length === 0) {
    console.error("[SmarterHackerNewsRunner] No signals fetched. Exiting.")
    await adapter.disconnect()
    return
  }

  // Step 2: Normalize
  console.log("\n[2] NORMALIZATION")
  const normalized = rawSignals.map((s) => adapter.normalize(s))
  console.log(`    Normalized: ${normalized.length}`)
  ensureDir(path.join(DATA_DIR, "normalized-signals"))
  for (const sig of normalized) {
    fs.writeFileSync(
      path.join(DATA_DIR, "normalized-signals", `${sig.id}.json`),
      JSON.stringify(sig, null, 2)
    )
  }

  // Step 3: Augment
  console.log("\n[3] AGENT AUGMENTATION")
  const scored = augment(normalized, cycleId)
  ensureDir(path.join(DATA_DIR, "scored-signals"))
  console.log(`    Scored: ${scored.length}`)
  for (const sig of scored) {
    fs.writeFileSync(
      path.join(DATA_DIR, "scored-signals", `${sig.id}.json`),
      JSON.stringify(sig, null, 2)
    )
    console.log(`    - ${sig.id}: score=${sig.relevanceScore.toFixed(2)} cat=${sig.category}`)
  }

  // Step 4: Qualification
  console.log("\n[4] QUALIFICATION FILTER")
  const qualified = addQualification(scored)
  console.log(`    Qualified signals:`)
  const counts: Record<string, number> = {}
  for (const sig of qualified) {
    const q = sig.qualification.qualification
    counts[q] = (counts[q] ?? 0) + 1
  }
  console.log(`    Summary: ${JSON.stringify(counts)}`)

  // Step 5: Review queue
  console.log("\n[5] REVIEW QUEUE")
  await reviewQueue.enqueueAll(scored, cycleId)
  const pending = await reviewQueue.getPending()
  console.log(`    Enqueued: ${scored.length}, pending: ${pending.length}`)

  // Step 6: Simulated human triage
  console.log("\n[6] SIMULATED HUMAN TRIAGE")
  for (const item of pending) {
    const signal = qualified.find((s) => s.id === item.signalId)
    if (!signal) continue

    const { decision, reason } = await humanSimulatedTriage(signal)
    await reviewQueue.triage(item.signalId, decision, "agent-simulated", reason)

    const verdictIcon = decision === "approved" ? "APPROVED" : decision === "rejected" ? "REJECTED" : "DEFERRED"
    console.log(`    [${verdictIcon}] ${signal.title.slice(0, 60)}`)
    console.log(`      Reason: ${reason}`)
  }

  const approved = await reviewQueue.getApproved()
  const rejected = await reviewQueue.getRejected()
  const deferred = await reviewQueue.getDeferred()
  console.log(`\n    Approved: ${approved.length} | Rejected: ${rejected.length} | Deferred: ${deferred.length}`)

  // Step 7: Theme clustering
  console.log("\n[7] THEME CLUSTERING")
  const approvedSignals = approved
    .map((item) => scored.find((s) => s.id === item.signalId))
    .filter((s): s is typeof scored[0] => !!s)

  const themes = themeEngine.cluster(approvedSignals, cycleId)
  console.log(`    Themes: ${themes.length}`)
  for (const theme of themes) {
    console.log(`    - ${theme.id}: "${theme.themeTitle}" (${theme.signalIds.length} signals)`)
  }

  // Step 8: Opportunity assembly
  console.log("\n[8] OPPORTUNITY ASSEMBLY")
  const opportunities = await oppAssembly.assemble(themes)
  console.log(`    Opportunities: ${opportunities.length}`)
  for (const opp of opportunities) {
    console.log(`    - ${opp.id}: "${opp.title}"`)
  }

  // Step 9: Consumers
  console.log("\n[9] CONSUMERS")
  for (const opp of opportunities) {
    await protoBrief.process("opportunity.created", opp)
    await stitchProject.process("opportunity.created", opp)
    await jiraDraft.process("opportunity.created", opp)
  }

  // Step 10: Radar digest
  console.log("\n[10] RADAR DIGEST")
  const digest = await radarDigest.generateDigest(cycleId)
  console.log(`    Digest: ${digest?.id ?? "none"}`)
  if (digest) console.log(`    Summary: ${digest.themeSummary}`)

  console.log(`\n=== SMARTER HN RUNNER COMPLETE ===`)
  console.log(`Cycle: ${cycleId}`)
  console.log(`Signals: ${scored.length} | Approved: ${approved.length} | Themes: ${themes.length} | Opps: ${opportunities.length}`)

  // List output files
  console.log("\n--- OUTPUT FILES ---")
  const dirs = ["normalized-signals", "scored-signals", "themes", "opportunities", "briefs/prototype", "briefs/video", "jira-drafts", "digests"]
  for (const d of dirs) {
    const dirPath = path.join(DATA_DIR, d)
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath)
      if (files.length > 0) {
        console.log(`  data/${d}/: ${files.length} file(s)`)
      }
    }
  }

  await adapter.disconnect()
}

run().catch((err) => {
  console.error("Runner failed:", err)
  process.exit(1)
})
