export interface PromptTemplate {
  id: string;
  name: string;
  templateBody: string;
  requiredVars: string[];
  outputFormat: string;
}
