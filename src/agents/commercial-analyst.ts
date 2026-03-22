/**
 * Commercial Analyst
 *
 * LLM-powered commercial judgment layer — replaces rule-based qualification
 * as the primary commercial relevance decision.
 *
 * Takes a ScoredSignal + RadarIntent and returns a CommercialAssessment with:
 *   - Is this a real growth opportunity?
 *   - Which verticals does it affect?
 *   - How compelling is the commercial argument?
 *   - What evidence is missing?
 *
 * This is the core of the "commercial judgment" described in Section 13.
 *
 * Design constraints:
 * - Works alongside rule-based qualification (not replacing it entirely)
 * - Rule-based qualification acts as cheap first-pass noise reduction
 * - Commercial Analyst assesses what passes the first pass
 * - Falls back gracefully if LLM call fails (returns noise category with confidence=0.1)
 */

import type { ScoredSignal } from "../adapters/source-adapter.js"
import type { RadarIntent } from "../schemas/intent.js"
import type { CommercialAssessment, AssessmentCategory } from "../schemas/commercial-assessment.js"
import type { Attribution } from "../schemas/attribution.js"
import type { KnowledgePack } from "../state/knowledge-pack.js"

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "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"
const OPENROUTER_MODELS = (
  process.env.OPENROUTER_BRIEF_MODELS ?? "arcee-ai/trinity-large-preview:free,stepfun/step-3.5-flash:free"
).split(",")

const DEFAULT_SYSTEM_PROMPT = `You are a senior commercial analyst for a B2B marketing automation platform.

Your job: given a signal (user feedback, feature request, or pain point), determine if it represents a genuine commercial GROWTH opportunity.

Evaluate each signal on:
1. VERTICAL FIT: Does it map to a specific industry vertical (insurance, travel, retail, finance)?
2. COMMERCIAL IMPACT: Does it affect revenue, retention, or competitive positioning?
3. PRODUCT FIT: Can the marketing automation platform actually solve this?
4. EVIDENCE QUALITY: Is the pain point specific and validated, or vague?

Respond ONLY with valid JSON matching this exact schema:
{
  "commercialRelevance": true|false,
  "category": "growth_opportunity"|"feature_request"|"workflow_friction"|"support_friction"|"bug"|"noise",
  "reasoning": "2-3 sentence explanation of your judgment",
  "confidence": 0.0-1.0,
  "opportunityScore": 0.0-1.0,
  "verticalTags": ["insurance"]|["travel"]|["insurance","travel"]|[],
  "missingEvidence": ["what would strengthen this"]
}

Rules:
- "growth_opportunity": validated pain point with clear commercial impact and vertical specificity
- "feature_request": explicit new capability request, commercial impact unclear
- "workflow_friction": existing workflow is painful, improvement opportunity
- "support_friction": known pain but not a new opportunity
- "bug": defect, belongs in bug tracker
- "noise": vague, unrelated, or insufficient evidence
- If unsure, lean toward "noise" with low confidence
- Be specific about which verticals apply`

export class CommercialAnalyst {
  /**
   * Assess a single signal's commercial relevance using LLM reasoning.
   * Optionally uses KnowledgePack.opportunityHeuristics for richer context.
   */
  async assess(
    signal: ScoredSignal,
    intent: RadarIntent,
    knowledgePack?: KnowledgePack
  ): Promise<CommercialAssessment> {
    const signalText = `${signal.title}\n\n${signal.body}`.slice(0, 2000)
    const verticalContext = this.buildVerticalContext(intent, knowledgePack)

    const userPrompt = `Signal to assess:
Title: ${signal.title}
Body: ${signalText}
Tags: ${(signal.tags ?? []).join(", ")}
Source: ${signal.sourceType}
Vertical: ${(signal as any).metadata?.vertical ?? "unknown"}
${verticalContext}

Assess this signal.`

    const result = await this.callLLM(DEFAULT_SYSTEM_PROMPT, userPrompt, signal.id, intent.id)

    return {
      signalId: signal.id,
      commercialRelevance: result.commercialRelevance,
      category: result.category,
      reasoning: result.reasoning,
      confidence: result.confidence,
      opportunityScore: result.opportunityScore,
      verticalTags: result.verticalTags,
      missingEvidence: result.missingEvidence,
      attribution: {
        intentId: intent.id,
        sourceAdapterId: (signal as any).attribution?.sourceAdapterId ?? "unknown",
        modelId: result.modelId,
        analyzedAt: new Date().toISOString(),
      },
    }
  }

