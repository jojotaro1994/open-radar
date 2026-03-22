/**
 * SourceRegistry
 * Central registry for SourceAdapter instances.
 * Adapters self-register on import; the registry provides lookup by name and intent.
 *
 * IMPORTANT: Registration alone does NOT make an adapter runnable.
 * Only adapters marked `enabled: true` in config/adapter-catalog.json are registered.
 * An adapter must BOTH be in the registry AND be catalog-enabled to be returned
 * by listForIntent.
 *
 * The intent's sourcePriority is an ordered allow-list:
 *   - Non-empty list → only the named adapters (that are also catalog-enabled)
 *   - Empty or missing → safe empty set (NOT "all registered adapters")
 *
 * This prevents a new intent from accidentally picking up all historically
 * registered adapters just because it doesn't specify sourcePriority.
 */
import type { SourceAdapter, AdapterCapabilities } from '../adapters/source-adapter.js';

export type SourceAdapterFactory = () => Promise<SourceAdapter>;

interface RegistryEntry {
  factory: SourceAdapterFactory;
  adapter: SourceAdapter | null;
  capabilities?: AdapterCapabilities;
}

class SourceRegistryImpl {
  private adapters = new Map<string, RegistryEntry>();
  private intentAdapterMap = new Map<string, string[]>();

  /**
   * Register an adapter factory under a given name.
   * Adapters call this in their module init (self-registration).
   */
  register(name: string, factory: SourceAdapterFactory, capabilities?: AdapterCapabilities): void {
    this.adapters.set(name, { factory, adapter: null, capabilities });
    console.log(`[SourceRegistry] Registered adapter: ${name}`);
  }

  /**
   * Get a connected adapter instance by name.
   * Creates the instance on first access.
   * Returns null if the adapter is not registered or connection fails.
   */
  async get(name: string): Promise<SourceAdapter | null> {
    const entry = this.adapters.get(name);
    if (!entry) return null;

    if (!entry.adapter) {
      try {
        entry.adapter = await entry.factory();
        await entry.adapter.connect();
      } catch (err) {
        console.warn(`[SourceRegistry] Adapter '${name}' failed to connect: ${err}. Skipping.`);
        return null;
      }
    }
    return entry.adapter;
  }

  /**
   * List all registered adapter names.
   */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get adapter capabilities by name.
   */
  getCapabilities(name: string): AdapterCapabilities | undefined {
    return this.adapters.get(name)?.capabilities;
  }

  /**
   * Get all adapter names for a given intent.
   *
   * sourcePriority is an ordered allow-list:
   *   - Non-empty → only adapters that are BOTH in the list AND registered
   *   - Empty or missing → SAFE EMPTY SET (never falls back to all adapters)
   *
   * Note: "registered" here means the adapter passed through register-all.ts
   * bootstrap, which itself requires catalog enablement. So this method returns
   * only catalog-enabled adapters that are also intent-allow-listed.
   */
  listForIntent(intentId: string, sourcePriority?: string[]): string[] {
    if (!sourcePriority || sourcePriority.length === 0) {
      // Safe empty set — an intent must explicitly declare which adapters it wants.
      // This prevents a new intent from accidentally picking up all historically
      // registered adapters simply by not specifying sourcePriority.
      console.log(`[SourceRegistry] intent="${intentId}" sourcePriority is empty — returning safe empty set (no adapters auto-selected)`)
      return [];
    }
    return sourcePriority.filter(name => this.adapters.has(name));
  }
}

// Singleton instance
export const SourceRegistry = new SourceRegistryImpl();
