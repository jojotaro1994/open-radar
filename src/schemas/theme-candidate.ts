export type ThemeCandidateStatus = 'proposed' | 'approved' | 'revised' | 'merged';

export interface ThemeCandidate {
  id: string;
  signalIds: string[];
  themeTitle: string;
  themeStatement: string;
  status: ThemeCandidateStatus;
  cycleId: string;
}
