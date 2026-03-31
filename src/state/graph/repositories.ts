/**
 * repositories.ts — Graph repositories for all knowledge runtime node types.
 *
 * Implements the Memgraph-backed persistence layer described in design.md.
 */

import { runQuery, runWriteQuery, runQuery as query } from "../../infrastructure/memgraph-connection.js"
import { upsertNode, findNodeById, deleteNode, countNodes } from "./repository.js"
import type {
  ScoutTarget,
  KnowledgePackage,
  SourceArtifact,
  KnowledgeSection,
  Evidence,
  ReferenceFact,
  Projection,
  ScoutRun,
  TraceEdge,
} from "./types.js"

// ─── ScoutTarget ────────────────────────────────────────────────────────────

export async function saveScoutTarget(node: ScoutTarget): Promise<void> {
  await upsertNode("ScoutTarget", node.id, {
    target_kind: node.target_kind,
    locator: node.locator,
    title: node.title,
    created_at: node.created_at,
    updated_at: node.updated_at,
  })
}

export async function getScoutTarget(id: string): Promise<ScoutTarget | null> {
  return findNodeById<ScoutTarget>("ScoutTarget", id)
}

export async function findScoutTargetsByKind(
  targetKind: string
): Promise<ScoutTarget[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (n:ScoutTarget {target_kind: $kind}) RETURN n ORDER BY n.created_at DESC`,
    { kind: targetKind }
  )
  return result.rows.map((r) => r.n as unknown as ScoutTarget)
}

// ─── KnowledgePackage ────────────────────────────────────────────────────────

export async function saveKnowledgePackage(node: KnowledgePackage): Promise<void> {
  await upsertNode("KnowledgePackage", node.id, {
    package_path: node.package_path,
    package_kind: node.package_kind,
    title: node.title,
    created_at: node.created_at,
    updated_at: node.updated_at,
    last_verified_at: node.last_verified_at,
    freshness_window_days: node.freshness_window_days,
    freshness_status: node.freshness_status,
    confidence: node.confidence,
  })
}

export async function getKnowledgePackage(id: string): Promise<KnowledgePackage | null> {
  return findNodeById<KnowledgePackage>("KnowledgePackage", id)
}

export async function findKnowledgePackagesByKind(
  packageKind: string
): Promise<KnowledgePackage[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (n:KnowledgePackage {package_kind: $kind}) RETURN n ORDER BY n.created_at DESC`,
    { kind: packageKind }
  )
  return result.rows.map((r) => r.n as unknown as KnowledgePackage)
}

export async function findKnowledgePackageByPath(
  packagePath: string
): Promise<KnowledgePackage | null> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (n:KnowledgePackage {package_path: $path}) RETURN n LIMIT 1`,
    { path: packagePath }
  )
  if (result.rows.length === 0) return null
  return result.rows[0].n as unknown as KnowledgePackage
}

export async function listKnowledgePackages(): Promise<KnowledgePackage[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (n:KnowledgePackage) RETURN n ORDER BY n.package_path`
  )
  return result.rows.map((r) => r.n as unknown as KnowledgePackage)
}

// ─── SourceArtifact ──────────────────────────────────────────────────────────

export async function saveSourceArtifact(node: SourceArtifact): Promise<void> {
  await upsertNode("SourceArtifact", node.id, {
    artifact_kind: node.artifact_kind,
    artifact_path_or_url: node.artifact_path_or_url,
    content_hash: node.content_hash,
    title: node.title,
    created_at: node.created_at,
    updated_at: node.updated_at,
    last_verified_at: node.last_verified_at,
    freshness_status: node.freshness_status,
  })
}

export async function getSourceArtifact(id: string): Promise<SourceArtifact | null> {
  return findNodeById<SourceArtifact>("SourceArtifact", id)
}

export async function findArtifactsByPackage(
  packageId: string
): Promise<SourceArtifact[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (pkg:KnowledgePackage {id: $pkgId})-[:CONTAINS]->(a:SourceArtifact)
     RETURN a ORDER BY a.title`,
    { pkgId: packageId }
  )
  return result.rows.map((r) => r.a as unknown as SourceArtifact)
}

export async function findArtifactsByHash(
  contentHash: string
): Promise<SourceArtifact[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (a:SourceArtifact {content_hash: $hash}) RETURN a`,
    { hash: contentHash }
  )
  return result.rows.map((r) => r.a as unknown as SourceArtifact)
}

