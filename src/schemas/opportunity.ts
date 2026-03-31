import type { Attribution } from './attribution.js';

export type OpportunityStatus = 'assembled' | 'in_review' | 'approved' | 'rejected' | 'archived';

export interface Opportunity {
  id: string;
  themeCandidateId: string;
  painCardIds: string[];
  evidenceIds: string[];
  title: string;
  summary: string;
  status: OpportunityStatus;
  createdAt: string;
  attribution?: Attribution;
}
