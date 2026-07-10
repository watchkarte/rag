export type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  GROQ_API_KEY: string;
};

export type DiagnosisRecord = {
  id: string;
  symptom: string;
  part: string;
  difficulty: string | null;
  description: string | null;
};

export type RetrievedContext = DiagnosisRecord & {
  score: number;
};

export type DiagnoseSuccessResponse = {
  part: string | null;
  confidence: number;
  reason: string;
  nextAction: string;
};

export type DiagnoseErrorResponse = {
  error: string;
};

export type LlmDiagnosis = {
  part: string;
  reason: string;
  nextAction: string;
};

export const CONFIDENCE_THRESHOLD = 0.6;
export const TOP_K = 3;
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const GROQ_MODEL = "llama-3.1-8b-instant";
export const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export const FALLBACK_RESPONSE: DiagnoseSuccessResponse = {
  part: null,
  confidence: 0.0,
  reason: "データに無いため診断できませんでした。",
  nextAction: "専門の時計修理店に相談してください。",
};
