/**
 * GitHubFullRunner — Historical experiment runner (deprecated)
 *
 * ⚠️ DEPRECATED: This runner is not maintained and does not reflect current architecture.
 * Active runner: src/orchestrator/riplus-ma-runner.ts
 *
 * Historical purpose: GitHub Issues + Discussions as primary signal sources (pre-Intent design).
 * GitHub is NOT part of riplus-ma Intent. Kept for reference only.
 *
 * Tries:
 *   1. GitHub Issues (with GITHUB_TOKEN if available, else unauth)
 *   2. GitHub Discussions (rate-limit exempt, e.g. vercel/next.js)
 *
 * Run: npx tsx src/orchestrator/github-full-runner.ts
 */

import * as path from 'path'
import * as fs from 'fs'

const DATA_DIR = path.join(process.cwd(), 'data')
process.env.RADAR_DATA_DIR = DATA_DIR

import { EventBus } from '../infrastructure/event-bus.js'
import { StorageHelper } from '../infrastructure/storage-helper.js'
import { GitHubIssuesAdapter } from '../adapters/github-issues-adapter.js'
import { GitHubDiscussionsAdapter } from '../adapters/github-discussions-adapter.js'
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

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function humanSimulatedTriage(
  signal: any,
): Promise<{ decision: 'approved' | 'rejected' | 'deferred'; reason: string }> {
  const title = signal.title ?? ''
  const body = signal.body ?? ''
  const text = `${title} ${body}`.toLowerCase()
  const score = signal.relevanceScore ?? 0.5

  const isVague = title.length < 15 || body.length < 30
  const isNoise =
    text.includes('dark mode') ||
    text.includes('meme') ||
    text.includes('just curious') ||
    text.includes('quick question') ||
    text.includes('off topic')
  const isAlreadyImplemented = text.includes('already') && text.includes('exist')
  const isDuplicateContext = text.includes('same as') || text.includes('duplicate of')

  if (isNoise) return { decision: 'rejected', reason: 'Content appears to be noise or off-topic' }
  if (isAlreadyImplemented || isDuplicateContext) {
    return { decision: 'rejected', reason: 'Signal describes something already existing or duplicate' }
  }

  const needsMoreDetail =
    (body.length < 50 && title.length < 40) ||
    (!body.includes('would') && !body.includes('should') && !body.includes('could'))

  if (needsMoreDetail && score < 0.6) {
    return { decision: 'deferred', reason: 'Interesting but lacks specificity and supporting detail' }
  }

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

  return { decision: 'deferred', reason: 'Borderline signal — needs more context to make final decision' }
}