export async function findArtifactByPathOrUrl(
  artifactPathOrUrl: string
): Promise<SourceArtifact | null> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (a:SourceArtifact {artifact_path_or_url: $path}) RETURN a LIMIT 1`,
    { path: artifactPathOrUrl }
  )
  if (result.rows.length === 0) return null
  return result.rows[0].a as unknown as SourceArtifact
}

// ─── KnowledgeSection ────────────────────────────────────────────────────────

export async function saveKnowledgeSection(node: KnowledgeSection): Promise<void> {
  await upsertNode("KnowledgeSection", node.id, {
    section_key: node.section_key,
    heading: node.heading,
    section_order: node.section_order,
    body_summary: node.body_summary,
    created_at: node.created_at,
    updated_at: node.updated_at,
    last_verified_at: node.last_verified_at,
    freshness_status: node.freshness_status,
  })
}

export async function getKnowledgeSection(id: string): Promise<KnowledgeSection | null> {
  return findNodeById<KnowledgeSection>("KnowledgeSection", id)
}

export async function findSectionsByArtifact(
  artifactId: string
): Promise<KnowledgeSection[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (a:SourceArtifact {id: $artId})-[:HAS_SECTION]->(s:KnowledgeSection)
     RETURN s ORDER BY s.section_order`,
    { artId: artifactId }
  )
  return result.rows.map((r) => r.s as unknown as KnowledgeSection)
}

// ─── Evidence ────────────────────────────────────────────────────────────────

export async function saveEvidence(node: Evidence): Promise<void> {
  await upsertNode("Evidence", node.id, {
    evidence_type: node.evidence_type,
    statement: node.statement,
    source_locator: node.source_locator,
    created_at: node.created_at,
    updated_at: node.updated_at,
    last_verified_at: node.last_verified_at,
    freshness_status: node.freshness_status,
    confidence: node.confidence,
  })
}

export async function getEvidence(id: string): Promise<Evidence | null> {
  return findNodeById<Evidence>("Evidence", id)
}

export async function findEvidenceBySection(
  sectionId: string
): Promise<Evidence[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (s:KnowledgeSection {id: $secId})-[:SUPPORTS]->(e:Evidence)
     RETURN e ORDER BY e.created_at`,
    { secId: sectionId }
  )
  return result.rows.map((r) => r.e as unknown as Evidence)
}

// ─── ReferenceFact ───────────────────────────────────────────────────────────

export async function saveReferenceFact(node: ReferenceFact): Promise<void> {
  await upsertNode("ReferenceFact", node.id, {
    fact_type: node.fact_type,
    statement: node.statement,
    canonical_scope: node.canonical_scope,
    created_at: node.created_at,
    updated_at: node.updated_at,
    last_verified_at: node.last_verified_at,
    freshness_window_days: node.freshness_window_days,
    freshness_status: node.freshness_status,
    confidence: node.confidence,
  })
}

export async function getReferenceFact(id: string): Promise<ReferenceFact | null> {
  return findNodeById<ReferenceFact>("ReferenceFact", id)
}

export async function findFactsByEvidence(
  evidenceId: string
): Promise<ReferenceFact[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (e:Evidence {id: $evId})-[:DERIVES]->(f:ReferenceFact)
     RETURN f ORDER BY f.created_at`,
    { evId: evidenceId }
  )
  return result.rows.map((r) => r.f as unknown as ReferenceFact)
}

// ─── Projection ─────────────────────────────────────────────────────────────

export async function saveProjection(node: Projection): Promise<void> {
  await upsertNode("Projection", node.id, {
    projection_kind: node.projection_kind,
    projection_key: node.projection_key,
    title: node.title,
    summary: node.summary,
    created_at: node.created_at,
    updated_at: node.updated_at,
    last_verified_at: node.last_verified_at,
    freshness_status: node.freshness_status,
  })
}

export async function getProjection(id: string): Promise<Projection | null> {
  return findNodeById<Projection>("Projection", id)
}

export async function findProjectionsByPackage(
  packageId: string
): Promise<Projection[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (p:Projection)-[:DERIVED_FROM]->(pkg:KnowledgePackage {id: $pkgId})
     RETURN p ORDER BY p.projection_kind, p.projection_key`,
    { pkgId: packageId }
  )
  return result.rows.map((r) => r.p as unknown as Projection)
}

export async function findPackageByProjection(
  projectionId: string
): Promise<KnowledgePackage | null> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (p:Projection {id: $projId})-[:DERIVED_FROM]->(pkg:KnowledgePackage)
     RETURN pkg LIMIT 1`,
    { projId: projectionId }
  )
  if (result.rows.length === 0) return null
  return result.rows[0].pkg as unknown as KnowledgePackage
}

