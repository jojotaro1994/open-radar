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
import { RunContextStore } from "../state/run-context-store.js"
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

/**
 * reviewRun — shows what happened in the last pipeline run.
 *
 * Uses:
 *   LastRunSummary  — latest run stats and source breakdown
 *   RunContext      — latest cycle context snapshot (SearchContext, KnowledgePack, MeetingCharter)
 *
 * Always shows the most recent run. There is no historical cycle traversal.
 */
function reviewRun(
  dataDir: string,
  runContextStore: RunContextStore,
  lastRunStore: LastRunStore,
  intentId: string
): string {
  // Always use the most recent cycle
  const allCycles = runContextStore.list().sort()
  const targetCycleId = allCycles[allCycles.length - 1] ?? null

  if (!targetCycleId) {
    return `No run history found. Run /run first.`
  }

  const ctx = runContextStore.load(targetCycleId)
  const lastRun = lastRunStore.load()

  const lines: string[] = []
  lines.push(`\n── Radar Review ──────────────────────`)
  lines.push(`Cycle:    ${targetCycleId}`)
  lines.push(`Intent:   ${ctx?.intentId ?? intentId}`)

  if (ctx?.pipelineStats) {
    const ps = ctx.pipelineStats
    lines.push(``)
    lines.push(`Pipeline:`)
    lines.push(`  ingested:           ${ps.ingested}`)
    lines.push(`  scored:            ${ps.scored}`)
    lines.push(`  qualified:         ${ps.qualified}`)
    lines.push(`  enqueuedForTriage: ${ps.enqueuedForTriage}`)
    lines.push(`  approved:          ${ps.approved}`)
    lines.push(`  rejected:          ${ps.rejected}`)
    lines.push(`  deferred:          ${ps.deferred}`)
    lines.push(`  themes:            ${ps.themes}`)
    lines.push(`  opportunities:     ${ps.opportunities}`)
  } else {
    lines.push(`(pipeline stats not available for this cycle)`)
  }

  // Source stats from LastRun
  if (lastRun?.sources && lastRun.sources.length > 0) {
    lines.push(``)
    lines.push(`Sources:`)
    for (const s of lastRun.sources) {
      lines.push(`  ${s.name} (${s.role}): ${s.signalCount} signals`)
    }
  }

  // SearchContext summary
  if (ctx?.searchContext && Object.keys(ctx.searchContext).length > 0) {
    lines.push(``)
    lines.push(`SearchContext:`)
    if (ctx.searchContext.recallMode) lines.push(`  recallMode:     ${ctx.searchContext.recallMode}`)
    if (ctx.searchContext.topicBoosts?.length) lines.push(`  topicBoosts:    ${ctx.searchContext.topicBoosts.join(", ")}`)
    if (ctx.searchContext.topicSuppressions?.length) lines.push(`  suppressions:   ${ctx.searchContext.topicSuppressions.join(", ")}`)
    if (ctx.searchContext.sourceWeights && Object.keys(ctx.searchContext.sourceWeights).length > 0) {
      const entries = Object.entries(ctx.searchContext.sourceWeights).map(([k, v]) => `${k}=${v}`).join(", ")
      lines.push(`  sourceWeights: ${entries}`)
    }
  }

  // KnowledgePack summary
  if (ctx?.knowledgePack && Object.keys(ctx.knowledgePack).length > 0) {
    lines.push(``)
    lines.push(`KnowledgePack:`)
    if (ctx.knowledgePack.productCapabilities?.length) {
      lines.push(`  productCapabilities: ${ctx.knowledgePack.productCapabilities.join(", ")}`)
    }
    if (ctx.knowledgePack.verticalContext) {
      const vc = (ctx.knowledgePack.verticalContext as string)
      lines.push(`  verticalContext: ${vc.slice(0, 80)}${vc.length > 80 ? "..." : ""}`)
    }
  }

  // MeetingCharter summary
  if (ctx?.meetingCharter && Object.keys(ctx.meetingCharter).length > 0) {
    lines.push(``)
    lines.push(`MeetingCharter:`)
    if (ctx.meetingCharter.objective) lines.push(`  objective:        ${ctx.meetingCharter.objective}`)
    if (ctx.meetingCharter.primaryLens) lines.push(`  primaryLens:     ${ctx.meetingCharter.primaryLens}`)
    if (ctx.meetingCharter.requiredQuestions?.length) {
      lines.push(`  requiredQuestions:`)
      for (const q of ctx.meetingCharter.requiredQuestions) {
        lines.push(`    - ${q}`)
      }
    }
  }

  lines.push(`─────────────────────────────────\n`)
  return lines.join("\n")
}

