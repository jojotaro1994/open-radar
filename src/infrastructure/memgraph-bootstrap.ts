/**
 * memgraph-bootstrap.ts
 *
 * Bootstraps the Memgraph graph knowledge runtime schema.
 *
 * Creates:
 *   - Node labels: ScoutTarget, KnowledgePackage, SourceArtifact, KnowledgeSection,
 *                  Evidence, ReferenceFact, Projection, ScoutRun
 *   - Indexes on id properties for all node types
 *   - Index on lookup properties (package_path, projection_key, etc.)
 */

import { runWriteQuery, runQuery } from "./memgraph-connection.js"

const NODE_LABELS = [
  "ScoutTarget",
  "KnowledgePackage",
  "SourceArtifact",
  "KnowledgeSection",
  "Evidence",
  "ReferenceFact",
  "Projection",
  "ScoutRun",
] as const

const RELATIONSHIP_TYPES = [
  "PRODUCES",
  "CONTAINS",
  "HAS_SECTION",
  "SUPPORTS",
  "DERIVES",
  "INFORMS",
  "CONSTRAINS",
  "DERIVED_FROM",
  "INCLUDES",
  "CONSUMES",
  "TOUCHED",
] as const

async function createIndex(label: string, property: string): Promise<void> {
  try {
    await runWriteQuery(
      `CREATE INDEX ON :${label}(${property}) IF NOT EXISTS`
    )
  } catch (err) {
    // Index may already exist — that's fine
  }
}

async function createFullTextIndex(label: string, property: string): Promise<void> {
  try {
    await runWriteQuery(
      `CREATE FULLTEXT INDEX ON :${label}(${property}) IF NOT EXISTS`
    )
  } catch (err) {
    // May fail if FT index already exists or is not supported in this version
  }
}

export interface BootstrapResult {
  success: boolean
  indexesCreated: string[]
  errors: string[]
}

export async function bootstrapGraph(): Promise<BootstrapResult> {
  const errors: string[] = []
  const indexesCreated: string[] = []

  // Create node labels (Memgraph creates them implicitly on first use,
  // but explicit CREATE is idempotent)
  for (const label of NODE_LABELS) {
    try {
      await runWriteQuery(`CREATE (n:${label} {}) RETURN n LIMIT 0`)
    } catch {
      // Node label already exists
    }
  }

  // Create relationship types
  for (const relType of RELATIONSHIP_TYPES) {
    try {
      await runWriteQuery(`CREATE ()-[r:${relType}]->() RETURN r LIMIT 0`)
    } catch {
      // Relationship type already exists
    }
  }

  // Create indexes on id properties (primary lookup key)
  for (const label of NODE_LABELS) {
    try {
      await createIndex(label, "id")
      indexesCreated.push(`${label}.id`)
    } catch (err) {
      errors.push(`Index ${label}.id: ${String(err)}`)
    }
  }

  // Create indexes on common lookup properties
  const lookupIndexes: Array<[string, string]> = [
    ["KnowledgePackage", "package_path"],
    ["KnowledgePackage", "package_kind"],
    ["ScoutTarget", "target_kind"],
    ["ScoutTarget", "locator"],
    ["SourceArtifact", "artifact_kind"],
    ["SourceArtifact", "content_hash"],
    ["Projection", "projection_kind"],
    ["Projection", "projection_key"],
    ["ScoutRun", "status"],
  ]

  for (const [label, prop] of lookupIndexes) {
    try {
      await createIndex(label, prop)
      indexesCreated.push(`${label}.${prop}`)
    } catch (err) {
      errors.push(`Index ${label}.${prop}: ${String(err)}`)
    }
  }

  return {
    success: errors.length === 0,
    indexesCreated,
    errors,
  }
}

export async function clearGraph(): Promise<void> {
  await runWriteQuery("MATCH (n) DETACH DELETE n")
}

export async function getGraphStats(): Promise<Record<string, number>> {
  const stats: Record<string, number> = {}

  for (const label of NODE_LABELS) {
    try {
      const result = await runQuery<{ count: number }>(
        `MATCH (n:${label}) RETURN count(n) AS count`
      )
      stats[label] = (result.rows[0]?.count as number) ?? 0
    } catch {
      stats[label] = 0
    }
  }

  return stats
}

export async function checkHealth(): Promise<{ healthy: boolean; version?: string; error?: string }> {
  try {
    const result = await runQuery<{ version: string }>(
      "CALL dbms.info() YIELD version RETURN version"
    )
    return { healthy: true, version: result.rows[0]?.version as string | undefined }
  } catch {
    // Fallback: just check connectivity with a simple query
    try {
      await runQuery("RETURN 1")
      return { healthy: true }
    } catch (err) {
      return { healthy: false, error: String(err) }
    }
  }
}
