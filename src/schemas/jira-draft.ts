export type JiraDraftStatus = 'draft' | 'submitted' | 'rejected';

export interface JiraDraft {
  id: string;
  opportunityId: string;
  epicName: string;
  description: string;
  labels: string[];
  status: JiraDraftStatus;
}
