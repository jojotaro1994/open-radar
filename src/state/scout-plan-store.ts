/**
 * ScoutPlanStore — persists ScoutPlan per radar cycle.
 *
 * File location: data/scout-plans/{cycleId}.json
 *
 * Lifecycle: written once at the start of each radar cycle by the Scout Commander.
 * Survives as the audit trail for /plan and /audit.
 */

import * as fs from "fs"
import * as path from "path"
import type { ScoutPlan } from "./scout-plan.js"

export class ScoutPlanStore {
  constructor(private dataDir: string) {}

  private dir(): string {
    return path.join(this.dataDir, "scout-plans")
  }

  private filePath(cycleId: string): string {
    return path.join(this.dir(), `${cycleId}.json`)
  }

  save(plan: ScoutPlan): void {
    const dir = this.dir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.filePath(plan.cycleId), JSON.stringify(plan, null, 2) + "\n")
  }

  load(cycleId: string): ScoutPlan | null {
    const p = this.filePath(cycleId)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as ScoutPlan
    } catch {
      return null
    }
  }

  list(): string[] {
    const dir = this.dir()
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => f.replace(/\.json$/, ""))
  }
}
