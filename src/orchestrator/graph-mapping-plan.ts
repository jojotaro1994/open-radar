import * as crypto from "crypto"
import type { GraphMappingEntry, GraphMappingPlan } from "../state/graph-mapping-plan.js"
import type { StagedKnowledgeBundle } from "../state/staged-knowledge.js"
import { scoutIngest, type ScoutIngestResult } from "./scout-graph-ingestion.js"
import { StagedKnowledgeStore } from "../state/staged-knowledge-store.js"

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

function now(): string {
  return new Date().toISOString()
}

function pushEntry(
  entries: GraphMappingEntry[],
  planId: string,
  itemId: string,
  targetNodeKind: GraphMappingEntry["targetNodeKind"],
  targetKey: string,
  rationale: string,
): void {
  entries.push({
    entryId: makeId("gme"),
    planId,
    itemId,
    targetNodeKind,
    targetKey,
    rationale,
    status: "draft",
  })
}

export function draftGraphMappingPlan(bundle: StagedKnowledgeBundle): GraphMappingPlan {
  const planId = makeId("gmp")
  const entries: GraphMappingEntry[] = []

  for (const item of bundle.items) {
    pushEntry(entries, planId, item.itemId, "KnowledgePackage", item.packageHint, `group staged knowledge under package ${item.packageHint}`)
    pushEntry(entries, planId, item.itemId, "SourceArtifact", item.sourceLocator, `ingest source artifact from ${item.sourceLocator}`)
    pushEntry(entries, planId, item.itemId, "KnowledgeSection", `${item.sourceLocator}#sections`, `chunk source into sections based on ${item.sectionType}`)
    pushEntry(entries, planId, item.itemId, "Evidence", `${item.sourceLocator}#evidence`, `extract auditable evidence from ${item.title}`)
    if (item.factCandidate) {
      pushEntry(entries, planId, item.itemId, "ReferenceFact", `${item.sourceLocator}#facts`, `promote stable facts from ${item.title}`)
    }
    for (const projectionTarget of item.projectionTargets) {
      pushEntry(entries, planId, item.itemId, "Projection", `${item.packageHint}:${projectionTarget}`, `refresh ${projectionTarget} for package ${item.packageHint}`)
    }
  }

  return {
    planId,
    bundleId: bundle.bundleId,
    sourceLocators: bundle.sourceLocators,
    status: "draft",
    createdAt: now(),
    updatedAt: now(),
    summary: `Drafted ${entries.length} mapping actions from ${bundle.items.length} staged knowledge items`,
    entries,
  }
}

export interface GraphApplyResult {
  planId: string
  appliedTargets: number
  results: ScoutIngestResult[]
  errors: string[]
}

export async function applyGraphMappingPlan(
  plan: GraphMappingPlan,
  dataDir?: string
): Promise<GraphApplyResult> {
  const uniqueTargets = Array.from(new Set(plan.sourceLocators))
  const results: ScoutIngestResult[] = []
  const errors: string[] = []

  // Build researchDirection per source from bundle items
  let researchDirectionsByTarget = new Map<string, string>()
  let packageHintsByTarget = new Map<string, string>()
  if (dataDir) {
    try {
      const bundleStore = new StagedKnowledgeStore(dataDir)
      const bundle = bundleStore.load(plan.bundleId)
      if (bundle) {
        // Map each sourceLocator to its item's packageHint and researchDirection
        for (const item of bundle.items) {
          const src = item.sourceLocator
          if (!researchDirectionsByTarget.has(src)) {
            researchDirectionsByTarget.set(src, bundle.researchDirection)
          }
          if (!packageHintsByTarget.has(src)) {
            // Derive a competitive hint from researchDirection if applicable
            const rd = bundle.researchDirection.toLowerCase()
            if (rd.includes("competitive") && !item.packageHint.toLowerCase().includes("competitive")) {
              packageHintsByTarget.set(src, `competitive-intel/${item.packageHint}`)
            } else {
              packageHintsByTarget.set(src, item.packageHint)
            }
          }
        }
      }
    } catch {
      // Bundle store not available; fall through to no overrides
    }
  }

  for (const target of uniqueTargets) {
    try {
      const researchDir = researchDirectionsByTarget.get(target)
      const packageHint = packageHintsByTarget.get(target)
      const result = await scoutIngest(target, undefined, packageHint, researchDir)
      results.push(result)
      errors.push(...result.errors)
    } catch (error) {
      errors.push(`Failed applying target ${target}: ${error}`)
    }
  }

  return {
    planId: plan.planId,
    appliedTargets: uniqueTargets.length,
    results,
    errors,
  }
}