async function run(): Promise<void> {
  const cycleId = `ghfull-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now()}`
  console.log(`\n=== GITHUB FULL RUNNER: ${cycleId} ===`)
  console.log(`Token available: ${!!GITHUB_TOKEN}\n`)

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

  eventBus.on('opportunity.created', async (payload: any) => {
    await protoBrief.process('opportunity.created', payload)
    await stitchProject.process("opportunity.created", payload)
    await jiraDraft.process('opportunity.created', payload)
  })
  eventBus.on('prototypeBrief.created', async (payload: any) => {
    await videoBrief.process('prototypeBrief.created', payload)
  })

  ensureDir(path.join(DATA_DIR, 'prompts'))
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

  // ── Step 1: Try GitHub Issues ───────────────────────────────────
  console.log('[1] SOURCE INGESTION')
  let rawSignals: any[] = []
  let issuesSource = ""
  let issuesUsedMock = false

  const issuesAdapter = new GitHubIssuesAdapter("microsoft", "vscode", ["feature-request", "enhancement"], 10)
  await issuesAdapter.connect()
  const issuesSignals = await issuesAdapter.poll()
  issuesUsedMock = (issuesAdapter as any).useFallback === true

  if (issuesSignals.length > 0 && !issuesUsedMock) {
    rawSignals = issuesSignals
    issuesSource = `GitHub Issues (microsoft/vscode) — ${issuesSignals.length} signals`
    console.log(`    Using: ${issuesSource}`)
  } else {
    console.log(`    GitHub Issues: ${issuesSignals.length} signals (${issuesUsedMock ? 'MOCK FALLBACK' : 'empty/rate-limited'})`)

    // ── Step 2: Try GitHub Discussions ────────────────────────────
    console.log('\n[1b] GITHUB DISCUSSIONS (vercel/next.js Ideas category)')
    const discussionsAdapter = new GitHubDiscussionsAdapter("vercel", "next.js", 20)
    await discussionsAdapter.connect()
    const discussionSignals = await discussionsAdapter.poll()
    await discussionsAdapter.disconnect()

    if (discussionSignals.length > 0) {
      rawSignals = discussionSignals
      issuesSource = `GitHub Discussions (vercel/next.js) — ${discussionSignals.length} signals`
      console.log(`    Using: ${issuesSource}`)
    } else {
      console.log(`    GitHub Discussions: 0 signals`)
      console.log('\n    No signals available from any GitHub source.')
      console.log('    If this is unexpected, check:')
      console.log('    - GitHub token available? (GITHUB_TOKEN env var)')
      console.log('    - Rate limit: https://api.github.com/rate_limit')
    }
  }

  await issuesAdapter.disconnect()

  if (rawSignals.length === 0) {
    console.log('\n=== NO SIGNALS — ABORTING ===')
    return
  }

  console.log(`\n    Total signals: ${rawSignals.length}`)
  rawSignals.forEach(s => {
    const st = (s.rawPayload as any)?.signalType ?? 'unknown'
    const num = (s.rawPayload as any)?.issueNumber ?? (s.rawPayload as any)?.discussionNumber ?? ''
    const prefix = num ? `#${num} ` : ''
    console.log(`    - ${s.id} [${st}] ${prefix}${(s.rawPayload as any)?.title?.slice(0, 55)}`)
  })

  // ── Step 2: Normalize ───────────────────────────────────────────
  console.log('\n[2] NORMALIZATION')
  let normalized: any[] = []
  if (issuesSource.includes('Issues')) {
    normalized = rawSignals.map((s: any) => issuesAdapter.normalize(s))
  } else {
    const discAdapter = new GitHubDiscussionsAdapter()
    normalized = rawSignals.map((s: any) => discAdapter.normalize(s))
  }
  console.log(`    Normalized: ${normalized.length}`)
  ensureDir(path.join(DATA_DIR, 'normalized-signals'))
  for (const sig of normalized) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'normalized-signals', `${sig.id}.json`),
      JSON.stringify(sig, null, 2)
    )
  }

  // ── Step 3: Augment ─────────────────────────────────────────────
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

  // ── Step 4: Qualification ───────────────────────────────────────
  console.log('\n[4] QUALIFICATION FILTER')
  const qualified = addQualification(scored)
  const counts: Record<string, number> = {}
  for (const sig of qualified) {
    const q = sig.qualification.qualification
    counts[q] = (counts[q] ?? 0) + 1
    const isComm = sig.qualification.commercialRelevance ? 'COMMERCIAL' : 'excluded'
    console.log(`    - ${sig.id}: ${q} [${isComm}]`)
    console.log(`      ${sig.qualification.reasoning.slice(0, 80)}...`)
  }
  console.log(`    Summary: ${JSON.stringify(counts)}`)

  // ── Step 5: Enqueue ─────────────────────────────────────────────
  console.log('\n[5] REVIEW QUEUE')
  await reviewQueue.enqueueAll(scored, cycleId)
  const pending = await reviewQueue.getPending()
  console.log(`    Enqueued: ${scored.length}, pending: ${pending.length}`)

  // ── Step 6: Simulated human triage ───────────────────────────────
  console.log('\n[6] SIMULATED HUMAN TRIAGE')
  for (const item of pending) {
    const signal = qualified.find((s: any) => s.id === item.signalId)
    if (!signal) continue
    const { decision, reason } = await humanSimulatedTriage(signal)
    await reviewQueue.triage(item.signalId, decision, 'agent-simulated', reason)
    console.log(`    ${decision.toUpperCase()}: ${signal.title.slice(0, 65)}`)
    console.log(`      Reason: ${reason}`)
  }

  const approved = await reviewQueue.getApproved()
  const rejected = await reviewQueue.getRejected()
  const deferred = await reviewQueue.getDeferred()
  console.log(`\n    Approved: ${approved.length} | Rejected: ${rejected.length} | Deferred: ${deferred.length}`)

  // ── Step 7: Theme clustering ────────────────────────────────────
  console.log('\n[7] THEME CLUSTERING')
  const approvedSignals = approved
    .map((item: any) => scored.find((s: any) => s.id === item.signalId))
    .filter((s: any): s is any => !!s)

  const themes = themeEngine.cluster(approvedSignals, cycleId)
  console.log(`    Themes: ${themes.length}`)
  for (const theme of themes) {
    console.log(`    - ${theme.id}: "${theme.themeTitle}" (${theme.signalIds.length} signals)`)
  }

  // ── Step 8: Opportunity assembly ────────────────────────────────
  console.log('\n[8] OPPORTUNITY ASSEMBLY')
  const opportunities = await oppAssembly.assemble(themes)
  console.log(`    Opportunities: ${opportunities.length}`)
  for (const opp of opportunities) {
    console.log(`    - ${opp.id}: "${opp.title}"`)
  }

  // ── Step 9: Consumers ────────────────────────────────────────────
  console.log('\n[9] CONSUMERS')

  // ── Step 10: Digest ─────────────────────────────────────────────
  console.log('\n[10] RADAR DIGEST')
  const digest = await radarDigest.generateDigest(cycleId)
  if (digest) {
    console.log(`    Digest: ${digest.id}`)
    console.log(`    Summary: ${digest.themeSummary}`)
  }

  // ── Done ──────────────────────────────────────────────────────────
  console.log(`\n=== GITHUB FULL RUNNER COMPLETE ===`)
  console.log(`Cycle: ${cycleId}`)
  console.log(`Source: ${issuesSource}`)
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
}

run().catch(err => { console.error('Runner failed:', err); process.exit(1) })
