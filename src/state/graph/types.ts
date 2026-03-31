/**
 * types.ts — Graph node type definitions for the knowledge runtime.
 *
 * These types map directly to the Memgraph schema described in design.md.
 * Each type corresponds to a labeled node in the graph.
 */

export type TargetKind = "website" | "local_dir" | "local_file" | "repo_path" | "video" | "document_set"
export type PackageKind = "domain" | "competitive_intel" | "customer_intel" | "sales_meeting" | "overview"
export type ArtifactKind = "markdown_doc" | "jsonl_doc" | "csv_doc" | "pptx_doc" | "xlsx_doc" | "image_asset" | "external_url" | "code_repo_path"
export type FreshnessStatus = "fresh" | "stale" | "unknown"
export type ProjectionKind = "DomainDossier" | "CapabilitySlice" | "CompetitivePack" | "AccountIntelPack" | "MeetingPacket"
export type ScoutRunMode = "ingest" | "refresh"
export type ScoutRunStatus = "running" | "completed" | "failed" | "cancelled"

/** ScoutTarget — what Scout was asked to inspect */
export interface ScoutTarget {
  id: string
  target_kind: TargetKind
  locator: string
  title: string
  created_at: string
  updated_at: string
}

/** KnowledgePackage — maintenance/refresh/recall aggregation boundary */
export interface KnowledgePackage {
  id: string
  package_path: string
  package_kind: PackageKind
  title: string
  created_at: string
  updated_at: string
  last_verified_at: string
  freshness_window_days: number
  freshness_status: FreshnessStatus
  confidence: number
}

/** SourceArtifact — concrete source file or location that Scout actually read */
export interface SourceArtifact {
  id: string
  artifact_kind: ArtifactKind
  artifact_path_or_url: string
  content_hash: string
  title: string
  created_at: string
  updated_at: string
  last_verified_at: string
  freshness_status: FreshnessStatus
}

/** KnowledgeSection — default chunking boundary */
export interface KnowledgeSection {
  id: string
  section_key: string
  heading: string
  section_order: number
  body_summary: string
  created_at: string
  updated_at: string
  last_verified_at: string
  freshness_status: FreshnessStatus
}

/** Evidence — auditable, citable evidence unit */
export interface Evidence {
  id: string
  evidence_type: string
  statement: string
  source_locator: string
  created_at: string
  updated_at: string
  last_verified_at: string
  freshness_status: FreshnessStatus
  confidence: number
}

/** ReferenceFact — independently citable stable truth */
export interface ReferenceFact {
  id: string
  fact_type: string
  statement: string
  canonical_scope: string
  created_at: string
  updated_at: string
  last_verified_at: string
  freshness_window_days: number
  freshness_status: FreshnessStatus
  confidence: number
}

/** Projection — first-pass retrieval surface */
export interface Projection {
  id: string
  projection_kind: ProjectionKind
  projection_key: string
  title: string
  summary: string
  created_at: string
  updated_at: string
  last_verified_at: string
  freshness_status: FreshnessStatus
}

/** ScoutRun — one ingest or refresh execution */
export interface ScoutRun {
  run_id: string
  mode: ScoutRunMode
  status: ScoutRunStatus
  started_at: string
  finished_at?: string
}

/** Trace record — lightweight lineage edge for trace resolution */
export interface TraceEdge {
  from_id: string
  from_label: string
  rel_type: string
  to_id: string
  to_label: string
}
