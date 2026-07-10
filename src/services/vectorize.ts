import { TOP_K } from "../types";

export type VectorMatch = {
  id: string;
  score: number;
};

/**
 * Vectorize で Top-K 近傍検索を行う。
 */
export async function searchSimilar(
  vectorize: VectorizeIndex,
  vector: number[],
  topK: number = TOP_K,
): Promise<VectorMatch[]> {
  const results = await vectorize.query(vector, {
    topK,
    returnValues: false,
    returnMetadata: "all",
  });

  return (results.matches ?? []).map((match) => ({
    id: match.id,
    score: match.score ?? 0,
  }));
}
