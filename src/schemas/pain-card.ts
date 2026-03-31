export interface PainCard {
  id: string;
  signalIds: string[];
  painStatement: string;
  affectedPersona: string;
  frequency: number;
  severity: 'high' | 'medium' | 'low';
}