/**
 * explainSignal — reconstructs why a signal was triaged the way it was.
 *
 * Reads:
 *   data/review-queue/{signalId}/meta.json      — cycleId, enqueuedAt
 *   data/review-queue/{signalId}/status.json    — current status
 *   data/review-queue/{signalId}/triage.json    — triage decision + reason
 *   data/scored-signals/{signalId}.json        — signal title, relevanceScore, qualification
 *   data/run-contexts/{cycleId}.json            — context at time of triage (if available)
 */
function explainSignal(
  signalId: string,
  dataDir: string,
  runContextStore: RunContextStore
): string {
  const queueDir = path.join(dataDir, "review-queue", signalId)

  const meta = readJsonOrNull(path.join(queueDir, "meta.json")) as
    | { signalId: string; cycleId: string; enqueuedAt: string }
    | null
  const status = readJsonOrNull(path.join(queueDir, "status.json")) as
    | { status: string }
    | null
  const triage = readJsonOrNull(path.join(queueDir, "triage.json")) as
    | { decision: string; reviewedBy: string; reviewedAt: string; reason?: string }
    | null
  const signal = readJsonOrNull(
    path.join(dataDir, "scored-signals", `${signalId}.json`)
  ) as Record<string, unknown> | null

  if (!meta || !status) {
    return `Signal "${signalId}" not found in review queue.`
  }

  const lines: string[] = []
  lines.push(`\n── Signal: ${signalId} ──`)

  if (signal) {
    const title = (signal.title as string) ?? "(no title)"
    const score = (signal.relevanceScore as number)?.toFixed(3) ?? "unknown"
    const qual = (signal.qualification as { qualification?: string })?.qualification ?? "unknown"
    lines.push(`Title:   ${title}`)
    lines.push(`Score:   ${score}  |  Qualification: ${qual}`)
  } else {
    lines.push(`(scored signal not found — run may be older)`)
  }

  lines.push(`Status:  ${status.status}`)
  if (triage) {
    lines.push(`Triage:  ${triage.decision}  by ${triage.reviewedBy}  at ${triage.reviewedAt}`)
    if (triage.reason) lines.push(`Reason:  ${triage.reason}`)
  }

  lines.push(`Cycle:   ${meta.cycleId}  enqueued ${meta.enqueuedAt}`)

  // Try to load run-context for richer explanation
  const ctx = runContextStore.load(meta.cycleId)
  if (ctx) {
    const sc = ctx.searchContext
    const kp = ctx.knowledgePack
    if (sc?.recallMode) lines.push(`SearchContext recallMode: ${sc.recallMode}`)
    if (kp?.verticalContext) lines.push(`KnowledgePack context: ${(kp.verticalContext as string).slice(0, 80)}...`)
    if (sc?.sourceWeights && Object.keys(sc.sourceWeights).length > 0) {
      lines.push(`Source weights at time: ${JSON.stringify(sc.sourceWeights)}`)
    }
  } else {
    lines.push(`(run-context not available for this cycle)`)
  }

  lines.push("─────────────────────────────\n")
  return lines.join("\n")
}

