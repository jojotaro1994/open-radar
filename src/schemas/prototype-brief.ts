import type { Attribution } from './attribution.js';

export interface PrototypeBrief {
  id: string;
  opportunityId: string;
  problemStatement: string;
  targetUser: string;
  proposedSolution: string;
  keyFeatures: string[];
  constraints: string[];
  attribution?: Attribution;
}
