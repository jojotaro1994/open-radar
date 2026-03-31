/**
 * regenerate-stubs.ts — Regenerate prototype briefs that are stubs
 *
 * Run: npx tsx src/orchestrator/regenerate-stubs.ts
 *
 * Reads all prototype briefs, identifies stubs (proposedSolution starts with
 * "Auto-generated stub"), loads the corresponding opportunity + pain cards +
 * evidence, re-generates the brief using generateWithLLM(), and overwrites the
 * stub file with real content.
 */

import * as path from "path"
import * as fs from "fs"

const DATA_DIR = path.join(process.cwd(), "data")
const BRIEFS_DIR = path.join(DATA_DIR, "briefs/prototype")
const OPPORTUNITIES_DIR = path.join(DATA_DIR, "opportunities")
const PAIN_CARDS_DIR = path.join(DATA_DIR, "pain-cards")
const EVIDENCE_DIR = path.join(DATA_DIR, "evidence")

const ANTHROPIC_API_URL = (() => {
  const base = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"
  return base.endsWith("/v1/messages") ? base : `${base}/v1/messages`
})()

interface LlmBriefOutput {
  problemStatement: string
  targetUser: string
  proposedSolution: string
  keyFeatures: string[]
  constraints: string[]
}

async function generateWithLLM(
  opportunity: any,
  painCard: any,
  evidenceExcerpts: string[]
): Promise<Partial<LlmBriefOutput>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn("[regen] ANTHROPIC_API_KEY not set, skipping LLM call")
    return {}
  }

  const evidenceContext =
    evidenceExcerpts.length > 0
      ? evidenceExcerpts.map((ex, i) => `Evidence ${i + 1}: "${ex}"`).join("\n")
      : "No evidence excerpts available."

  const userMessage = `You are a product strategy assistant. Generate a structured prototype brief based on the opportunity below.

Opportunity Title: ${opportunity.title}
Opportunity Summary: ${opportunity.summary}
Pain Statement: ${painCard.painStatement}
Affected User: ${painCard.affectedPersona}
Signal Frequency: ${painCard.frequency} users reported this

${evidenceContext}

Generate a structured prototype brief as JSON with exactly this shape:
{
  "problemStatement": "1-2 sentence specific problem description",
  "targetUser": "who experiences this problem",
  "proposedSolution": "1-2 sentence actionable solution description",
  "keyFeatures": ["feature - description", ...] (3-5 features),
  "constraints": ["constraint1", "constraint2"] (2-3 practical constraints)
}

Respond ONLY with valid JSON, no markdown, no explanation.`

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "MiniMax-M2.7",
        max_tokens: 1024,
        messages: [{ role: "user", content: userMessage }],
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.warn(`[regen] LLM call failed: ${response.status} ${errorBody.slice(0, 200)}`)
      return {}
    }

    const data: any = await response.json()
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: any) => b.type === "text")
      : null
    const content = textBlock?.text ?? (typeof data.content === "string" ? data.content : null)

    if (!content) {
      console.warn("[regen] LLM returned empty content")
      return {}
    }

    const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    const parsed = JSON.parse(cleaned) as LlmBriefOutput

    return {
      problemStatement: parsed.problemStatement ?? "Problem statement not generated",
      targetUser: parsed.targetUser ?? painCard.affectedPersona ?? "End User",
      proposedSolution: parsed.proposedSolution ?? "Solution not generated",
      keyFeatures:
        Array.isArray(parsed.keyFeatures) && parsed.keyFeatures.length > 0
          ? parsed.keyFeatures
          : ["feature-1 - stub feature", "feature-2 - stub feature"],
      constraints:
        Array.isArray(parsed.constraints) && parsed.constraints.length > 0
          ? parsed.constraints
          : ["MVP only", "stub implementation"],
    }
  } catch (err) {
    console.warn(`[regen] LLM generation failed: ${err}`)
    return {}
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8")
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
}

async function main(): Promise<void> {
  console.log("[regen] Starting stub regeneration...\n")

  // Read all brief files
  const briefFiles = (await fs.promises.readdir(BRIEFS_DIR)).filter(f => f.endsWith(".json"))
  console.log(`[regen] Found ${briefFiles.length} prototype briefs\n`)

  const stubs: { filePath: string; brief: any }[] = []
  for (const file of briefFiles) {
    const fullPath = path.join(BRIEFS_DIR, file)
    const brief = await readJson<any>(fullPath)
    if (!brief) continue
    if (typeof brief.proposedSolution === "string" && brief.proposedSolution.startsWith("Auto-generated stub")) {
      stubs.push({ filePath: fullPath, brief })
    }
  }

  console.log(`[regen] Found ${stubs.length} stub briefs to regenerate\n`)

  if (stubs.length === 0) {
    console.log("[regen] No stubs found — nothing to do!")
    return
  }

  let success = 0
  let failed = 0
  let skipped = 0

  for (const { filePath, brief } of stubs) {
    const oppId = brief.opportunityId
    const oppPath = path.join(OPPORTUNITIES_DIR, `${oppId}.json`)
    const opportunity = await readJson<any>(oppPath)

    if (!opportunity) {
      console.warn(`[regen] SKIP ${oppId}: opportunity not found`)
      skipped++
      continue
    }

    // Load pain cards
    const painCards: any[] = []
    for (const painCardId of opportunity.painCardIds || []) {
      const pc = await readJson<any>(path.join(PAIN_CARDS_DIR, `${painCardId}.json`))
      if (pc) painCards.push(pc)
    }

    // Load evidence excerpts
    const evidenceExcerpts: string[] = []
    for (const evidenceId of opportunity.evidenceIds || []) {
      const ev = await readJson<any>(path.join(EVIDENCE_DIR, `${evidenceId}.json`))
      if (ev?.excerpt) evidenceExcerpts.push(ev.excerpt)
    }

    const painCard = painCards[0] || {
      painStatement: "No pain card found",
      affectedPersona: "Unknown",
      frequency: 0,
    }

    console.log(`[regen] Regenerating ${brief.id} for opp ${oppId}: "${opportunity.title?.slice(0, 60)}"`)

    // Rate-limit: sleep 1s between LLM calls to avoid hitting limits
    await new Promise(resolve => setTimeout(resolve, 1000))

    const llmOutput = await generateWithLLM(opportunity, painCard, evidenceExcerpts)

    if (!llmOutput.proposedSolution || llmOutput.proposedSolution === "Solution not generated") {
      console.warn(`[regen] FAILED ${brief.id}: LLM did not return content`)
      failed++
      continue
    }

    // Preserve the original id and opportunityId, update everything else
    const regenerated: any = {
      ...brief,
      problemStatement:
        llmOutput.problemStatement ?? brief.problemStatement,
      targetUser: llmOutput.targetUser ?? brief.targetUser,
      proposedSolution: llmOutput.proposedSolution,
      keyFeatures: llmOutput.keyFeatures ?? brief.keyFeatures,
      constraints: llmOutput.constraints ?? brief.constraints,
    }

    await writeJson(filePath, regenerated)
    console.log(`[regen] SUCCESS ${brief.id}: updated with real content`)
    success++
  }

  console.log(`\n[regen] === DONE ===`)
  console.log(`[regen] Total: ${stubs.length} stubs`)
  console.log(`[regen] Success: ${success} | Failed: ${failed} | Skipped: ${skipped}`)
}

main().catch(err => {
  console.error("[regen] Fatal error:", err)
  process.exit(1)
})
