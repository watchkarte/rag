import { EMBEDDING_MODEL } from "../types";

/**
 * Workers AI (bge-m3) でテキストを 1024 次元ベクトル化する。
 */
export async function embedText(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL, {
    text: [text],
  });

  // Workers AI の埋め込みレスポンスはモデルによって形が異なる
  const data = result as {
    data?: number[][];
    shape?: number[];
  };

  if (!data.data?.[0] || !Array.isArray(data.data[0])) {
    throw new Error("Workers AI 埋め込みレスポンスの形式が不正です");
  }

  return data.data[0];
}

/**
 * seed / 検索用の埋め込みテキストを組み立てる。
 */
export function buildEmbeddingText(input: {
  symptom: string;
  part: string;
  description: string;
}): string {
  return `症状: ${input.symptom}\n部品: ${input.part}\n説明: ${input.description}`;
}

/**
 * コサイン類似度スコアを [0, 1] に正規化する。
 * Vectorize (cosine) のスコアは通常 0〜1 付近だが、範囲外を clamp する。
 */
export function normalizeConfidence(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.min(1, Math.max(0, score));
}
