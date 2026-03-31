import { EventBus } from "../infrastructure/event-bus.js";
import { StorageHelper } from "../infrastructure/storage-helper.js";
import type { PrototypeBrief } from "../schemas/prototype-brief.js";
import type { Attribution } from "../schemas/attribution.js";
import { getOpenRouterChatCompletionsUrl, loadOpenRouterProviderConfig } from "../config/provider-config.js";
import { DEFAULT_PROTOTYPE_BRIEF_MODEL, getLayerSelection } from "../state/model-config.js";
import { ModelConfigStore } from "../state/model-config-store.js";
import * as path from "path";

const CONFIG_DIR = path.join(process.cwd(), "config");
const MODEL_CONFIG_STORE = new ModelConfigStore(CONFIG_DIR);

interface LlmBriefOutput {
  problemStatement: string;
  targetUser: string;
  proposedSolution: string;
  keyFeatures: string[];
  constraints: string[];
}

export class PrototypeBriefConsumer {
  constructor(private eventBus: EventBus, private storage: StorageHelper) {}

  /**
   * Call OpenRouter LLM (OpenAI-compatible) to generate a structured brief.
   * Falls back to stub content on failure.
   * Returns { output, modelId } where output is the brief fields.
   */
  private async generateWithLLM(
    opportunity: any,
    painCard: any,
    evidenceExcerpts: string[],
    productContext?: string,
    intentId?: string
  ): Promise<{ output: Partial<PrototypeBrief>; modelId: string }> {
    const evidenceContext = evidenceExcerpts.length > 0
      ? evidenceExcerpts.map((ex, i) => `Evidence ${i + 1}: "${ex}"`).join("\n")
      : "";

    const systemPrompt = productContext
      ? `You are a product strategy assistant for a specific product.\n\n## Product Context\n${productContext}\n\nReturn ONLY valid JSON with keys: problemStatement, targetUser, proposedSolution, keyFeatures (array), constraints (array). No markdown, no explanation.`
      : `You are a product strategy assistant. Return ONLY valid JSON with keys: problemStatement, targetUser, proposedSolution, keyFeatures (array), constraints (array). No markdown, no explanation.`;

    const userPrompt = `Opportunity: ${opportunity.title || 'Unknown'}
Summary: ${opportunity.summary || 'No summary'}
Pain: ${painCard.painStatement || 'No pain statement'}
User: ${painCard.affectedPersona || 'End user'}
${evidenceContext ? 'Evidence: ' + evidenceContext : ''}`;

    const providerConfig = loadOpenRouterProviderConfig();
    const apiKey = providerConfig.apiKey;
    const configuredModel = intentId
      ? getLayerSelection(MODEL_CONFIG_STORE.loadOrDefault(intentId), "consumer.prototypeBrief")?.model
      : null;
    const models = [configuredModel, providerConfig.defaultModel, DEFAULT_PROTOTYPE_BRIEF_MODEL]
      .filter((value): value is string => Boolean(value))
      .filter((value, index, list) => list.indexOf(value) === index);

    if (!apiKey) {
      console.warn("[PrototypeBrief] OpenRouter API key not configured. Falling back to stub output.");
      return { output: {}, modelId: "none" };
    }

    let lastError = "";
    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      try {
        const response = await fetch(getOpenRouterChatCompletionsUrl(providerConfig), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model.trim(),
            max_tokens: 2048,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errorBody = await response.text();
          lastError = `model=${model} status=${response.status}`;
          console.warn(`[PrototypeBrief] ${model} error ${response.status}: ${errorBody.slice(0, 100)}`);
          continue;
        }

        const rawText = await response.text();
        const data = JSON.parse(rawText);
        let content: string | null = data.choices?.[0]?.message?.content ?? null;

        if (!content) {
          lastError = `model=${model} empty content`;
          continue;
        }

        // Strip markdown fences
        content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

        if (content.length < 10) {
          lastError = `model=${model} content too short`;
          continue;
        }

        let parsed: LlmBriefOutput;
        try {
          parsed = JSON.parse(content);
        } catch {
          // Try recovering truncated JSON
          const lastValidIndex = content.lastIndexOf('"}');
          if (lastValidIndex > 50) {
            try {
              const partial = content.slice(0, lastValidIndex + 2) + ']}';
              parsed = JSON.parse(partial);
            } catch {
              lastError = `model=${model} JSON parse failed`;
              continue;
            }
          } else {
            lastError = `model=${model} truncated JSON recovery failed`;
            continue;
          }
        }

        console.log(`[PrototypeBrief] SUCCESS with model=${model}`);
        return {
          output: {
            problemStatement: parsed.problemStatement ?? "Problem statement not generated",
            targetUser: parsed.targetUser ?? painCard.affectedPersona ?? "End User",
            proposedSolution: parsed.proposedSolution ?? "Solution not generated",
            keyFeatures: Array.isArray(parsed.keyFeatures) && parsed.keyFeatures.length > 0
              ? parsed.keyFeatures
              : ["feature-1 - stub feature", "feature-2 - stub feature"],
            constraints: Array.isArray(parsed.constraints) && parsed.constraints.length > 0
              ? parsed.constraints
              : ["MVP only", "stub implementation"],
          },
          modelId: model.trim(),
        };
      } catch (err: any) {
        clearTimeout(timeout);
        lastError = `model=${model} ${err?.name ?? err?.message ?? err}`;
        if (err.name === 'AbortError') {
          console.warn(`[PrototypeBrief] ${model} timed out after 20s`);
        } else {
          console.warn(`[PrototypeBrief] ${model} error: ${err?.message ?? err}`);
        }
        continue;
      }
    }

