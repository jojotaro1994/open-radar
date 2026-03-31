/**
 * memgraph-connection.ts
 *
 * Memgraph connection management using neo4j-driver (Bolt protocol compatible).
 * Supports single managed session and query execution.
 */

import neo4j, { Driver, Session, isNode, isInt, isDateTime, isLocalDateTime, isDate, isDuration, Integer } from "neo4j-driver"
import type { MemgraphConfig } from "./memgraph-config.js"
import { loadMemgraphConfig } from "./memgraph-config.js"

let _driver: Driver | null = null
let _config: MemgraphConfig | null = null

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
}

export async function getDriver(config?: MemgraphConfig): Promise<Driver> {
  const cfg = config ?? _config ?? loadMemgraphConfig()
  if (_driver) return _driver

  const { host, port, username, password } = cfg
  const uri = `bolt://${host}:${port}`

  _driver = neo4j.driver(
    uri,
    neo4j.auth.basic(username ?? "", password ?? ""),
    {
      maxConnectionPoolSize: 10,
      connectionAcquisitionTimeout: 5000,
    }
  )

  // Verify connectivity
  await _driver.verifyConnectivity()
  _config = cfg
  return _driver
}

export async function getSession(config?: MemgraphConfig): Promise<Session> {
  const driver = await getDriver(config)
  // Memgraph does not support multi-database; use default session
  return driver.session()
}

export async function runQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  query: string,
  params?: Record<string, unknown>
): Promise<QueryResult> {
  const session = await getSession()
  try {
    const result = await session.run(query, params ?? {})
    const records = result.records

    if (records.length === 0) {
      return { columns: [], rows: [] }
    }

    const columns: string[] = records[0].keys as string[]
    const rows = records.map((rec) => {
      const obj: Record<string, unknown> = {}
      for (const key of columns) {
        const val = rec.get(key as string)
        obj[key] = convertNeo4jValue(val)
      }
      return obj as T
    })

    return { columns, rows }
  } finally {
    await session.close()
  }
}

export async function runWriteQuery(
  query: string,
  params?: Record<string, unknown>
): Promise<void> {
  const session = await getSession()
  try {
    await session.run(query, params ?? {})
  } finally {
    await session.close()
  }
}

export async function closeConnection(): Promise<void> {
  if (_driver) {
    await _driver.close()
    _driver = null
  }
}

export async function resetConnection(): Promise<void> {
  await closeConnection()
  _config = null
}

export function isConnected(): boolean {
  return _driver !== null
}

// ─── Value converters ─────────────────────────────────────────────────────────

function convertNeo4jValue(val: unknown): unknown {
  if (val === null || val === undefined) return val

  // Neo4j Integer (e.g., for count queries)
  if (isInt(val)) return (val as Integer).toNumber()

  // Neo4j DateTime types
  if (isDateTime(val) || isLocalDateTime(val)) {
    const dt = val as { year: unknown; month: unknown; day: unknown; hour: unknown; minute: unknown; second: unknown; nanosecond: unknown }
    return `${dt.year}-${String(dt.month).padStart(2, "0")}-${String(dt.day).padStart(2, "0")}T${String(dt.hour).padStart(2, "0")}:${String(dt.minute).padStart(2, "0")}:${String(dt.second).padStart(2, "0")}`
  }
  if (isDate(val)) {
    const d = val as { year: unknown; month: unknown; day: unknown }
    return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`
  }

  // Neo4j Node — return its properties (flattened)
  if (isNode(val)) {
    const node = val as { properties: Record<string, unknown> }
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node.properties)) {
      result[k] = convertNeo4jValue(v)
    }
    return result
  }

  // Plain objects/arrays
  if (typeof val === "object") {
    if (Array.isArray(val)) return val.map(convertNeo4jValue)
    const obj: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      obj[k] = convertNeo4jValue(v)
    }
    return obj
  }

  return val
}
