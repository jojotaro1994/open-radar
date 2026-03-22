/**
 * patch-handler.ts — parses natural language into patch actions.
 *
 * Two-layer patch model (CURRENT):
 *   session patch    — applied to ActiveStrategy in memory; no confirmation needed
 *   persistent change — modifies intent JSON; structured preview + y/n confirmation
 *
 * Classification rules (current live behavior):
 *   "这轮" "先" "暂时" "临时" | "just this" "for now" "temporarily"  → session patch
 *   "从现在起" "永久" "一直" "以后都" | "from now on" "permanently" "always" → persistent change
 *   (no signal word)  → session patch  (current default; no preview)
 *
 * Target (not yet wired — see design.md):
 *   Persistent change should become the primary path with:
 *     draft -> structured preview -> refine/rewrite -> confirm (y/n) -> apply
 */

import * as fs from "fs"
import type { RadarIntent } from "../schemas/intent.js"
import type { ActiveStrategyManager } from "../state/active-strategy.js"

export type PatchClassification = "session" | "persistent"

const SESSION_MARKERS = ["这轮", "先", "暂时", "临时", "just this", "for now", "temporarily"]
const PERSISTENT_MARKERS = ["从现在起", "永久", "一直", "以后都", "from now on", "permanently", "always", "forever"]

export function classifyPatch(text: string): PatchClassification {
  for (const m of PERSISTENT_MARKERS) {
    if (text.includes(m)) return "persistent"
  }
  // Session signals are checked for clarity, but the default is also "session"
  return "session"
}

// ── Parsed intent from natural language ──────────────────────────────────────

export type ParsedField = "focus" | "relevanceThreshold" | "sourceBias" | "excludeTags" | null

export interface ParsedPatch {
  field: ParsedField
  value: unknown
}