    // All models failed
    console.warn(`[PrototypeBrief] All ${models.length} models failed. Last error: ${lastError}`);
    return { output: {}, modelId: "none" };
  }

  async process(event: string, payload: any): Promise<PrototypeBrief | null> {
    if (event !== "opportunity.created") {
      return null;
    }

    const { opportunityId, productContext, intentId, sourceAdapterId } = payload;

    // Load the opportunity
    const opportunity = await this.storage.readJson<any>(`opportunities/${opportunityId}.json`);
    if (!opportunity) {
      console.log(`[PrototypeBrief] Opportunity not found: ${opportunityId}`);
      return null;
    }

    // Load PainCard(s) referenced in the opportunity
    const painCards: any[] = [];
    for (const painCardId of opportunity.painCardIds || []) {
      const painCard = await this.storage.readJson<any>(`pain-cards/${painCardId}.json`);
      if (painCard) {
        painCards.push(painCard);
      }
    }

    // Load evidence excerpts for context
    const evidenceExcerpts: string[] = [];
    for (const evidenceId of opportunity.evidenceIds || []) {
      const evidence = await this.storage.readJson<any>(`evidence/${evidenceId}.json`);
      if (evidence?.excerpt) {
        evidenceExcerpts.push(evidence.excerpt);
      }
    }

    // Load first pain card for template interpolation
    const painCard = painCards[0] || { painStatement: "No pain card found", affectedPersona: "Unknown", frequency: 0 };

    // Try LLM generation with productContext
    const { output: llmOutput, modelId } = await this.generateWithLLM(
      opportunity,
      painCard,
      evidenceExcerpts,
      productContext,
      intentId
    );

    // Use template interpolation for problemStatement as fallback
    let problemStatement: string = llmOutput.problemStatement ?? "";
    if (!llmOutput.problemStatement) {
      const template = await this.storage.readJson<any>("prompts/prototype_brief_prompt.json");
      if (template?.templateBody) {
        problemStatement = template.templateBody
          .replace(/\{\{opportunity\.title\}\}/g, opportunity.title ?? '')
          .replace(/\{\{opportunity\.summary\}\}/g, opportunity.summary ?? '')
          .replace(/\{\{painCard\.painStatement\}\}/g, painCard.painStatement ?? '')
          .replace(/\{\{painCard\.affectedPersona\}\}/g, painCard.affectedPersona ?? '')
          .replace(/\{\{painCard\.frequency\}\}/g, String(painCard.frequency ?? 0));
      } else {
        problemStatement = `Problem for: ${opportunity.title}`;
      }
    }

    // Build attribution from opportunity or payload
    const attribution: Attribution = {
      intentId: intentId ?? opportunity.attribution?.intentId ?? "unknown",
      sourceAdapterId: sourceAdapterId ?? opportunity.attribution?.sourceAdapterId ?? "unknown",
      modelId,
      analyzedAt: new Date().toISOString(),
    };

    // Create brief
    const brief: PrototypeBrief = {
      id: `pb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      opportunityId,
      problemStatement,
      targetUser: llmOutput.targetUser ?? (painCard.affectedPersona ?? "End User"),
      proposedSolution: llmOutput.proposedSolution ?? `Auto-generated stub solution for: ${opportunity.title}`,
      keyFeatures: llmOutput.keyFeatures ?? ["feature-1 - stub feature", "feature-2 - stub feature", "feature-3 - stub feature"],
      constraints: llmOutput.constraints ?? ["MVP only", "stub implementation"],
      attribution,
    };

    // Save brief
    await this.storage.writeJson(`briefs/prototype/${brief.id}.json`, brief);

    console.log(`[PrototypeBrief] Created ${brief.id} for opportunity ${opportunityId} (model=${modelId})`);

    // Emit event so VideoBriefConsumer can chain
    await this.eventBus.emit("prototypeBrief.created", { prototypeBriefId: brief.id, opportunityId, brief });

    return brief;
  }
}
