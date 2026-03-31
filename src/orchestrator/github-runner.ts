/**
 * GitHubRunner — Historical experiment runner (deprecated)
 *
 * ⚠️ DEPRECATED: This runner is not maintained and does not reflect current architecture.
 * Active runner: src/orchestrator/riplus-ma-runner.ts
 *
 * Run: node dist/orchestrator/github-runner.js
 *   or: tsx src/orchestrator/github-runner.ts
 *
 * Historical purpose: GitHub Issues as primary signal source (vscode repository).
 * GitHub is NOT part of riplus-ma Intent. Kept for reference only.
 *
 * This exercises:
 *   1. GitHubIssuesAdapter (microsoft/vscode feature requests)
 *   2. Standard augment (score / classify / dedup)
 *   3. Qualification filter (bug / friction / opportunity / noise)
 *   4. Review queue + simulated human triage via sub-agent
 *   5. Theme clustering + Opportunity assembly
 *   6. Brief consumers
 *   7. Digest
 *
 * If GitHub API fails (rate limit 60/hr), falls back to hardcoded mock data
 * from real vscode issue titles/bodies.
 */

import * as path from 'path'
import * as fs from 'fs'

const DATA_DIR = path.join(process.cwd(), 'data')
process.env.RADAR_DATA_DIR = DATA_DIR

import { EventBus } from '../infrastructure/event-bus.js'
import { StorageHelper } from '../infrastructure/storage-helper.js'
import { GitHubIssuesAdapter } from '../adapters/github-issues-adapter.js'
import { ReviewQueue } from '../engine/review-queue.js'
import { ThemeEngine } from '../engine/theme-engine.js'
import { OpportunityAssembly } from '../engine/opportunity-assembly.js'
import { augment } from '../filters/agent-filter.js'
import { addQualification, type Qualification } from '../filters/qualification-filter.js'
import { RadarDigestConsumer } from '../consumers/radar-digest.js'
import { PrototypeBriefConsumer } from "../consumers/prototype-brief.js"
import { StitchProjectConsumer } from "../consumers/stitch-project.js"
import { VideoBriefConsumer } from '../consumers/video-brief.js'
import { JiraDraftConsumer } from '../consumers/jira-draft.js'

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/**
 * Simulated human triage via sub-agent.
 *
 * This reads each scored signal's title/body and makes a triage decision
 * based on content quality and specificity — simulating what a human reviewer
 * would do.
 *
 * Triage criteria:
 * - APPROVED: specific feature described with clear use case and benefit
 * - REJECTED: vague ("it would be nice to have X"), duplicate signal, or noise
 * - DEFERRED: interesting but needs more detail or user research
 */
async function humanSimulatedTriage(
  signal: any,
  reviewQueue: ReviewQueue
): Promise<{ decision: 'approved' | 'rejected' | 'deferred'; reason: string }> {
  const title = signal.title ?? ''
  const body = signal.body ?? ''
  const text = `${title} ${body}`.toLowerCase()
  const score = signal.relevanceScore ?? 0.5

  // Reject criteria
  const isVague = title.length < 15 || body.length < 30
  const isNoise =
    text.includes('dark mode') ||
    text.includes('meme') ||
    text.includes('just curious') ||
    text.includes('quick question')
  const isAlreadyImplemented = text.includes('already') && text.includes('exist')
  const isDuplicateContext = text.includes('same as') || text.includes('duplicate of')

  if (isNoise) {
    return { decision: 'rejected', reason: 'Content appears to be noise or off-topic' }
  }

  if (isAlreadyImplemented || isDuplicateContext) {
    return { decision: 'rejected', reason: 'Signal describes something that already exists or is duplicate' }
  }

  // Defer criteria — has potential but lacks specificity
  const needsMoreDetail =
    (body.length < 50 && title.length < 40) ||
    (!body.includes('would') && !body.includes('should') && !body.includes('could'))

  if (needsMoreDetail && score < 0.6) {
    return { decision: 'deferred', reason: 'Interesting signal but lacks specificity and supporting detail' }
  }

  // Approve criteria — specific, actionable feature request
  const hasClearBenefit =
    body.includes('would be') ||
    body.includes('should support') ||
    body.includes('could we') ||
    body.includes('it would') ||
    (body.length > 100 && score > 0.5)

  const hasSpecificUseCase =
    body.includes('when') ||
    body.includes('use case') ||
    body.includes('scenario') ||
    body.includes('steps to')

  if (hasClearBenefit && hasSpecificUseCase) {
    return { decision: 'approved', reason: 'Specific feature request with clear use case and benefit' }
  }

  if (hasClearBenefit && body.length > 80) {
    return { decision: 'approved', reason: 'Actionable feature request with good detail' }
  }

  if (score > 0.7 && body.length > 50) {
    return { decision: 'approved', reason: 'High-scoring signal with substantive content' }
  }

  // Default to deferred
  return { decision: 'deferred', reason: 'Borderline signal — needs more context to make final decision' }
}

