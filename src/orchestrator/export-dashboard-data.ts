/**
 * export-dashboard-data.ts
 *
 * Scans data/ directory and produces a single dashboard-data.json
 * that the viewer/index.html can fetch and render.
 *
 * Run after demo:  node dist/orchestrator/export-dashboard-data.js
 *
 * Output: data/dashboard-data.json
 */

import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = process.env.RADAR_DATA_DIR || path.join(process.cwd(), 'data');
const OUT_FILE = path.join(DATA_DIR, 'dashboard-data.json');

// ── helpers ─────────────────────────────────────────────────────────────────

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

async function listFiles(dir: string, ext = '.json'): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith(ext))
      .map(e => e.name);
  } catch {
    return [];
  }
}

async function readDirJson<T>(dir: string): Promise<Record<string, T>> {
  const files = await listFiles(dir);
  const result: Record<string, T> = {};
  for (const file of files) {
    const val = await readJsonFile<T>(path.join(dir, file));
    if (val !== null) {
      const key = file.replace(/\.json$/, '');
      result[key] = val;
    }
  }
  return result;
}

// ── main export ──────────────────────────────────────────────────────────────

interface QueueItem {
  signalId: string;
  status: 'pending' | 'approved' | 'rejected' | 'deferred';
  cycleId: string;
  enqueuedAt: string;
  triage?: {
    decision: string;
    reviewedBy: string;
    reviewedAt: string;
    reason?: string;
  };
  scoredSignal?: any; // lightweight copy for display
}

interface DashboardData {
  generatedAt: string;
  cycleId: string | null;
  meta: {
    intentId?: string;   // from latest cycle's intent config
  };
  stats: {
    totalSignals: number;
    approved: number;
    rejected: number;
    deferred: number;
    pending: number;
    themes: number;
    opportunities: number;
    prototypeBriefs: number;
    videoBriefs: number;
    jiraDrafts: number;
  };
  queue: QueueItem[];
  themes: Record<string, any>;
  opportunities: Record<string, any>;
  painCards: Record<string, any>;
  prototypeBriefs: Record<string, any>;
  videoBriefs: Record<string, any>;
  jiraDrafts: Record<string, any>;
  digest: any | null;
  interactionRound: {
    approvedSignal: any | null;
    deferredSignal: any | null;
    rejectedSignal: any | null;
    opportunities: any[];
  };
  artifactMap: {
    reviewQueue: string;
    themes: string;
    opportunities: string;
    painCards: string;
    evidence: string;
    prototypeBriefs: string;
    videoBriefs: string;
    jiraDrafts: string;
    digests: string;
  };
}

