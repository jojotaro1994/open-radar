import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { ThemeCandidate } from '../schemas/theme-candidate.js';
import type { PainCard } from '../schemas/pain-card.js';
import type { EvidenceRecord } from '../schemas/evidence-record.js';
import type { Opportunity } from '../schemas/opportunity.js';
import type { ScoredSignal } from '../schemas/scored-signal.js';
import type { Attribution } from '../schemas/attribution.js';
import { EventBus } from '../infrastructure/event-bus.js';

const DATA_DIR = process.env.RADAR_DATA_DIR || path.join(process.cwd(), 'data');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function loadJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

function uuid(): string {
  return crypto.randomUUID();
}

export class OpportunityAssembly {
  private signalCache: Map<string, ScoredSignal> = new Map();
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  loadSignals(signalIds: string[]): void {
    for (const id of signalIds) {
      const file = path.join(DATA_DIR, 'scored-signals', `${id}.json`);
      const signal = loadJson<ScoredSignal>(file);
      if (signal) this.signalCache.set(id, signal);
    }
  }

  async assemble(themes: ThemeCandidate[], intentId: string = 'unknown'): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];

    for (const theme of themes) {
      // Load all signals for this theme
      this.loadSignals(theme.signalIds);
      const signals = theme.signalIds.map(id => this.signalCache.get(id)).filter((s): s is ScoredSignal => !!s);

      // Step 1: Create PainCard
      const avgScore = signals.reduce((sum, s) => sum + s.relevanceScore, 0) / signals.length;
      const severity: PainCard['severity'] = avgScore > 0.7 ? 'high' : avgScore > 0.4 ? 'medium' : 'low';
      const personas = [...new Set(signals.map(s => s.author))];
      const affectedPersona = personas.length === 1 ? personas[0] : `${personas.length} users`;

      const painCard: PainCard = {
        id: `pain-${uuid().slice(0, 8)}`,
        signalIds: theme.signalIds,
        painStatement: theme.themeStatement,
        affectedPersona,
        frequency: signals.length,
        severity,
      };
      saveJson(path.join(DATA_DIR, 'pain-cards', `${painCard.id}.json`), painCard);

      // Step 2: Create EvidenceRecords
      const evidenceIds: string[] = [];
      for (const signal of signals) {
        const evidence: EvidenceRecord = {
          id: `ev-${uuid().slice(0, 8)}`,
          opportunityId: '', // filled below
          signalId: signal.id,
          excerpt: signal.body.length > 150 ? signal.body.slice(0, 150) + '...' : signal.body,
          contributionType: signal.relevanceScore > 0.7 ? 'direct' : 'supporting',
        };
        evidenceIds.push(evidence.id);
        // Save temporarily without opportunityId, we'll update after Opportunity is created
        saveJson(path.join(DATA_DIR, 'evidence', `${evidence.id}.json`), evidence);
      }

      // Step 3: Create Opportunity with attribution (per OpenSpec: use highest-relevance signal's attribution)
      const topSignal = signals.reduce((best, s) =>
        s.relevanceScore > (best?.relevanceScore ?? 0) ? s : best, signals[0]);
      const signalAttr: Partial<Attribution> = topSignal?.attribution ?? {};
      const attribution: Attribution = {
        intentId,
        sourceAdapterId: signalAttr.sourceAdapterId ?? 'unknown',
        modelId: signalAttr.modelId ?? 'unknown',
        analyzedAt: new Date().toISOString(),
      };
      const oppId = `opp-${uuid().slice(0, 8)}`;
      const opportunity: Opportunity = {
        id: oppId,
        themeCandidateId: theme.id,
        painCardIds: [painCard.id],
        evidenceIds,
        title: theme.themeTitle,
        summary: `${theme.themeStatement}\n\nEvidence: ${signals.length} signals, avg relevance ${(avgScore * 100).toFixed(0)}%.`,
        status: 'assembled',
        createdAt: new Date().toISOString(),
        attribution,
      };
      saveJson(path.join(DATA_DIR, 'opportunities', `${oppId}.json`), opportunity);

      // Step 4: Backfill EvidenceRecord.opportunityId
      for (const evId of evidenceIds) {
        const evFile = path.join(DATA_DIR, 'evidence', `${evId}.json`);
        const ev = loadJson<EvidenceRecord>(evFile);
        if (ev) {
          ev.opportunityId = oppId;
          saveJson(evFile, ev);
        }
      }

      opportunities.push(opportunity);
      await this.eventBus.emit('opportunity.created', { opportunityId: oppId, opportunity });
    }

    return opportunities;
  }
}
