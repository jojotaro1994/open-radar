import { EventBus } from "../infrastructure/event-bus.js";
import { StorageHelper } from "../infrastructure/storage-helper.js";
import type { VideoBrief, FrameControl } from "../schemas/video-brief.js";

export class VideoBriefConsumer {
  constructor(private eventBus: EventBus, private storage: StorageHelper) {}

  async process(event: string, payload: any): Promise<VideoBrief | null> {
    if (event !== "prototypeBrief.created") {
      return null;
    }

    const { prototypeBriefId, opportunityId, brief: protoBrief } = payload;

    // Load the opportunity
    const opportunity = await this.storage.readJson<any>(`opportunities/${opportunityId}.json`);
    if (!opportunity) {
      console.log(`[VideoBrief] Opportunity not found: ${opportunityId}`);
      return null;
    }

    // Create stub frames
    const frames: FrameControl[] = [
      { frameIndex: 0, shotType: "wide", visualDescription: `stub frame 1 - ${opportunity.title}`, durationSec: 20 },
      { frameIndex: 1, shotType: "medium", visualDescription: `stub frame 2 - ${opportunity.title}`, durationSec: 20 },
      { frameIndex: 2, shotType: "close", visualDescription: `stub frame 3 - ${opportunity.title}`, durationSec: 20 },
    ];

    // Create brief with real prototypeBriefId
    const brief: VideoBrief = {
      id: `vb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prototypeBriefId, // real id from prototypeBrief.created event
      narrative: `Auto-generated stub narrative for: ${opportunity.title}`,
      tone: "informative",
      duration: 60,
      audience: "internal team",
      frames,
    };

    // Save brief
    await this.storage.writeJson(`briefs/video/${brief.id}.json`, brief);

    console.log(`[VideoBrief] Created ${brief.id} linked to ${prototypeBriefId}`);

    return brief;
  }
}