export function parsePatchIntent(text: string): ParsedPatch {
  // Focus: "只看X方向" | "只关注X" | "focus on X" | "聚焦X"
  const focusMatch = text.match(/只看(.+?)(?:方向|领域|$)|只关注(.+?)(?:方向|领域|$)|focus on ([^\s,]+)|聚焦([^\s,，]+)/i)
  if (focusMatch) {
    const raw = (focusMatch[1] ?? focusMatch[2] ?? focusMatch[3] ?? focusMatch[4]).trim()
    return { field: "focus", value: raw }
  }

  // Relevance threshold: "相关度门槛到X" | "降低相关度到X" | "threshold X" | "relevance X"
  const thresholdMatch = text.match(/相关度[^\d]*([\d.]+)|threshold[^\d]*([\d.]+)|relevance[^\d]*([\d.]+)/i)
  if (thresholdMatch) {
    const val = parseFloat(thresholdMatch[1] ?? thresholdMatch[2] ?? thresholdMatch[3])
    if (!isNaN(val) && val >= 0 && val <= 1) return { field: "relevanceThreshold", value: val }
  }

  // Exclude tags: "排除X标签" | "排除tag X" | "exclude tag X"
  const excludeMatch = text.match(/排除(.+?)标[签]|exclude\s+tags?\s+["']?([^\s"']+)/i)
  if (excludeMatch) {
    const raw = (excludeMatch[1] ?? excludeMatch[2]).trim()
    return { field: "excludeTags", value: raw }
  }

  // Source bias: "暂停X" | "pause X"
  const pauseMatch = text.match(/暂停\s*([a-zA-Z0-9_-]+)|pause\s+([a-zA-Z0-9_-]+)/i)
  if (pauseMatch) {
    const sourceId = (pauseMatch[1] ?? pauseMatch[2]).trim()
    return { field: "sourceBias", value: { action: "pause", sourceId } }
  }

  return { field: null, value: null }
}

// ── Patch action result (returned to CLI; CLI handles confirmation flow) ──────

export type PatchAction =
  | { type: "session_applied"; message: string }
  | { type: "persistent_confirm"; preview: string; onConfirm: () => string; onCancel: () => string }
  | { type: "no_op"; message: string }
  | { type: "unrecognized"; message: string }

export function buildPatchAction(
  text: string,
  intent: RadarIntent,
  strategyManager: ActiveStrategyManager,
  intentPath: string
): PatchAction {
  const classification = classifyPatch(text)
  const parsed = parsePatchIntent(text)

  if (!parsed.field) {
    return { type: "unrecognized", message: "(未能识别修改意图，请重新描述。支持: 聚焦方向 / 相关度门槛 / 暂停source / 排除标签)" }
  }

  // ── Session patches ─────────────────────────────────────────────────────

  if (classification === "session") {
    if (parsed.field === "focus") {
      const focusVal = parsed.value as string
      strategyManager.applyFocus(focusVal, text)
      const intentTags = intent.commercialCriteria.includeTags?.join(", ") ?? "(none)"
      return {
        type: "session_applied",
        message: [
          `Session patch:`,
          `  focus → "${focusVal}"`,
          `  有效范围: 本次会话`,
          ``,
          `已应用。下次 /run 将在 ${focusVal} 方向聚焦。`,
          `Intent 的 includeTags 未改变 (${intentTags})。`,
        ].join("\n"),
      }
    }

    if (parsed.field === "relevanceThreshold") {
      const val = parsed.value as number
      const intentDefault = intent.commercialCriteria.minRelevanceScore ?? 0.4
      strategyManager.applyRelevanceThreshold(val, text)
      return {
        type: "session_applied",
        message: [
          `Session patch:`,
          `  relevanceThreshold → ${val}`,
          `  (Intent 默认值: ${intentDefault}, 不受影响)`,
          `  有效范围: 本次会话`,
          ``,
          `已应用。如需永久保存，请说"保存为长期配置"。`,
        ].join("\n"),
      }
    }

    if (parsed.field === "sourceBias") {
      const bias = parsed.value as { action: "pause" | "boost"; sourceId: string }
      strategyManager.applySourceBias(bias, text)
      return {
        type: "session_applied",
        message: [
          `Session patch:`,
          `  sourceBias → ${bias.action} ${bias.sourceId}`,
          `  有效范围: 本次会话`,
          ``,
          `已应用。`,
        ].join("\n"),
      }
    }

    // excludeTags with session classification — nudge toward persistent
    if (parsed.field === "excludeTags") {
      return {
        type: "no_op",
        message: `"排除标签"是永久变更。请说"从现在起排除 ${parsed.value} 标签"来触发 persistent change 流程。`,
      }
    }
  }

  // ── Persistent changes ──────────────────────────────────────────────────

  if (classification === "persistent") {
    if (parsed.field === "excludeTags") {
      const newTag = (parsed.value as string).replace(/['"]/g, "").trim()
      const currentTags = intent.commercialCriteria.excludeTags ?? []

      if (currentTags.includes(newTag)) {
        return { type: "no_op", message: `"${newTag}" 已在 excludeTags 中，无需变更。` }
      }

      const newTags = [...currentTags, newTag]
      const preview = [
        `Persistent change:`,
        `  commercialCriteria.excludeTags: [${currentTags.map(t => `"${t}"`).join(", ")}] → [${newTags.map(t => `"${t}"`).join(", ")}]`,
        `  将写入 ${intentPath}`,
        ``,
        `确认写入？(y/n)`,
      ].join("\n")

      const onConfirm = (): string => {
        const raw = JSON.parse(fs.readFileSync(intentPath, "utf-8"))
        raw.commercialCriteria.excludeTags = newTags
        fs.writeFileSync(intentPath, JSON.stringify(raw, null, 2) + "\n")
        // Mutate intent in place so caller's reference is updated
        intent.commercialCriteria.excludeTags = newTags
        return `已写入。excludeTags 现在包含: ${newTags.join(", ")}`
      }

      const onCancel = (): string => "已取消。Intent 未变更。"

      return { type: "persistent_confirm", preview, onConfirm, onCancel }
    }

    // Persistent focus/threshold — write to intent JSON
    if (parsed.field === "focus") {
      const val = parsed.value as string
      const preview = [
        `Persistent change:`,
        `  (注意: focus 是 session 级概念，Intent 没有 focus 字段)`,
        `  如需永久缩窄范围，请改写 commercialCriteria.includeTags`,
        ``,
        `建议: 直接说"从现在起 includeTags 只保留 ${val}"`,
      ].join("\n")
      return { type: "no_op", message: preview }
    }

    if (parsed.field === "relevanceThreshold") {
      const val = parsed.value as number
      const currentVal = intent.commercialCriteria.minRelevanceScore ?? 0.4
      const preview = [
        `Persistent change:`,
        `  commercialCriteria.minRelevanceScore: ${currentVal} → ${val}`,
        `  将写入 ${intentPath}`,
        ``,
        `确认写入？(y/n)`,
      ].join("\n")

      const onConfirm = (): string => {
        const raw = JSON.parse(fs.readFileSync(intentPath, "utf-8"))
        raw.commercialCriteria.minRelevanceScore = val
        fs.writeFileSync(intentPath, JSON.stringify(raw, null, 2) + "\n")
        intent.commercialCriteria.minRelevanceScore = val
        return `已写入。minRelevanceScore 现在为: ${val}`
      }

      const onCancel = (): string => "已取消。Intent 未变更。"
      return { type: "persistent_confirm", preview, onConfirm, onCancel }
    }
  }

  return { type: "unrecognized", message: `(暂不支持该操作)` }
}
