import { listJsonBasenames, readJsonFile, writeJsonFile } from "./intelligence-store-utils.js"
import { graphMappingPlanDir, graphMappingPlanPath } from "./intelligence-layout.js"
import type { GraphMappingPlan } from "./graph-mapping-plan.js"

export class GraphMappingPlanStore {
  constructor(private dataDir: string) {}

  save(plan: GraphMappingPlan): void {
    writeJsonFile(graphMappingPlanPath(this.dataDir, plan.planId), plan)
  }

  load(planId: string): GraphMappingPlan | null {
    return readJsonFile<GraphMappingPlan>(graphMappingPlanPath(this.dataDir, planId))
  }

  list(): string[] {
    return listJsonBasenames(graphMappingPlanDir(this.dataDir))
  }

  listByBundle(bundleId: string): GraphMappingPlan[] {
    return this.list()
      .map(id => this.load(id))
      .filter((plan): plan is GraphMappingPlan => plan !== null && plan.bundleId === bundleId)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  }

  loadLatestByBundle(bundleId: string): GraphMappingPlan | null {
    const plans = this.listByBundle(bundleId)
    return plans.length > 0 ? plans[plans.length - 1]! : null
  }
}
