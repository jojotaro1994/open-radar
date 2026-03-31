import * as path from 'path';
import * as fs from 'fs';
import type { ScoredSignal } from '../schemas/scored-signal.js';
import type { ThemeCandidate } from '../schemas/theme-candidate.js';

const DATA_DIR = process.env.RADAR_DATA_DIR || path.join(process.cwd(), 'data');

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'to', 'for', 'of', 'and', 'in', 'on',
  'with', 'we', 'our', 'it', 'this', 'that', 'be', 'have', 'has', 'was',
  'were', 'from', 'as', 'by', 'at', 'or', 'when', 'which', 'you', 'your',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
  // Extended noise words common in software feedback
  'add', 'new', 'use', 'used', 'using', 'like', 'would', 'could', 'should',
  'feature', 'request', 'want', 'need', 'needs', 'also', 'get', 'make',
  'way', 'thing', 'things', 'something', 'everything', 'lot', 'many',
  'much', 'really', 'just', 'know', 'see', 'think', 'want', 'well',
  'even', 'still', 'already', 'able', 'allow', 'let', 'want', 'try',
  'please', 'maybe', 'perhaps', 'might', 'good', 'great', 'best',
]);

const NOUN_NOISE = new Set([
  'command', 'option', 'setting', 'settings', 'feature', 'function', 'ability',
  'support', 'way', 'work', 'works', 'working', 'worked', 'app', 'ui',
  'tool', 'tools', 'software', 'application', 'editor', 'ide',
  'mode', 'show', 'find', 'search', 'searching', 'browser', 'integration',
  'issues', 'issue', 'thread', 'page', 'view', 'viewer', 'panel', 'menu',
  'config', 'configuration', 'profile', 'profiles',
]);

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Extract significant words from text, filtering out stopwords and generic noun noise.
 */
function extractWords(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w) && !NOUN_NOISE.has(w));
}

function sigWords(text: string): Set<string> {
  return new Set(extractWords(text));
}

/**
 * Score a word's specificity using IDF-like logic:
 * Words appearing in very few signals are more specific and more valuable for clustering.
 */
function computeWordIdf(signals: { words: Set<string> }[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const s of signals) {
    for (const w of s.words) {
      docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
    }
  }
  const n = signals.length;
  const idf = new Map<string, number>();
  for (const [w, df] of docFreq) {
    // Higher IDF = more specific (appears in fewer docs)
    idf.set(w, Math.log(n / (df + 1)) + 1);
  }
  return idf;
}

/**
 * Pick the best theme title from cluster signals:
 * - Use the highest-scoring signal's title if it's specific (>= 4 words)
 * - Otherwise derive a title from the most specific shared words (IDF-weighted)
 */