async function exportDashboardData(): Promise<void> {
  const queueDir = path.join(DATA_DIR, 'review-queue');
  const themesDir = path.join(DATA_DIR, 'themes');
  const oppsDir = path.join(DATA_DIR, 'opportunities');
  const painCardsDir = path.join(DATA_DIR, 'pain-cards');
  const evidenceDir = path.join(DATA_DIR, 'evidence');
  const protoBriefsDir = path.join(DATA_DIR, 'briefs', 'prototype');
  const videoBriefsDir = path.join(DATA_DIR, 'briefs', 'video');
  const jiraDraftsDir = path.join(DATA_DIR, 'jira-drafts');
  const digestsDir = path.join(DATA_DIR, 'digests');

  // ── Queue items ────────────────────────────────────────────────────────────
  const signalIds = await listDirs(queueDir);
  const queue: QueueItem[] = [];
  let latestCycleId: string | null = null;

  for (const signalId of signalIds) {
    const signalDir = path.join(queueDir, signalId);
    const [statusJson, metaJson, triageJson, scoredJson] = await Promise.all([
      readJsonFile<{ status: string }>(path.join(signalDir, 'status.json')),
      readJsonFile<{ signalId: string; cycleId: string; enqueuedAt: string }>(path.join(signalDir, 'meta.json')),
      readJsonFile<{ decision: string; reviewedBy: string; reviewedAt: string; reason?: string }>(path.join(signalDir, 'triage.json')),
      readJsonFile<any>(path.join(DATA_DIR, 'scored-signals', `${signalId}.json`)),
    ]);

    if (!metaJson) continue;

    const item: QueueItem = {
      signalId: metaJson.signalId,
      status: (statusJson?.status || 'pending') as QueueItem['status'],
      cycleId: metaJson.cycleId,
      enqueuedAt: metaJson.enqueuedAt,
    };

    if (triageJson) {
      item.triage = {
        decision: triageJson.decision,
        reviewedBy: triageJson.reviewedBy,
        reviewedAt: triageJson.reviewedAt,
        reason: triageJson.reason,
      };
    }

    if (scoredJson) {
      item.scoredSignal = {
        id: scoredJson.id,
        source: scoredJson.source,
        title: scoredJson.title,
        category: scoredJson.category,
        relevanceScore: scoredJson.relevanceScore,
        isDuplicate: scoredJson.isDuplicate,
      };
    }

    queue.push(item);

    if (!latestCycleId || metaJson.cycleId > latestCycleId) {
      latestCycleId = metaJson.cycleId;
    }
  }

  // ── Themes ─────────────────────────────────────────────────────────────────
  const themes = await readDirJson<any>(themesDir);

  // ── Opportunities ──────────────────────────────────────────────────────────
  const opportunities = await readDirJson<any>(oppsDir);

  // ── PainCards ──────────────────────────────────────────────────────────────
  const painCards = await readDirJson<any>(painCardsDir);

  // ── Evidence ────────────────────────────────────────────────────────────────
  const evidence = await readDirJson<any>(evidenceDir);

  // ── Briefs & drafts ────────────────────────────────────────────────────────
  const prototypeBriefs = await readDirJson<any>(protoBriefsDir);
  const videoBriefs = await readDirJson<any>(videoBriefsDir);
  const jiraDrafts = await readDirJson<any>(jiraDraftsDir);

  // ── Digest (determines the authoritative cycle for this export) ──────────────
  const digestFiles = await listFiles(digestsDir);
  let digest: any | null = null;
  if (digestFiles.length > 0) {
    // Use most recent digest by filename (timestamp suffix)
    digestFiles.sort();
    const latest = digestFiles[digestFiles.length - 1];
    digest = await readJsonFile<any>(path.join(digestsDir, latest));
  }

  // ── Filter to latest cycle ─────────────────────────────────────────────────
  // Use the most recent cycle that has data (queue, themes, or digest)
  // Prefer queue cycleId as primary, then themes, then digest
  const queueCycleIds = [...new Set(queue.map(q => q.cycleId))];
  const themeCycleIds = [...new Set(Object.values(themes).map((t: any) => t.cycleId))];
  const allCycleIds = [...queueCycleIds, ...themeCycleIds, latestCycleId].filter(Boolean);
  const sortedCycleIds = allCycleIds.sort().reverse();
  latestCycleId = sortedCycleIds[0] ?? latestCycleId;

  // Filter queue to latest cycle only
  const filteredQueue = queue.filter(item => item.cycleId === latestCycleId);

  // Filter themes to latest cycle only
  const filteredThemes: Record<string, any> = {};
  for (const [k, v] of Object.entries(themes)) {
    if ((v as any).cycleId === latestCycleId) filteredThemes[k] = v;
  }

  // Filter opportunities: keep those whose themeCandidateId is in filteredThemes
  const themeIds = new Set(Object.keys(filteredThemes));
  const filteredOpps: Record<string, any> = {};
  for (const [k, v] of Object.entries(opportunities)) {
    if (themeIds.has((v as any).themeCandidateId)) filteredOpps[k] = v;
  }

  // Filter painCards by themeCandidateId in filteredThemes
  const filteredPainCards: Record<string, any> = {};
  for (const [k, v] of Object.entries(painCards)) {
    if (themeIds.has((v as any).themeCandidateId)) filteredPainCards[k] = v;
  }

  // Filter evidence by opportunityId in filteredOpps
  const oppIds = new Set(Object.keys(filteredOpps));
  const filteredEvidence: Record<string, any> = {};
  for (const [k, v] of Object.entries(evidence)) {
    if (oppIds.has((v as any).opportunityId)) filteredEvidence[k] = v;
  }

  // Filter briefs/drafts by opportunityId in filteredOpps
  const filteredProtoBriefs: Record<string, any> = {};
  for (const [k, v] of Object.entries(prototypeBriefs)) {
    if (oppIds.has((v as any).opportunityId)) filteredProtoBriefs[k] = v;
  }
  const filteredVideoBriefs: Record<string, any> = {};
  const protoBriefIds = new Set(Object.keys(filteredProtoBriefs));
  for (const [k, v] of Object.entries(videoBriefs)) {
    if (protoBriefIds.has((v as any).prototypeBriefId)) filteredVideoBriefs[k] = v;
  }
  const filteredJiraDrafts: Record<string, any> = {};
  for (const [k, v] of Object.entries(jiraDrafts)) {
    if (oppIds.has((v as any).opportunityId)) filteredJiraDrafts[k] = v;
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = {
    totalSignals: filteredQueue.length,
    approved: filteredQueue.filter((q: any) => q.status === 'approved').length,
    rejected: filteredQueue.filter((q: any) => q.status === 'rejected').length,
    deferred: filteredQueue.filter((q: any) => q.status === 'deferred').length,
    pending: filteredQueue.filter((q: any) => q.status === 'pending').length,
    themes: Object.keys(filteredThemes).length,
    opportunities: Object.keys(filteredOpps).length,
    prototypeBriefs: Object.keys(filteredProtoBriefs).length,
    videoBriefs: Object.keys(filteredVideoBriefs).length,
    jiraDrafts: Object.keys(filteredJiraDrafts).length,
  };

  // ── Interaction round ──────────────────────────────────────────────────────
  const approvedItems = filteredQueue.filter((q: any) => q.status === 'approved');
  const deferredItems = filteredQueue.filter((q: any) => q.status === 'deferred');
  const rejectedItems = filteredQueue.filter((q: any) => q.status === 'rejected');

  const approvedSignal = approvedItems[0]?.scoredSignal ?? null;
  const deferredSignal = deferredItems[0]?.scoredSignal ?? null;
  const rejectedSignal = rejectedItems[0]?.scoredSignal ?? null;

  const interactionRound = {
    approvedSignal,
    deferredSignal,
    rejectedSignal,
    opportunities: Object.values(filteredOpps),
  };

  // ── Artifact map ───────────────────────────────────────────────────────────
  const artifactMap = {
    reviewQueue: 'data/review-queue/',
    themes: 'data/themes/',
    opportunities: 'data/opportunities/',
    painCards: 'data/pain-cards/',
    evidence: 'data/evidence/',
    prototypeBriefs: 'data/briefs/prototype/',
    videoBriefs: 'data/briefs/video/',
    jiraDrafts: 'data/jira-drafts/',
    digests: 'data/digests/',
  };

  // ── Write output ───────────────────────────────────────────────────────────
  // Infer intentId from the most recently created opportunity
  const allOpps = Object.values(opportunities) as any[];
  const latestOpp = allOpps.length > 0
    ? allOpps.reduce(( newest, o ) => (o.createdAt ?? '') > (newest.createdAt ?? '') ? o : newest, allOpps[0])
    : null;
  const intentId = latestOpp?.attribution?.intentId ?? undefined;

  const dashboardData: DashboardData = {
    generatedAt: new Date().toISOString(),
    cycleId: latestCycleId,
    meta: { intentId },
    stats,
    queue: filteredQueue,
    themes: filteredThemes,
    opportunities: filteredOpps,
    painCards: filteredPainCards,
    prototypeBriefs: filteredProtoBriefs,
    videoBriefs: filteredVideoBriefs,
    jiraDrafts: filteredJiraDrafts,
    digest,
    interactionRound,
    artifactMap,
  };

  await fs.promises.writeFile(OUT_FILE, JSON.stringify(dashboardData, null, 2), 'utf-8');
  console.log(`[export-dashboard-data] Wrote ${OUT_FILE}`);
  console.log(`  cycleId=${latestCycleId}`);
  console.log(`  signals=${stats.totalSignals} approved=${stats.approved} rejected=${stats.rejected} deferred=${stats.deferred}`);
  console.log(`  themes=${stats.themes} opps=${stats.opportunities}`);
  console.log(`  prototypeBriefs=${stats.prototypeBriefs} videoBriefs=${stats.videoBriefs} jiraDrafts=${stats.jiraDrafts}`);
}

exportDashboardData().catch(err => { console.error(err); process.exit(1); });