function readJsonOrNull(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
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
  const runContextStore = new RunContextStore(DATA_DIR)
  let running = false

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  })

  console.log(`\nRadar CLI — intent: ${intentId}`)
  console.log(`Commands: /state  /undo  /reset  /review  /why <signalId>  /help  /exit`)
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

    // ── /review — show last run summary ─────────────────────────────────────
    if (line === "/review") {
      const output = reviewRun(DATA_DIR, runContextStore, lastRunStore, intentId)
      console.log(output)
      rl.prompt()
      return
    }

    // ── /why {signalId} — explain a signal's triage decision ─────────────────
    if (line.startsWith("/why ")) {
      const signalId = line.slice(4).trim()
      if (!signalId) {
        console.log("Usage: /why <signalId>")
        rl.prompt()
        return
      }
      const output = explainSignal(signalId, DATA_DIR, runContextStore)
      console.log(output)
      rl.prompt()
      return
    }

    if (line === "/run") {
      if (running) { console.log("Pipeline is already running. Please wait."); rl.prompt(); return }
      running = true
      console.log(`\nExecuting pipeline — intent=${intentId}...`)
      try {
        // Load persistent context objects for this run
        const searchCtx = searchContextStore.load(intentId) ?? undefined
        const kpack = knowledgePackStore.load(intentId) ?? undefined
        const charter = meetingCharterStore.load(intentId) ?? undefined

        const result = await runPipeline({
          intent,
          dataDir: DATA_DIR,
          strategy: strategyManager.get(),
          useCommercialAnalyst: process.env.USE_COMMERCIAL_ANALYST === "true",
          searchContext: searchCtx,
          knowledgePack: kpack,
          meetingCharter: charter,
        })

        // Save RunContext snapshot for explainability (/review, /why)
        const cycleId = result.cycleId
        runContextStore.save({
          cycleId,
          timestamp: new Date().toISOString(),
          intentId: intent.id,
          searchContext: searchCtx
            ? { sourceWeights: Object.fromEntries(searchCtx.sourceWeights.map(w => [w.sourceId, w.weight])), topicBoosts: searchCtx.topicBoosts.map(b => b.term), topicSuppressions: searchCtx.topicSuppressions, recallMode: searchCtx.recallMode }
            : {},
          knowledgePack: kpack
            ? { productCapabilities: kpack.productCapabilities.map(c => c.capability), knownLimitations: kpack.knownLimitations, verticalContext: kpack.verticalContext }
            : {},
          meetingCharter: charter
            ? { objective: charter.objective, primaryLens: charter.primaryLens, requiredQuestions: charter.requiredQuestions.map(q => q.question) }
            : {},
          pipelineStats: {
            ingested: result.ingested,
            scored: result.scored,
            qualified: result.qualifiedCount,
            enqueuedForTriage: result.enqueuedForTriage,
            approved: result.approved,
            rejected: result.rejected,
            deferred: result.deferred,
            themes: result.themes,
            opportunities: result.opportunities,
          },
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
          searchContext: searchCtx
            ? { sourceWeights: Object.fromEntries(searchCtx.sourceWeights.map(w => [w.sourceId, w.weight])), topicBoosts: searchCtx.topicBoosts.map(b => b.term), topicSuppressions: searchCtx.topicSuppressions, recallMode: searchCtx.recallMode }
            : {},
          knowledgePack: kpack
            ? { productCapabilities: kpack.productCapabilities.map(c => c.capability), knownLimitations: kpack.knownLimitations, verticalContext: kpack.verticalContext }
            : {},
          meetingCharter: charter
            ? { objective: charter.objective, primaryLens: charter.primaryLens, requiredQuestions: charter.requiredQuestions.map(q => q.question) }
            : {},
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
        "  /state          — 查看 Current Intent / Search Context / Knowledge Pack / Meeting Charter / Last Run",
        "  /undo           — 撤销最后一个 session patch",
        "  /reset          — 清除所有 session patches",
        "  /review          — 查看最近一次 /run 的完整报告（含 pipeline 统计和上下文快照）",
        "  /why <signalId> — 查看某个 signal 的 triage 决定原因",
        "  /run            — (提示) 使用 runner 脚本执行完整管道",
        "  /exit           — 退出",
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
