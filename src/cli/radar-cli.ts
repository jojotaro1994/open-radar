/**
 * radar-cli.ts — interactive CLI for the Prototype Radar.
 *
 * CLI-first agent. Five-object persistent model:
 *   Current Intent   — persistent truth: what the radar is looking for and why
 *   Search Context   — persistent: how to search, source weights, topic boosts/suppressions
 *   Knowledge Pack   — persistent: what the system knows about the business world
 *   Meeting Charter  — persistent: how to discuss, frame judgment, required questions
 *   Last Run         — read-only projection of most recent /run
 *
 * ActiveStrategy (session patches) is a transitional compatibility overlay only.
 * It is NOT the authoritative long-lived product model.
 *
 * Change flow: draft -> structured preview -> refine/rewrite -> confirm (y/n) -> apply
 *
 * Run: npx tsx src/cli/radar-cli.ts [--intent=riplus-ma]
 */

import * as path from "path"
import * as fs from "fs"
import * as readline from "readline"
import type { RadarIntent } from "../schemas/intent.js"
import type { LastRunSummary } from "../state/last-run.js"
import { ActiveStrategyManager } from "../state/active-strategy.js"
import { LastRunStore } from "../state/last-run.js"
import { SearchContextStore } from "../state/search-context-store.js"
import { KnowledgePackStore } from "../state/knowledge-pack-store.js"
import { MeetingCharterStore } from "../state/meeting-charter-store.js"
import { printState } from "../state/state-printer.js"
import { buildPatchAction } from "./patch-handler.js"
import { runPipeline } from "../orchestrator/run-pipeline.js"
import { inferDefaultSourceRole } from "../state/source-role.js"

const DATA_DIR = process.env.RADAR_DATA_DIR ?? path.join(process.cwd(), "data")
const CONFIG_DIR = path.join(process.cwd(), "config")

function loadIntent(intentId: string): RadarIntent {
  const intentPath = path.join(process.cwd(), "config", "intents", `${intentId}.json`)
  if (!fs.existsSync(intentPath)) throw new Error(`Intent not found: ${intentPath}`)
  return JSON.parse(fs.readFileSync(intentPath, "utf-8")) as RadarIntent
}

function intentPath(intentId: string): string {
  return path.join(process.cwd(), "config", "intents", `${intentId}.json`)
}

