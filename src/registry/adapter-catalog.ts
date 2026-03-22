/**
 * adapter-catalog.ts — config-driven adapter availability layer.
 *
 * Single source of truth for which adapters are enabled in this deployment.
 * Loaded once at startup; provides read-only queries.
 *
 * Intent selection (sourcePriority) is a separate layer on top of this.
 * A source may be in the catalog AND in an intent's sourcePriority,
 * but it is only runnable if catalog says enabled=true.
 */

import * as path from "path"
import * as fs from "fs"

export interface CatalogEntry {
  id: string
  enabled: boolean
  module: string
  description?: string
}

export interface AdapterCatalog {
  adapters: CatalogEntry[]
}

const CONFIG_DIR = path.join(process.cwd(), "config")
const CATALOG_PATH = path.join(CONFIG_DIR, "adapter-catalog.json")

let _catalog: AdapterCatalog | null = null

function loadCatalog(): AdapterCatalog {
  if (_catalog) return _catalog
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Adapter catalog not found at ${CATALOG_PATH}`)
  }
  _catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8")) as AdapterCatalog
  return _catalog
}

/**
 * Returns true if the given adapter id is explicitly enabled in the catalog.
 * Returns false if disabled, or if the id is not in the catalog at all.
 */
export function isAdapterEnabled(id: string): boolean {
  const catalog = loadCatalog()
  const entry = catalog.adapters.find(a => a.id === id)
  if (!entry) return false
  return entry.enabled
}

/**
 * Returns the set of all enabled adapter ids in this deployment.
 */
export function getEnabledAdapters(): Set<string> {
  const catalog = loadCatalog()
  return new Set(catalog.adapters.filter(a => a.enabled).map(a => a.id))
}

/**
 * Returns the full catalog (for inspection/logging).
 */
export function getCatalog(): AdapterCatalog {
  return loadCatalog()
}

/**
 * Returns all adapter ids in the catalog (enabled or not).
 */
export function getAllCatalogAdapterIds(): string[] {
  return loadCatalog().adapters.map(a => a.id)
}
