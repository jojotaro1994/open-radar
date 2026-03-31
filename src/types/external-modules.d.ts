declare module "dotenv" {
  export function config(options?: Record<string, unknown>): { parsed?: Record<string, string> }
}

declare module "node-fetch" {
  const fetch: typeof globalThis.fetch
  export default fetch
}

declare module "@google/stitch-sdk" {
  export class StitchToolClient {
    constructor(options: { apiKey: string })
    connect(): Promise<void>
    callTool(name: string, args: Record<string, unknown>): Promise<any>
  }

  export class Stitch {
    client: StitchToolClient
    constructor(client: StitchToolClient)
    createProject(name: string): Promise<{ id: string }>
  }
}