async function run(): Promise<void> {
  const cycleId = `gh-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now()}`
  console.log(`\n=== GITHUB ISSUES RUNNER: ${cycleId} ===\n`)

  const eventBus = new EventBus()
  const storage = new StorageHelper(DATA_DIR)

  // Components
  const adapter = new GitHubIssuesAdapter("microsoft", "vscode", ["feature-request", "enhancement"], 10)
  const reviewQueue = new ReviewQueue(DATA_DIR)
  const themeEngine = new ThemeEngine()
  const oppAssembly = new OpportunityAssembly(eventBus)

  const radarDigest = new RadarDigestConsumer(eventBus, storage)
  const protoBrief = new PrototypeBriefConsumer(eventBus, storage)
  const stitchProject = new StitchProjectConsumer(eventBus, storage)
  const videoBrief = new VideoBriefConsumer(eventBus, storage)
  const jiraDraft = new JiraDraftConsumer(eventBus, storage)

  // Event wiring
  eventBus.on('opportunity.created', async (payload: any) => {
    await protoBrief.process('opportunity.created', payload)
    await stitchProject.process("opportunity.created", payload)
    await jiraDraft.process('opportunity.created', payload)
  })
  eventBus.on('prototypeBrief.created', async (payload: any) => {
    await videoBrief.process('prototypeBrief.created', payload)
  })

  // Ensure templates exist
  const srcDir = path.join(process.cwd(), 'templates', 'prompts')
  const destDir = path.join(DATA_DIR, 'prompts')
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
    if (fs.existsSync(srcDir)) {
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file))
      }
    }
  }

  // ── Step 1: Ingestion ──────────────────────────────────────────────
  console.log('[1] SOURCE INGESTION (GitHubIssuesAdapter — microsoft/vscode)')
  await adapter.connect()
  const rawSignals = await adapter.poll()
  console.log(`    Raw signals: ${rawSignals.length}`)
  rawSignals.forEach(s => {
    const st = (s.rawPayload as any)?.signalType ?? 'unknown'
    const num = (s.rawPayload as any)?.issueNumber ?? ''
    console.log(`    - ${s.id} [#${num}] [${st}] ${(s.rawPayload as any)?.title?.slice(0, 60)}`)
  })

  // ── Step 2: Normalize ──────────────────────────────────────────────
  console.log('\n[2] NORMALIZATION')
  const normalized = rawSignals.map(s => adapter.normalize(s))
  console.log(`    Normalized: ${normalized.length}`)
  ensureDir(path.join(DATA_DIR, 'normalized-signals'))
  for (const sig of normalized) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'normalized-signals', `${sig.id}.json`),
      JSON.stringify(sig, null, 2)
    )
  }

  // ── Step 3: Augment ────────────────────────────────────────────────
  console.log('\n[3] AGENT AUGMENTATION')
  const scored = augment(normalized, cycleId)
  ensureDir(path.join(DATA_DIR, 'scored-signals'))
  console.log(`    Scored: ${scored.length}`)
  for (const sig of scored) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'scored-signals', `${sig.id}.json`),
      JSON.stringify(sig, null, 2)
    )
    console.log(`    - ${sig.id}: score=${sig.relevanceScore.toFixed(2)} cat=${sig.category}`)
  }

  // ── Step 4: Qualification ─────────────────────────────────────────
  console.log('\n[4] QUALIFICATION FILTER')
  const qualified = addQualification(scored)
  console.log(`    Qualified signals:`)
  const counts: Record<string, number> = {}
  for (const sig of qualified) {
    const q = sig.qualification.qualification
    counts[q] = (counts[q] ?? 0) + 1
    const isCommercial = sig.qualification.commercialRelevance ? '✓ COMMERCIAL' : '✗ excluded'
    console.log(`    - ${sig.id}: ${q} — ${isCommercial}`)
    console.log(`      ${sig.qualification.reasoning.slice(0, 80)}...`)
  }
  console.log(`    Summary: ${JSON.stringify(counts)}`)

  // ── Step 5: Enqueue ────────────────────────────────────────────────
  console.log('\n[5] REVIEW QUEUE')
  await reviewQueue.enqueueAll(scored, cycleId)
  const pending = await reviewQueue.getPending()
  console.log(`    Enqueued: ${scored.length}, pending: ${pending.length}`)

  // ── Step 6: Simulated human triage via sub-agent ───────────────────
  console.log('\n[6] SIMULATED HUMAN TRIAGE (sub-agent reads each signal)')
  for (const item of pending) {
    const signal = qualified.find(s => s.id === item.signalId)
    if (!signal) continue

    // Simulate sub-agent reading the signal title/body
    const { decision, reason } = await humanSimulatedTriage(signal, reviewQueue)

    await reviewQueue.triage(item.signalId, decision, 'agent-simulated', reason)
    console.log(`    ${signal.id}: ${decision}`)
    console.log(`      Title: ${signal.title.slice(0, 70)}`)
    console.log(`      Reason: ${reason}`)
  }

  const approved = await reviewQueue.getApproved()
  const rejected = await reviewQueue.getRejected()
  const deferred = await reviewQueue.getDeferred()
  console.log(`\n    Approved: ${approved.length} | Rejected: ${rejected.length} | Deferred: ${deferred.length}`)

  // ── Step 7: Theme clustering ───────────────────────────────────────
  console.log('\n[7] THEME CLUSTERING')
  const approvedSignals = approved
    .map(item => scored.find(s => s.id === item.signalId))
    .filter((s): s is typeof scored[0] => !!s)

  const themes = themeEngine.cluster(approvedSignals, cycleId)
  console.log(`    Themes: ${themes.length}`)
  for (const theme of themes) {
    console.log(`    - ${theme.id}: "${theme.themeTitle}" (${theme.signalIds.length} signals)`)
  }

  // ── Step 8: Opportunity assembly ─────────────────────────────────
  console.log('\n[8] OPPORTUNITY ASSEMBLY')
  const opportunities = await oppAssembly.assemble(themes)
  console.log(`    Opportunities: ${opportunities.length}`)
  for (const opp of opportunities) {
    console.log(`    - ${opp.id}: "${opp.title}"`)
  }

  // ── Step 9: Consumers ────────────────────────────────────────────
  console.log('\n[9] CONSUMERS (opportunity.created events fired above)')

  // ── Step 10: Digest ───────────────────────────────────────────────
  console.log('\n[10] RADAR DIGEST')
  const digest = await radarDigest.generateDigest(cycleId)
  console.log(`    Digest: ${digest?.id ?? 'none'}`)
  if (digest) console.log(`    Summary: ${digest.themeSummary}`)

  // ── Done ──────────────────────────────────────────────────────────
  console.log(`\n=== GITHUB ISSUES RUNNER COMPLETE ===`)
  console.log(`Cycle: ${cycleId}`)
  console.log(`Signals: ${scored.length} | Approved: ${approved.length} | Themes: ${themes.length} | Opps: ${opportunities.length}`)

  // List output files
  console.log('\n--- OUTPUT FILES ---')
  const dirs = [
    'normalized-signals',
    'scored-signals',
    'themes',
    'opportunities',
    'briefs/prototype',
    'digests',
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

  await adapter.disconnect()
}

run().catch(err => { console.error('Runner failed:', err); process.exit(1) })
