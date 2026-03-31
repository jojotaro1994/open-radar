import { EventBus } from "../infrastructure/event-bus.js";
import { StorageHelper } from "../infrastructure/storage-helper.js";
import type { JiraDraft } from "../schemas/jira-draft.js";

export class JiraDraftConsumer {
  constructor(private eventBus: EventBus, private storage: StorageHelper) {}

  async process(event: string, payload: any): Promise<JiraDraft | null> {
    if (event !== "opportunity.created") {
      return null;
    }

    const { opportunityId } = payload;

    // Load the opportunity
    const opportunity = await this.storage.readJson<any>(`opportunities/${opportunityId}.json`);
    if (!opportunity) {
      console.log(`[JiraDraft] Opportunity not found: ${opportunityId}`);
      return null;
    }

    // Create draft
    const draft: JiraDraft = {
      id: `jira-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      opportunityId,
      epicName: opportunity.title,
      description: `Epic for: ${opportunity.summary}\n\nPain points: ${opportunity.title}\nEvidence: ${(opportunity.evidenceIds || []).length} signals`,
      labels: ["radar-generated", `opportunity:${opportunity.id}`],
      status: "draft",
    };

    // Save draft
    await this.storage.writeJson(`jira-drafts/${draft.id}.json`, draft);

    console.log(`[JiraDraft] Created ${draft.id} for opportunity ${opportunityId}`);

    return draft;
  }
}