function buildThemeTitle(
  clusterSignals: ScoredSignal[],
  topSignal: ScoredSignal,
  clusterWords: string[],
  idf: Map<string, number>
): string {
  // If the top signal has a specific title (4+ words, not generic), use it
  const titleWords = topSignal.title.split(/\s+/).filter(w => w.length > 2);
  const isSpecificTitle = titleWords.length >= 4 &&
    !['feature request', 'add feature', 'wish list', 'enhancement'].some(
      g => topSignal.title.toLowerCase().includes(g));

  if (isSpecificTitle) {
    // Clean and cap at 60 chars
    const cleaned = topSignal.title.replace(/^(feature request|enhancement|wishlist|proposal):\s*/i, '');
    return cleaned.slice(0, 60);
  }

  // Fall back: build title from most IDF-specific words
  const scoredWords = clusterWords
    .map(w => ({ word: w, score: idf.get(w) ?? 1 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.word);

  if (scoredWords.length === 0) return `Theme: ${topSignal.title.slice(0, 50)}`;
  return 'Want: ' + scoredWords.join(' + ');
}

export class ThemeEngine {
  cluster(signals: ScoredSignal[], cycleId: string): ThemeCandidate[] {
    if (signals.length === 0) return [];

    // Build keyword sets for each signal (title words weighted higher)
    const signalData: { id: string; title: string; body: string; words: Set<string>; score: number }[] =
      signals.map(s => ({
        id: s.id,
        title: s.title,
        body: s.body,
        words: sigWords(`${s.title} ${s.title} ${s.body}`), // title counted twice for weight
        score: s.relevanceScore,
      }));

    // Compute IDF for word specificity
    const idf = computeWordIdf(signalData);

    // Threshold for clustering: require meaningful shared words (IDF-weighted overlap)
    // Balanced: harder to merge than 0.05 but easier than original 0.08
    const MIN_SHARED_IDF_WORDS = 2;
    const MIN_JACCARD = 0.06;        // was 0.08

    const assigned = new Set<string>();
    const clusters: { ids: string[]; sharedWords: string[] }[] = [];

    for (let i = 0; i < signalData.length; i++) {
      if (assigned.has(signalData[i].id)) continue;

      const clusterIds = [signalData[i].id];
      const clusterWords = new Set<string>();
      // Track cumulative IDF score of shared words
      let cumulativeIdf = 0;
      assigned.add(signalData[i].id);
      for (const w of signalData[i].words) {
        clusterWords.add(w);
        cumulativeIdf += idf.get(w) ?? 1;
      }

      let merged = true;
      while (merged) {
        merged = false;
        for (let j = i + 1; j < signalData.length; j++) {
          if (assigned.has(signalData[j].id)) continue;

          // Compute Jaccard similarity
          const unionSize = new Set([...clusterWords, ...signalData[j].words]).size;
          const intersection = [...signalData[j].words].filter(w => clusterWords.has(w));
          const jaccard = intersection.length / unionSize;

          // Compute shared IDF score
          const sharedIdf = intersection.reduce((sum, w) => sum + (idf.get(w) ?? 1), 0);
          const avgIdf = sharedIdf / Math.max(intersection.length, 1);

          // Cluster if Jaccard is decent OR at least MIN_SHARED_IDF_WORDS high-specificity words in common
          if (jaccard >= MIN_JACCARD || (intersection.length >= MIN_SHARED_IDF_WORDS && avgIdf >= 1.5)) {
            clusterIds.push(signalData[j].id);
            intersection.forEach(w => clusterWords.add(w));
            cumulativeIdf += sharedIdf;
            assigned.add(signalData[j].id);
            merged = true;
          }
        }
      }

      clusters.push({ ids: clusterIds, sharedWords: [...clusterWords] });
    }

    // Assign unassigned signals as singletons
    for (const s of signalData) {
      if (!assigned.has(s.id)) {
        clusters.push({ ids: [s.id], sharedWords: [...sigWords(`${s.title} ${s.body}`)] });
      }
    }

    // Build ThemeCandidates with improved title generation
    const candidates: ThemeCandidate[] = clusters.map((cluster, idx) => {
      const themeId = `theme-${cycleId}-${String(idx + 1).padStart(3, '0')}`;
      const clusterSignals = signals.filter(s => cluster.ids.includes(s.id));
      const topSignal = clusterSignals.reduce((best, s) =>
        s.relevanceScore > (best?.relevanceScore ?? 0) ? s : best, clusterSignals[0]);

      const themeTitle = buildThemeTitle(clusterSignals, topSignal, cluster.sharedWords, idf);

      const candidate: ThemeCandidate = {
        id: themeId,
        signalIds: cluster.ids,
        themeTitle,
        themeStatement: topSignal
          ? (topSignal.body.length > 120
              ? topSignal.body.slice(0, 120) + '...'
              : topSignal.body)
          : `Theme from ${cluster.ids.length} signals`,
        status: 'approved',
        cycleId,
      };

      ensureDir(path.join(DATA_DIR, 'themes'));
      saveJson(path.join(DATA_DIR, 'themes', `${themeId}.json`), candidate);
      return candidate;
    });

    return candidates;
  }
}
