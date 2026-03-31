export type TriageDecision = 'approved' | 'rejected' | 'deferred';
export type ReviewQueueStatus = 'pending' | 'approved' | 'rejected' | 'deferred';

export interface TriageRecord {
  decision: TriageDecision;
  reviewedBy: string;
  reviewedAt: string;
  reason?: string;
}

export interface ReviewQueueItem {
  id: string;
  signalId: string;
  scoredSignalId: string;
  cycleId: string;
  enqueuedAt: string;
  status: ReviewQueueStatus;
  triage?: TriageRecord;
}
