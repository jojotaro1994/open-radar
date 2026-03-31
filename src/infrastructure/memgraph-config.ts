/**
 * memgraph-config.ts
 *
 * Memgraph connection configuration for the graph knowledge runtime.
 *
 * Defaults:
 *   host:     127.0.0.1
 *   bolt port: 7688 (project-dedicated container; 7687 is the shared ri-memgraph port)
 *   database: memgraph (Memgraph uses single database, not multi-tenant)
 *   Lab:       http://127.0.0.1:3001 (project-dedicated Lab)
 *
 * Override with env vars: MEMGRAPH_HOST, MEMGRAPH_PORT, MEMGRAPH_USERNAME, MEMGRAPH_PASSWORD
 */

export interface MemgraphConfig {
  host: string
  port: number
  database: string
  username?: string
  password?: string
  TLS?: boolean
}

export const DEFAULT_MEMGRAPH_CONFIG: MemgraphConfig = {
  host: process.env.MEMGRAPH_HOST ?? "127.0.0.1",
  port: parseInt(process.env.MEMGRAPH_PORT ?? "7688", 10),
  database: process.env.MEMGRAPH_DATABASE ?? "memgraph",
  username: process.env.MEMGRAPH_USERNAME,
  password: process.env.MEMGRAPH_PASSWORD,
  TLS: process.env.MEMGRAPH_TLS === "true",
}

export function loadMemgraphConfig(): MemgraphConfig {
  return DEFAULT_MEMGRAPH_CONFIG
}

export function memgraphBoltUrl(config: MemgraphConfig): string {
  const protocol = config.TLS ? "bolt+ssc" : "bolt"
  const auth = config.username
    ? `${config.username}:${config.password ?? ""}@`
    : ""
  return `${protocol}://${auth}${config.host}:${config.port}`
}
