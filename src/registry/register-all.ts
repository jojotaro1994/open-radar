/**
 * Register all available source adapters.
 * Import this module to register all adapters (side-effect import).
 *
 * Only adapters marked `enabled: true` in config/adapter-catalog.json are registered.
 * Code presence alone does NOT make an adapter available.
 * An adapter not listed in the catalog is treated as disabled.
 */
import { SourceRegistry } from './source-registry.js';
import { isAdapterEnabled, getAllCatalogAdapterIds } from './adapter-catalog.js';
import { JiraRRAdapter } from '../adapters/jira-rr-adapter.js';
import { JiraMAAdapter } from '../adapters/jira-ma-adapter.js';
import { ConfluenceAdapter } from '../adapters/confluence-adapter.js';
import { GitHubDiscussionsAdapter } from '../adapters/github-discussions-adapter.js';
import { SmarterHackerNewsAdapter } from '../adapters/hackernews-smart-adapter.js';
import { RiplusInsuranceTravelMockAdapter } from '../adapters/riplus-insurance-travel-mock-adapter.js';

function registerIfEnabled(id: string, factory: () => any, opts?: any): void {
  const catalogIds = getAllCatalogAdapterIds()
  if (!catalogIds.includes(id)) {
    console.log(`[SourceRegistry] ${id}: not in adapter-catalog.json — skipped (disabled by default)`)
    return
  }
  if (!isAdapterEnabled(id)) {
    console.log(`[SourceRegistry] ${id}: disabled in adapter-catalog.json — skipped`)
    return
  }
  SourceRegistry.register(id, factory, opts)
  console.log(`[SourceRegistry] ${id}: registered (enabled)`)
}

// Jira RR Adapter (Radica Requirements — established reqs pool, role=context)
registerIfEnabled('jira-rr', async () => new JiraRRAdapter(), {
  authType: 'basic',
  rateLimit: 10000,
})

// Jira MA Adapter (RIPlus Main project Bug/NewFeature/Improvement, role=context)
registerIfEnabled('jira-ma', async () => new JiraMAAdapter(), {
  authType: 'basic',
  rateLimit: 10000,
})

// Confluence Adapter
registerIfEnabled('confluence', async () => new ConfluenceAdapter(), {
  authType: 'basic',
  rateLimit: 100,
})

// GitHub Discussions (for generic intents that want open-source signal)
registerIfEnabled('github-discussions', async () => new GitHubDiscussionsAdapter(), {
  authType: 'bearer',
  rateLimit: 5000,
})

// HackerNews (open, no auth)
registerIfEnabled('hackernews', async () => new SmarterHackerNewsAdapter(), {
  authType: 'none',
  rateLimit: 300,
})

// Riplus Insurance/Travel Mock Direct Signal Source (role=direct_signal for testing)
registerIfEnabled('riplus-insurance-travel', async () => new RiplusInsuranceTravelMockAdapter(), {
  authType: 'none',
  rateLimit: undefined,
})

console.log('[SourceRegistry] Bootstrap complete — only catalog-enabled adapters are registered')
