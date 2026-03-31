/**
 * Demo Runner — Historical walkthrough (deprecated)
 *
 * ⚠️ DEPRECATED: This runner is not maintained and does not reflect current architecture.
 * Active runner: src/orchestrator/riplus-ma-runner.ts
 *
 * Historical purpose: End-to-end walkthrough of the pre-Intent Prototype Radar pipeline.
 * Not part of current riplus-ma Intent. Kept for reference only.
 *
 * Run with: npx ts-node src/orchestrator/demo.ts
 */

import * as path from 'path';
import * as fs from 'fs';

// Set data directory before any imports that use it
const DATA_DIR = path.join(process.cwd(), 'data');
process.env.RADAR_DATA_DIR = DATA_DIR;

// Ensure prompt templates exist in data/prompts/ (required by consumers)
function ensureTemplates() {
  const srcDir = path.join(process.cwd(), 'templates', 'prompts');
  const destDir = path.join(DATA_DIR, 'prompts');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
}

import { EventBus } from '../infrastructure/event-bus.js';
import { StorageHelper } from '../infrastructure/storage-helper.js';
import { MockSourceAdapter } from '../adapters/mock-source-adapter.js';
import { ReviewQueue } from '../engine/review-queue.js';
import { ThemeEngine } from '../engine/theme-engine.js';
import { OpportunityAssembly } from '../engine/opportunity-assembly.js';
import { augment } from '../filters/agent-filter.js';
import { RadarDigestConsumer } from '../consumers/radar-digest.js';
import { PrototypeBriefConsumer } from "../consumers/prototype-brief.js"
import { StitchProjectConsumer } from "../consumers/stitch-project.js"
import { VideoBriefConsumer } from '../consumers/video-brief.js';
import { JiraDraftConsumer } from '../consumers/jira-draft.js';

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function runDemo(): Promise<void> {
  const cycleId = `demo-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now()}`;
  console.log(`\n=== PROTOTYPE RADAR DEMO: ${cycleId} ===\n`);

  // Ensure templates are in place before consumers run
  ensureTemplates();

  // Initialize infrastructure
  const eventBus = new EventBus();
  const storage = new StorageHelper(DATA_DIR);

  // Init components
  const adapter = new MockSourceAdapter();
  const reviewQueue = new ReviewQueue(DATA_DIR);
  const themeEngine = new ThemeEngine();
  const oppAssembly = new OpportunityAssembly(eventBus);

  // Consumers
  const radarDigest = new RadarDigestConsumer(eventBus, storage);
  const protoBrief = new PrototypeBriefConsumer(eventBus, storage);
  const stitchProject = new StitchProjectConsumer(eventBus, storage)
  const videoBrief = new VideoBriefConsumer(eventBus, storage);
  const jiraDraft = new JiraDraftConsumer(eventBus, storage);

  // Wire events: opportunity.created -> ProtoBrief + JiraDraft
  eventBus.on('opportunity.created', async (payload: any) => {
    await protoBrief.process('opportunity.created', payload)
    await stitchProject.process('opportunity.created', payload);
    await jiraDraft.process('opportunity.created', payload);
  });

  // Wire: prototypeBrief.created -> VideoBrief (chain after ProtoBrief)
  eventBus.on('prototypeBrief.created', async (payload: any) => {
    await videoBrief.process('prototypeBrief.created', payload);
  });

  // ---- STEP 1: Source Ingestion ----
  console.log('[1] SOURCE INGESTION');
  await adapter.connect();
  const rawSignals = await adapter.poll();
  console.log(`    Raw signals: ${rawSignals.length}`);

  // ---- STEP 2: Normalization ----
  console.log('\n[2] NORMALIZATION');
  const normalized = rawSignals.map(s => adapter.normalize(s));
  console.log(`    Normalized: ${normalized.length}`);
  for (const sig of normalized) {
    ensureDir(path.join(DATA_DIR, 'normalized-signals'));
    fs.writeFileSync(path.join(DATA_DIR, 'normalized-signals', `${sig.id}.json`), JSON.stringify(sig, null, 2));
  }

  // ---- STEP 3: Agent Augmentation ----
  console.log('\n[3] AGENT AUGMENTATION');
  const scored = augment(normalized, cycleId);
  console.log(`    Scored: ${scored.length}`);
  for (const sig of scored) {
    ensureDir(path.join(DATA_DIR, 'scored-signals'));
    fs.writeFileSync(path.join(DATA_DIR, 'scored-signals', `${sig.id}.json`), JSON.stringify(sig, null, 2));
    console.log(`    - ${sig.id}: score=${sig.relevanceScore.toFixed(2)} cat=${sig.category} dup=${sig.isDuplicate}`);
  }

  // ---- STEP 4: Enqueue ----
  console.log('\n[4] REVIEW QUEUE');
  await reviewQueue.enqueueAll(scored, cycleId);
  const pending = await reviewQueue.getPending();
  console.log(`    Enqueued: ${scored.length} signals, pending: ${pending.length}`);

  // ---- STEP 5: Simulated Triage ----
  console.log('\n[5] SIMULATED TRIAGE');
  for (const item of pending) {
    const signal = scored.find(s => s.id === item.signalId);
    if (!signal) continue;

    let decision: 'approved' | 'rejected' | 'deferred';
    if (signal.category === 'noise') {
      decision = 'rejected';  // noise: reject
    } else if (signal.isDuplicate) {
      decision = 'deferred';  // duplicates: defer for human review
    } else if (signal.relevanceScore > 0.40) {
      decision = 'approved';  // decent score: approve
    } else {
      decision = 'deferred';  // low score: defer
    }

    await reviewQueue.triage(item.signalId, decision, 'demo-reviewer',
      decision === 'rejected' ? 'Not relevant' : undefined);
    console.log(`    ${signal.id}: ${decision} (score=${signal.relevanceScore.toFixed(2)})`);
  }

  const approved = await reviewQueue.getApproved();
  console.log(`    Approved: ${approved.length}`);

  // ---- STEP 6: Theme Clustering ----
  console.log('\n[6] THEME CLUSTERING');
  const approvedSignals = approved
    .map(item => scored.find(s => s.id === item.signalId))
    .filter((s): s is typeof scored[0] => !!s);

  const themes = themeEngine.cluster(approvedSignals, cycleId);
  console.log(`    ThemeCandidates: ${themes.length}`);
  for (const theme of themes) {
    console.log(`    - ${theme.id}: "${theme.themeTitle}" (${theme.signalIds.length} signals)`);
  }

  // ---- STEP 7: Opportunity Assembly ----
  console.log('\n[7] OPPORTUNITY ASSEMBLY');
  const opportunities = await oppAssembly.assemble(themes);
  console.log(`    Opportunities: ${opportunities.length}`);
  for (const opp of opportunities) {
    console.log(`    - ${opp.id}: "${opp.title}"`);
  }

  // ---- STEP 8: Consumers (opportunity.created events fired inside oppAssembly.assemble) ----
  console.log('\n[8] CONSUMERS (triggered by opportunity.created events above)');

  // ---- STEP 9: Digest ----
  console.log('\n[9] RADAR DIGEST');
  const digest = await radarDigest.generateDigest(cycleId);
  console.log(`    Digest: ${digest.id}`);
  console.log(`    Summary: ${digest.themeSummary}`);

  // ---- DONE ----
  console.log(`\n=== DEMO COMPLETE ===`);
  console.log(`Cycle ID: ${cycleId}`);
  console.log(`Signals: ${scored.length} | Approved: ${approved.length} | Themes: ${themes.length} | Opps: ${opportunities.length}`);
  console.log(`\nArtifacts:`);
  console.log(`  data/opportunities/: ${opportunities.map(o => o.id).join(', ')}`);
  console.log(`  data/digests/: ${digest.id}`);
  console.log(`  data/briefs/prototype/: pb-*.json`);
  console.log(`  data/briefs/video/: vb-*.json`);
  console.log(`  data/jira-drafts/: jira-*.json`);

  await adapter.disconnect();
}

runDemo().catch(err => { console.error('Demo failed:', err); process.exit(1); });