async function main(): Promise<void> {
  const intentArg = process.argv.find(a => a.startsWith("--intent="))
  const intentId = intentArg ? intentArg.split("=")[1]! : "riplus-ma"

  let intent = loadIntent(intentId)
  const strategyManager = new ActiveStrategyManager()
  const lastRunStore = new LastRunStore(DATA_DIR)
  const searchContextStore = new SearchContextStore(CONFIG_DIR)
  const knowledgePackStore = new KnowledgePackStore(CONFIG_DIR)
  const meetingCharterStore = new MeetingCharterStore(CONFIG_DIR)
  let running = false

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  })

  console.log(`\nRadar CLI — intent: ${intentId}`)
  console.log(`Commands: /state  /undo  /reset  /help  /exit`)
  console.log(`Natural language: describe what you want to adjust\n`)

  // Pending persistent-change confirmation state
  type PendingConfirm = { onConfirm: () => string; onCancel: () => string }
  let pendingConfirm: PendingConfirm | null = null

  rl.prompt()

  rl.on("line", async (rawLine: string) => {
    const line = rawLine.trim()

    if (!line) {
      rl.prompt()
      return
    }

    // ── Pending confirmation (y/n for persistent change) ──────────────────
    if (pendingConfirm) {
      const answer = line.toLowerCase()
      if (answer === "y" || answer === "yes") {
        console.log(pendingConfirm.onConfirm())
        // Reload intent so subsequent /state shows updated truth
        intent = loadIntent(intentId)
      } else {
        console.log(pendingConfirm.onCancel())
      }
      pendingConfirm = null
      rl.prompt()
      return
    }

    // ── Built-in commands ─────────────────────────────────────────────────
    if (line === "/exit" || line === "/quit") {
      console.log("Exiting.")
      rl.close()
      return
    }

    if (line === "/state") {
      const searchCtx = searchContextStore.load(intentId)
      const kpack = knowledgePackStore.load(intentId)
      const charter = meetingCharterStore.load(intentId)
      printState(
        intent,
        strategyManager.get(),
        lastRunStore.load(),
        searchCtx
          ? { sourceWeights: Object.fromEntries(searchCtx.sourceWeights.map(w => [w.sourceId, w.weight])), topicBoosts: searchCtx.topicBoosts.map(b => b.term), topicSuppressions: searchCtx.topicSuppressions, recallMode: searchCtx.recallMode }
          : {},
        kpack
          ? { productCapabilities: kpack.productCapabilities.map(c => c.capability), knownLimitations: kpack.knownLimitations, verticalContext: kpack.verticalContext }
          : {},
        charter
          ? { objective: charter.objective, primaryLens: charter.primaryLens, requiredQuestions: charter.requiredQuestions.map(q => q.question) }
          : {}
      )
      rl.prompt()
      return
    }

    if (line === "/undo") {
      const undone = strategyManager.undoLast()
      if (undone) {
        console.log(`已撤销: patch #${undone.seq}  ${undone.field} ← "${undone.trigger}"`)
      } else {
        console.log("没有可撤销的 session patch。")
      }
      rl.prompt()
      return
    }

    if (line === "/reset") {
      strategyManager.clear()
      console.log("已清除所有 session patches。Active Strategy 已重置。")
      rl.prompt()
      return
    }

    if (line === "/run") {
      if (running) { console.log("Pipeline is already running. Please wait."); rl.prompt(); return }
      running = true
      console.log(`\nExecuting pipeline — intent=${intentId}...`)
      try {
        const result = await runPipeline({
          intent,
          dataDir: DATA_DIR,
          strategy: strategyManager.get(),
          useCommercialAnalyst: process.env.USE_COMMERCIAL_ANALYST === "true",
        })
        const summary: LastRunSummary = {
          timestamp: new Date().toISOString(),
          intentId: intent.id,
          sessionPatchCount: strategyManager.get().patches.length,
          sources: Object.entries(result.sourceCounts).map(([name, count]) => ({
            name,
            role: inferDefaultSourceRole(name),
            signalCount: count,
          })),
          pipeline: {
            ingested: result.ingested,
            scored: result.scored,
            qualified: result.qualifiedCount,
            enqueuedForTriage: result.enqueuedForTriage,
          },
        }
        lastRunStore.save(summary)
        console.log(`\nDone. ${result.ingested} ingested → ${result.scored} scored → ${result.approved} approved → ${result.opportunities} opportunities`)
        console.log(`Last Run saved. Use /state to view.`)
      } catch (err) {
        console.error(`Pipeline failed: ${err}`)
      } finally {
        running = false
      }
      rl.prompt()
      return
    }

    if (line === "/help") {
      console.log([
        "",
        "Commands:",
        "  /state   — 查看 Current Intent / Search Context / Knowledge Pack / Meeting Charter / Last Run",
        "  /undo    — 撤销最后一个 session patch",
        "  /reset   — 清除所有 session patches",
        "  /run     — (提示) 使用 runner 脚本执行完整管道",
        "  /exit    — 退出",
        "",
        "Persistent change (preview-first — default for relevantThreshold/excludeTags):",
        '  "降低相关度门槛到 0.2"        → structured preview → confirm → persistent change',
        '  "从现在起都排除 demo 标签"    → structured preview → confirm → persistent change',
        '  "从现在起相关度门槛改为 0.5"  → structured preview → confirm → persistent change',
        "",
        "Session patch (explicit scope marker required — applies to this session only):",
        '  "这轮只看保险方向"            → immediate apply, focus for this session only',
        '  "这轮降低相关度门槛到 0.2"    → immediate apply, threshold for this session only',
        '  "暂停 confluence"             → immediate apply, pause for this session only',
        "",
        "Keywords:",
        '  "从现在起" "永久" "一直" "以后都"   → persistent (structured preview + y/n)',
        '  "这轮" "先" "暂时" "临时"           → session patch (immediate, no preview)',
        '  (no keyword)                      → persistent change (preview-first)',
        "",
      ].join("\n"))
      rl.prompt()
      return
    }

    // ── Natural language patch handling ───────────────────────────────────
    const action = buildPatchAction(line, intent, strategyManager, intentPath(intentId))

    switch (action.type) {
      case "session_applied":
        console.log(action.message)
        break

      case "persistent_confirm":
        console.log(action.preview)
        pendingConfirm = { onConfirm: action.onConfirm, onCancel: action.onCancel }
        // Do NOT call rl.prompt() — wait for the y/n answer
        return

      case "no_op":
        console.log(action.message)
        break

      case "unrecognized":
        console.log(action.message)
        break
    }

    rl.prompt()
  })

  rl.on("close", () => {
    process.exit(0)
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