export async function findProjectionsByKind(
  projectionKind: string
): Promise<Projection[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (p:Projection {projection_kind: $kind}) RETURN p ORDER BY p.projection_key`,
    { kind: projectionKind }
  )
  return result.rows.map((r) => r.p as unknown as Projection)
}

export async function findProjectionByKey(
  projectionKey: string
): Promise<Projection | null> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (p:Projection {projection_key: $key}) RETURN p LIMIT 1`,
    { key: projectionKey }
  )
  if (result.rows.length === 0) return null
  return result.rows[0].p as unknown as Projection
}

export async function findFactsByProjection(
  projectionId: string
): Promise<ReferenceFact[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (p:Projection {id: $projId})-[:INCLUDES]->(f:ReferenceFact)
     RETURN f ORDER BY f.created_at`,
    { projId: projectionId }
  )
  return result.rows.map((r) => r.f as unknown as ReferenceFact)
}

// ─── ScoutRun ────────────────────────────────────────────────────────────────

export async function saveScoutRun(node: ScoutRun): Promise<void> {
  await upsertNode("ScoutRun", node.run_id, {
    mode: node.mode,
    status: node.status,
    started_at: node.started_at,
    finished_at: node.finished_at,
  })
}

export async function getScoutRun(runId: string): Promise<ScoutRun | null> {
  return findNodeById<ScoutRun>("ScoutRun", runId)
}

export async function findRecentScoutRuns(limit = 10): Promise<ScoutRun[]> {
  const intLimit = Math.floor(Number(limit))
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (r:ScoutRun) RETURN r ORDER BY r.started_at DESC LIMIT ${intLimit}`,
    {}
  )
  return result.rows.map((r) => r.r as unknown as ScoutRun)
}

// ─── Relationship helpers ────────────────────────────────────────────────────

export async function linkProducer(
  fromId: string,
  fromLabel: string,
  toId: string,
  toLabel: string
): Promise<void> {
  await runWriteQuery(
    `MATCH (a:${fromLabel} {id: $fromId})
     MATCH (b:${toLabel} {id: $toId})
     MERGE (a)-[:PRODUCES]->(b)`,
    { fromId, toId }
  )
}

export async function linkContains(
  packageId: string,
  artifactId: string
): Promise<void> {
  await runWriteQuery(
    `MATCH (pkg:KnowledgePackage {id: $pkgId})
     MATCH (a:SourceArtifact {id: $artId})
     MERGE (pkg)-[:CONTAINS]->(a)`,
    { pkgId: packageId, artId: artifactId }
  )
}

export async function linkHasSection(
  artifactId: string,
  sectionId: string
): Promise<void> {
  await runWriteQuery(
    `MATCH (a:SourceArtifact {id: $artId})
     MATCH (s:KnowledgeSection {id: $secId})
     MERGE (a)-[:HAS_SECTION]->(s)`,
    { artId: artifactId, secId: sectionId }
  )
}

export async function linkSupports(
  sectionId: string,
  evidenceId: string
): Promise<void> {
  await runWriteQuery(
    `MATCH (s:KnowledgeSection {id: $secId})
     MATCH (e:Evidence {id: $evId})
     MERGE (s)-[:SUPPORTS]->(e)`,
    { secId: sectionId, evId: evidenceId }
  )
}

export async function linkDerives(
  evidenceId: string,
  factId: string
): Promise<void> {
  await runWriteQuery(
    `MATCH (e:Evidence {id: $evId})
     MATCH (f:ReferenceFact {id: $factId})
     MERGE (e)-[:DERIVES]->(f)`,
    { evId: evidenceId, factId: factId }
  )
}

export async function linkDerivedFrom(
  projectionId: string,
  packageId: string
): Promise<void> {
  await runWriteQuery(
    `MATCH (p:Projection {id: $projId})
     MATCH (pkg:KnowledgePackage {id: $pkgId})
     MERGE (p)-[:DERIVED_FROM]->(pkg)`,
    { projId: projectionId, pkgId: packageId }
  )
}

export async function linkIncludesFact(
  projectionId: string,
  factId: string
): Promise<void> {
  await runWriteQuery(
    `MATCH (p:Projection {id: $projId})
     MATCH (f:ReferenceFact {id: $factId})
     MERGE (p)-[:INCLUDES]->(f)`,
    { projId: projectionId, factId: factId }
  )
}