  /**
   * Assess multiple signals in batch (parallel LLM calls).
   * Optionally uses KnowledgePack.opportunityHeuristics for richer context.
   */
  async batchAssess(
    signals: ScoredSignal[],
    intent: RadarIntent,
    knowledgePack?: KnowledgePack
  ): Promise<CommercialAssessment[]> {
    return Promise.all(signals.map(s => this.assess(s, intent, knowledgePack)))
  }

  /**
   * Build context string for the LLM prompt.
   * Includes productContext and KnowledgePack.opportunityHeuristics when available.
   */
  private buildVerticalContext(intent: RadarIntent, knowledgePack?: KnowledgePack): string {
    const parts: string[] = []

    if (intent.productContext) {
      parts.push(`Product context:\n${intent.productContext.slice(0, 1000)}`)
    }

    if (knowledgePack?.opportunityHeuristics?.length) {
      const heuristics = knowledgePack.opportunityHeuristics
        .map(h => `  - [${h.confidence}] ${h.pattern}: ${h.rationale}`)
        .join("\n")
      parts.push(`Opportunity heuristics:\n${heuristics}`)
    }

    return parts.length > 0 ? `\n${parts.join("\n\n")}` : ""
  }

  private async callLLM(
    systemPrompt: string,
    userPrompt: string,
    signalId: string,
    intentId: string
  ): Promise<{
    commercialRelevance: boolean
    category: AssessmentCategory
    reasoning: string
    confidence: number
    opportunityScore: number
    verticalTags: string[]
    missingEvidence: string[]
    modelId: string
  }> {
    let lastError = ""

    for (const model of OPENROUTER_MODELS) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000)

      try {
        const response = await fetch(OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          },
          body: JSON.stringify({
            model: model.trim(),
            max_tokens: 1024,
            temperature: 0.1,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        })

        clearTimeout(timeout)

        if (!response.ok) {
          lastError = `HTTP ${response.status}`
          continue
        }

        const data: any = await response.json()
        const content = data.choices?.[0]?.message?.content?.trim()

        if (!content) {
          lastError = "Empty response"
          continue
        }

        // Strip markdown code fences if present
        const jsonStr = content.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim()
        const parsed = JSON.parse(jsonStr)

        return {
          commercialRelevance: Boolean(parsed.commercialRelevance),
          category: parsed.category ?? "noise",
          reasoning: parsed.reasoning ?? "No reasoning provided",
          confidence: Number(parsed.confidence) || 0.5,
          opportunityScore: Number(parsed.opportunityScore) || 0.0,
          verticalTags: Array.isArray(parsed.verticalTags) ? parsed.verticalTags : [],
          missingEvidence: Array.isArray(parsed.missingEvidence) ? parsed.missingEvidence : [],
          modelId: model.trim(),
        }
      } catch (err: any) {
        clearTimeout(timeout)
        lastError = err.message ?? String(err)
      }
    }

    // Fallback: if all models fail, return noise with low confidence
    console.warn(`[CommercialAnalyst] All LLM models failed for signal ${signalId}: ${lastError}. Falling back to noise.`)
    return {
      commercialRelevance: false,
      category: "noise",
      reasoning: `LLM assessment failed: ${lastError}. Defaulted to noise.`,
      confidence: 0.1,
      opportunityScore: 0.0,
      verticalTags: [],
      missingEvidence: ["LLM assessment unavailable"],
      modelId: "fallback",
    }
  }
}
