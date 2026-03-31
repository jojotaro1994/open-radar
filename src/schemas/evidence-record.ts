export type ContributionType = 'direct' | 'supporting' | 'contextual';

export interface EvidenceRecord {
  id: string;
  opportunityId: string;
  signalId: string;
  excerpt: string;
  contributionType: ContributionType;
}
