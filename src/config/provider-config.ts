import * as fs from "fs"
import * as os from "os"
import * as path from "path"

interface OpenClawConfig {
  models?: {
    providers?: {
      openrouter?: {
        apiKey?: string
        baseUrl?: string
        models?: Array<{ id?: string }>
      }
    }
  }
}

interface ClaudeOpenRouterSettings {
  env?: {
    ANTHROPIC_BASE_URL?: string
    ANTHROPIC_API_KEY?: string
    ANTHROPIC_AUTH_TOKEN?: string
    ANTHROPIC_MODEL?: string
  }
}

export interface OpenRouterProviderConfig {
  apiKey?: string
  baseUrl: string
  defaultModel?: string
}

export interface StitchProviderConfig {
  apiKey?: string
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T
  } catch {
    return null
  }
}

function homePath(...parts: string[]): string {
  return path.join(os.homedir(), ...parts)
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  return undefined
}

function normalizeOpenRouterBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")
  if (raw.endsWith("/api/v1")) return raw
  if (raw.endsWith("/api")) return `${raw}/v1`
  return raw
}

export function loadOpenRouterProviderConfig(): OpenRouterProviderConfig {
  const openClaw = readJsonFile<OpenClawConfig>(homePath(".openclaw", "openclaw.json"))
  const claude = readJsonFile<ClaudeOpenRouterSettings>(homePath(".claude", ".settings.openrouter.json"))

  const apiKey =
    envValue("OPENROUTER_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY") ??
    openClaw?.models?.providers?.openrouter?.apiKey ??
    claude?.env?.ANTHROPIC_AUTH_TOKEN ??
    claude?.env?.ANTHROPIC_API_KEY

  const baseUrl = normalizeOpenRouterBaseUrl(
    envValue("OPENROUTER_BASE_URL", "ANTHROPIC_BASE_URL") ??
      openClaw?.models?.providers?.openrouter?.baseUrl ??
      claude?.env?.ANTHROPIC_BASE_URL
  )

  const defaultModel =
    envValue("OPENROUTER_MODEL", "ANTHROPIC_MODEL") ??
    openClaw?.models?.providers?.openrouter?.models?.[0]?.id ??
    claude?.env?.ANTHROPIC_MODEL

  return { apiKey, baseUrl, defaultModel }
}

export function loadStitchProviderConfig(): StitchProviderConfig {
  return {
    apiKey: envValue("STITCH_API_KEY"),
  }
}

export function getOpenRouterChatCompletionsUrl(config = loadOpenRouterProviderConfig()): string {
  return `${config.baseUrl}/chat/completions`
}

export function getOpenRouterModelsUrl(config = loadOpenRouterProviderConfig()): string {
  return `${config.baseUrl}/models`
}

export function maskSecret(secret?: string): string {
  if (!secret) return "(missing)"
  if (secret.length <= 12) return "<configured>"
  return `${secret.slice(0, 8)}...${secret.slice(-4)}`
}
