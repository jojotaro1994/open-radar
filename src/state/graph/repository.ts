/**
 * repository.ts — Generic graph repository utilities.
 */

import { runQuery, runWriteQuery, QueryResult } from "../../infrastructure/memgraph-connection.js"

export function nodeToRecord<T>(row: Record<string, unknown>, alias: string): T {
  return row[alias] as T
}

export async function findNodeById<T>(
  label: string,
  id: string
): Promise<T | null> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (n:${label} {id: $id}) RETURN n`,
    { id }
  )
  if (result.rows.length === 0) return null
  return nodeToRecord<T>(result.rows[0], "n")
}

export async function upsertNode<T extends Record<string, unknown>>(
  label: string,
  id: string,
  props: T
): Promise<void> {
  // Filter out undefined values to avoid Neo4j parameter errors
  const definedProps: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined) definedProps[k] = v
  }
  const propKeys = Object.keys(definedProps)
  const setClause = propKeys
    .map((k) => `n.${k} = $${k}`)
    .concat(["n.updated_at = datetime()"])
    .join(", ")

  await runWriteQuery(
    `MERGE (n:${label} {id: $id})
     SET ${setClause}`,
    { id, ...definedProps }
  )
}

export async function deleteNode(label: string, id: string): Promise<boolean> {
  await runWriteQuery(
    `MATCH (n:${label} {id: $id}) DETACH DELETE n`,
    { id }
  )
  return true
}

export async function countNodes(label: string): Promise<number> {
  const result = await runQuery<{ count: number }>(
    `MATCH (n:${label}) RETURN count(n) AS count`
  )
  return (result.rows[0]?.count as number) ?? 0
}

export async function findNodes<T>(
  label: string,
  whereClause: string,
  params: Record<string, unknown>
): Promise<T[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (n:${label}) WHERE ${whereClause} RETURN n`,
    params
  )
  return result.rows.map((r) => nodeToRecord<T>(r, "n"))
}
