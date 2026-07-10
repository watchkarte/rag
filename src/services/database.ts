import type { DiagnosisRecord } from "../types";

/**
 * Vectorize のマッチ ID から D1 メタデータを取得する。
 * ID の順序を維持して返す。
 */
export async function getDiagnosesByIds(
  db: D1Database,
  ids: string[],
): Promise<DiagnosisRecord[]> {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(", ");
  const sql = `
    SELECT id, symptom, part, difficulty, description
    FROM diagnoses
    WHERE id IN (${placeholders})
  `;

  const { results } = await db
    .prepare(sql)
    .bind(...ids)
    .all<DiagnosisRecord>();

  const byId = new Map((results ?? []).map((row) => [row.id, row]));

  return ids
    .map((id) => byId.get(id))
    .filter((row): row is DiagnosisRecord => row !== undefined);
}
