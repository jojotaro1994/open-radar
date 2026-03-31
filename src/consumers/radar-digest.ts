import { EventBus } from "../infrastructure/event-bus.js";
import { StorageHelper } from "../infrastructure/storage-helper.js";
import type { RadarDigest } from "../schemas/radar-digest.js";

export class RadarDigestConsumer {
  constructor(private eventBus: EventBus, private storage: StorageHelper) {}

  async generateDigest(cycleId: string, options?: { sinceCycleId?: string }): Promise<RadarDigest> {
    // Load recent opportunities
    const opportunityFiles = await this.storage.listFiles("opportunities");
    const opportunities: any[] = [];

    for (const file of opportunityFiles) {
      const opp = await this.storage.readJson<any>(`opportunities/${file}`);
      if (opp) {
        if (options?.sinceCycleId) {
          // Filter by cycle if specified
          if (opp.createdAt && opp.createdAt.includes(options.sinceCycleId.slice(0, 10))) {
            opportunities.push(opp);
          }
        } else {
          opportunities.push(opp);
        }
      }
    }

    // Group by theme (using themeCandidateId as simple grouping)
    const themeMap = new Map<string, number>();
    for (const opp of opportunities) {
      const themeId = opp.themeCandidateId || "unknown";
      themeMap.set(themeId, (themeMap.get(themeId) || 0) + 1);
    }

    const themeCount = themeMap.size;
    const oppCount = opportunities.length;

    // Create digest
    const digest: RadarDigest = {
      id: `digest-${cycleId}-${Date.now()}`,
      cycleId,
      opportunityIds: opportunities.map(o => o.id),
      themeSummary: `This cycle: ${oppCount} opportunities from ${themeCount} themes. Top themes: ${Array.from(themeMap.keys()).slice(0, 3).join(", ")}`,
      publishedAt: new Date().toISOString(),
      channels: ["discord"],
    };

    // Save digest
    await this.storage.writeJson(`digests/${digest.id}.json`, digest);

    console.log(`[RadarDigest] Generated ${digest.id}: ${oppCount} opportunities, ${themeCount} themes`);

    return digest;
  }

  async process(event: string, payload: any): Promise<void> {
    // Digest is scheduler-triggered, not event-driven for MVP
    // No-op stub
  }
}