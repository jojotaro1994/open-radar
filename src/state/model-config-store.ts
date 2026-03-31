import * as fs from "fs"
import * as path from "path"
import { createDefaultModelConfig, type ModelConfig } from "./model-config.js"

export class ModelConfigStore {
  constructor(private configDir: string) {}

  private filePath(intentId: string): string {
    return path.join(this.configDir, "intents", `${intentId}.model-config.json`)
  }

  load(intentId: string): ModelConfig | null {
    const p = this.filePath(intentId)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as ModelConfig
    } catch {
      return null
    }
  }

  loadOrDefault(intentId: string): ModelConfig {
    return this.load(intentId) ?? createDefaultModelConfig(intentId)
  }

  save(intentId: string, config: ModelConfig): void {
    const p = this.filePath(intentId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(config, null, 2) + "\n")
  }
}
