/**
 * ConfluenceAdapter
 *
 * Fetches pages from a configured Confluence space.
 * Uses Atlassian REST API v3 with Basic Auth.
 */

import type { SourceAdapter, RawSignal, NormalizedSignal, AdapterCapabilities } from './source-adapter.js';

const CONFLUENCE_BASE_URL = process.env.CONFLUENCE_BASE_URL ?? 'https://radicadev.atlassian.net/wiki';
const CONFLUENCE_EMAIL = process.env.CONFLUENCE_EMAIL ?? process.env.RR_JIRA_EMAIL;
const CONFLUENCE_API_TOKEN = process.env.CONFLUENCE_API_TOKEN ?? process.env.RR_JIRA_API_TOKEN;
const CONFLUENCE_SPACE_KEY = process.env.CONFLUENCE_SPACE_KEY ?? 'RR';

interface ConfluencePage {
  id: string;
  title: string;
  body: {
    storage: {
      value: string;
      representation: string;
    };
  };
  createdDate: string;
  lastModified: string;
  creator: {
    displayName: string;
  };
  labels: Array<{ name: string }>;
  _links: {
    webui: string;
  };
}

interface ConfluenceSearchResponse {
  results: ConfluencePage[];
  size: number;
  total: number;
  start: number;
  limit: number;
}

export class ConfluenceAdapter implements SourceAdapter {
  name = 'confluence';
  capabilities: AdapterCapabilities = {
    authType: 'basic',
    rateLimit: 100,
  };

  private connected = false;
  private authHeader: string | null = null;

  async connect(): Promise<void> {
    if (!CONFLUENCE_EMAIL || !CONFLUENCE_API_TOKEN) {
      throw new Error(
        '[ConfluenceAdapter] Missing credentials. Set CONFLUENCE_EMAIL + CONFLUENCE_API_TOKEN (or reuse RR_JIRA_*) env vars.'
      );
    }
    this.authHeader = 'Basic ' + Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_API_TOKEN}`).toString('base64');
    this.connected = true;
    console.log(`[ConfluenceAdapter] Connected to ${CONFLUENCE_BASE_URL}, space=${CONFLUENCE_SPACE_KEY}`);
  }

  async poll(): Promise<RawSignal[]> {
    if (!this.connected) throw new Error('ConfluenceAdapter not connected');

    const fetchedAt = new Date().toISOString();
    const cql = encodeURIComponent(`space=${CONFLUENCE_SPACE_KEY} AND type=page AND label="requirements"`);
    const url = `${CONFLUENCE_BASE_URL}/rest/api/content/search?cql=${cql}&expand=body.storage,creator,labels,metadata&limit=50`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: this.authHeader!,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'prototype-rader/1.0',
        },
      });

      if (response.status === 401 || response.status === 403) {
        console.warn('[ConfluenceAdapter] Auth failed — check CONFLUENCE credentials');
        return [];
      }

      if (!response.ok) {
        console.warn(`[ConfluenceAdapter] Confluence API error ${response.status}`);
        return [];
      }

      const rawText = await response.text();
      const data: ConfluenceSearchResponse = JSON.parse(rawText);

      console.log(`[ConfluenceAdapter] Found ${data.results.length} pages (total: ${data.total})`);

      return data.results.map(page => this.mapToRawSignal(page, fetchedAt));
    } catch (err) {
      console.warn(`[ConfluenceAdapter] Network error: ${err}`);
      return [];
    }
  }

  private mapToRawSignal(page: ConfluencePage, fetchedAt: string): RawSignal {
    const htmlBody = page.body?.storage?.value ?? '';
    const plainText = this.htmlToPlainText(htmlBody).slice(0, 5000);

    return {
      id: `confluence-${page.id}`,
      sourceId: 'confluence',
      sourceName: `Confluence (${CONFLUENCE_SPACE_KEY})`,
      rawPayload: {
        title: page.title,
        body: plainText,
        author: page.creator?.displayName ?? 'unknown',
        createdAt: page.createdDate,
        tags: page.labels?.map(l => l.name) ?? [],
        pageId: page.id,
        pageUrl: `${CONFLUENCE_BASE_URL}${page._links.webui}`,
        signalType: 'general_feedback',
      },
      fetchedAt,
    };
  }

  normalize(raw: RawSignal): NormalizedSignal {
    const payload = raw.rawPayload as Record<string, unknown>;
    const body = (payload.body as string) ?? '';

    return {
      id: `norm-confluence-${payload.pageId ?? raw.id}`,
      rawSignalId: raw.id,
      title: (payload.title as string) ?? 'Untitled',
      body: body.slice(0, 3000),
      sourceType: 'confluence',
      author: (payload.author as string) ?? 'unknown',
      createdAt: (payload.createdAt as string) ?? raw.fetchedAt,
      tags: (payload.tags as string[]) ?? [],
      metadata: {
        pageId: payload.pageId,
        pageUrl: payload.pageUrl,
        signalType: 'general_feedback',
      },
    };
  }

  /**
   * Strip HTML tags, decode common HTML entities, collapse whitespace.
   */
  private htmlToPlainText(html: string): string {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.authHeader = null;
    console.log('[ConfluenceAdapter] Disconnected');
  }
}
