import { getOpenRouterModelsUrl, loadOpenRouterProviderConfig } from "../config/provider-config.js"

export interface OpenRouterModelPricing {
  prompt?: string
  completion?: string
  request?: string
  image?: string
  web_search?: string
  internal_reasoning?: string
}

export interface OpenRouterModelSummary {
  id: string
  name: string
  contextLength: number
  vendor: string
  inputModalities: string[]
  pricing: OpenRouterModelPricing
  isFree: boolean
}

interface RawOpenRouterModel {
  id: string
  name?: string
  context_length?: number
  pricing?: OpenRouterModelPricing
  architecture?: {
    input_modalities?: string[]
  }
}

function parsePrice(value?: string): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function isFreeOpenRouterModel(pricing?: OpenRouterModelPricing, modelId?: string): boolean {
  const prompt = parsePrice(pricing?.prompt)
  const completion = parsePrice(pricing?.completion)
  if (prompt != null && completion != null) {
    return prompt === 0 && completion === 0
  }
  return Boolean(modelId?.endsWith(":free"))
}

export async function listOpenRouterModels(): Promise<OpenRouterModelSummary[]> {
  const config = loadOpenRouterProviderConfig()
  const headers: Record<string, string> = {}
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  const response = await fetch(getOpenRouterModelsUrl(config), { headers })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenRouter /models failed: status=${response.status} body=${body.slice(0, 160)}`)
  }

  const data = (await response.json()) as { data?: RawOpenRouterModel[] }
  return (data.data ?? []).map(model => {
    const vendor = model.id.includes("/") ? model.id.split("/")[0]! : "unknown"
    const inputModalities = model.architecture?.input_modalities ?? ["text"]
    return {
      id: model.id,
      name: model.name ?? model.id,
      contextLength: model.context_length ?? 0,
      vendor,
      inputModalities,
      pricing: model.pricing ?? {},
      isFree: isFreeOpenRouterModel(model.pricing, model.id),
    }
  })
}

export function isTextCapableModel(model: OpenRouterModelSummary): boolean {
  return model.inputModalities.includes("text")
}
