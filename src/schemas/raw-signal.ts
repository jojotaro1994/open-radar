export interface RawSignal {
  /** Unique identifier for this raw signal */
  id: string;
  /** Adapter identifier that produced this signal */
  sourceId: string;
  /** Human-readable source name */
  sourceName: string;
  /** Source-native opaque payload */
  rawPayload: {
    title: string;
    body: string;
    author: string;
    createdAt: string;
    tags?: string[];
    [key: string]: unknown;
  };
  /** ISO 8601 timestamp when signal was fetched */
  fetchedAt: string;
}