export async function linkTouched(
  runId: string,
  targetId: string
): Promise<void> {
  await runWriteQuery(
    `MATCH (r:ScoutRun {run_id: $runId})
     MATCH (t:ScoutTarget {id: $tgtId})
     MERGE (r)-[:TOUCHED]->(t)`,
    { runId, tgtId: targetId }
  )
}

export async function linkTouchedPackage(
  runId: string,
  packageId: string
): Promise<void> {
  await runWriteQuery(
    `MATCH (r:ScoutRun {run_id: $runId})
     MATCH (pkg:KnowledgePackage {id: $pkgId})
     MERGE (r)-[:TOUCHED]->(pkg)`,
    { runId, pkgId: packageId }
  )
}

// ─── Trace ─────────────────────────────────────────────────────────────────

export async function traceProjection(
  projectionId: string
): Promise<TraceEdge[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH path = (p:Projection {id: $projId})
               -[:INCLUDES|DERIVED_FROM*1..3]->
               (end)
     WITH relationships(path) AS rels
     UNWIND rels AS r
     RETURN DISTINCT
            startNode(r).id AS from_id,
            labels(startNode(r))[0] AS from_label,
            type(r) AS rel_type,
            endNode(r).id AS to_id,
            labels(endNode(r))[0] AS to_label
     ORDER BY to_label, from_label`,
    { projId: projectionId }
  )
  return result.rows as unknown as TraceEdge[]
}

export async function traceReferenceFact(
  factId: string
): Promise<TraceEdge[]> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH path = (f:ReferenceFact {id: $factId})
               <-[:DERIVES|INCLUDES*1..3]-
               (start)
     WITH relationships(path) AS rels
     UNWIND rels AS r
     RETURN DISTINCT
            startNode(r).id AS from_id,
            labels(startNode(r))[0] AS from_label,
            type(r) AS rel_type,
            endNode(r).id AS to_id,
            labels(endNode(r))[0] AS to_label
     ORDER BY from_label, to_label`,
    { factId }
  )
  return result.rows as unknown as TraceEdge[]
}

// ─── Count helpers ─────────────────────────────────────────────────────────

export async function countKnowledgePackages(): Promise<number> {
  return countNodes("KnowledgePackage")
}

export async function countProjections(): Promise<number> {
  return countNodes("Projection")
}

export async function countSourceArtifacts(): Promise<number> {
  return countNodes("SourceArtifact")
}

export async function countReferenceFacts(): Promise<number> {
  return countNodes("ReferenceFact")
}

// ─── Scout status ─────────────────────────────────────────────────────────────

export interface PackageStatus {
  package: KnowledgePackage
  artifactCount: number
  sectionCount: number
  evidenceCount: number
  factCount: number
  projectionCount: number
  lastRun?: ScoutRun
}

export async function getPackageStatus(packageId: string): Promise<PackageStatus | null> {
  const pkg = await getKnowledgePackage(packageId)
  if (!pkg) return null

  const artifacts = await findArtifactsByPackage(packageId)
  const projections = await findProjectionsByPackage(packageId)

  let sectionCount = 0
  let evidenceCount = 0
  let factCount = 0
  for (const art of artifacts) {
    const sections = await findSectionsByArtifact(art.id)
    sectionCount += sections.length
    for (const sec of sections) {
      const evList = await findEvidenceBySection(sec.id)
      evidenceCount += evList.length
      for (const ev of evList) {
        const facts = await findFactsByEvidence(ev.id)
        factCount += facts.length
      }
    }
  }

  // Find last scout run that touched this package
  const runsResult = await runQuery<Record<string, unknown>>(
    `MATCH (r:ScoutRun)-[:TOUCHED]->(pkg:KnowledgePackage {id: $pkgId})
     RETURN r ORDER BY r.started_at DESC LIMIT 1`,
    { pkgId: packageId }
  )
  const lastRun = runsResult.rows[0]?.r as ScoutRun | undefined

  return {
    package: pkg,
    artifactCount: artifacts.length,
    sectionCount,
    evidenceCount,
    factCount,
    projectionCount: projections.length,
    lastRun,
  }
}

export async function getScoutTargetForPath(locator: string): Promise<ScoutTarget | null> {
  const result = await runQuery<Record<string, unknown>>(
    `MATCH (t:ScoutTarget {locator: $locator}) RETURN t ORDER BY t.created_at DESC LIMIT 1`,
    { locator }
  )
  if (result.rows.length === 0) return null
  return result.rows[0].t as unknown as ScoutTarget
}
