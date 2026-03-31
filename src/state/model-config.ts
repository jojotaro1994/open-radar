export const MODEL_LAYERS = ["search", "meeting", "consumer.prototypeBrief"] as const

export type ModelLayer = (typeof MODEL_LAYERS)[number]

export interface LayerModelSelection {
  provider: "openrouter"
  model: string
  freeOnly?: boolean
  preferredModels?: string[]
}

export interface ModelConfig {
  id: string
  intentId: string
  defaultProvider: "openrouter"
  layers: {
    search?: LayerModelSelection
    meeting?: LayerModelSelection
    consumer?: {
      prototypeBrief?: LayerModelSelection
    }
  }
  createdAt: string
  updatedAt: string
}

export const DEFAULT_SEARCH_MODEL = "stepfun/step-3.5-flash:free"
export const DEFAULT_MEETING_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
export const DEFAULT_PROTOTYPE_BRIEF_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"

export function createDefaultModelConfig(intentId: string): ModelConfig {
  const now = new Date().toISOString()
  return {
    id: `${intentId}-model-config`,
    intentId,
    defaultProvider: "openrouter",
    layers: {
      search: { provider: "openrouter", model: DEFAULT_SEARCH_MODEL, freeOnly: true },
      meeting: { provider: "openrouter", model: DEFAULT_MEETING_MODEL, freeOnly: true },
      consumer: {
        prototypeBrief: { provider: "openrouter", model: DEFAULT_PROTOTYPE_BRIEF_MODEL, freeOnly: true },
      },
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function getLayerSelection(config: ModelConfig | null | undefined, layer: ModelLayer): LayerModelSelection | null {
  if (!config) return null
  switch (layer) {
    case "search":
      return config.layers.search ?? null
    case "meeting":
      return config.layers.meeting ?? null
    case "consumer.prototypeBrief":
      return config.layers.consumer?.prototypeBrief ?? null
  }
}

export function setLayerSelection(config: ModelConfig, layer: ModelLayer, selection: LayerModelSelection): ModelConfig {
  const updatedAt = new Date().toISOString()
  switch (layer) {
    case "search":
      return { ...config, layers: { ...config.layers, search: selection }, updatedAt }
    case "meeting":
      return { ...config, layers: { ...config.layers, meeting: selection }, updatedAt }
    case "consumer.prototypeBrief":
      return {
        ...config,
        layers: {
          ...config.layers,
          consumer: { ...(config.layers.consumer ?? {}), prototypeBrief: selection },
        },
        updatedAt,
      }
  }
}
