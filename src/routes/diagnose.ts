import { Hono } from "hono";
import {
  CONFIDENCE_THRESHOLD,
  FALLBACK_RESPONSE,
  TOP_K,
  type Bindings,
  type DiagnoseErrorResponse,
  type DiagnoseSuccessResponse,
  type RetrievedContext,
} from "../types";
import { embedText, normalizeConfidence } from "../services/embedding";
import { searchSimilar } from "../services/vectorize";
import { getDiagnosesByIds } from "../services/database";
import {
  generateDiagnosis,
  LlmParseError,
  LlmRateLimitError,
} from "../services/llm";

const diagnose = new Hono<{ Bindings: Bindings }>();

function isWorkersAiRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const e = error as { status?: number; message?: string; code?: number };
  if (e.status === 429 || e.code === 429) {
    return true;
  }
  const message = (e.message ?? String(error)).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("quota") ||
    message.includes("too many requests") ||
    message.includes("token")
  );
}

diagnose.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json<DiagnoseErrorResponse>(
      { error: "リクエストボディが不正です。JSON を送信してください。" },
      400,
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("symptom" in body) ||
    typeof (body as { symptom: unknown }).symptom !== "string"
  ) {
    return c.json<DiagnoseErrorResponse>(
      { error: "symptom は必須で、文字列である必要があります。" },
      400,
    );
  }

  const symptom = (body as { symptom: string }).symptom.trim();
  if (symptom.length === 0) {
    return c.json<DiagnoseErrorResponse>(
      { error: "symptom は必須で、文字列である必要があります。" },
      400,
    );
  }

  try {
    // 1-2. 症状を埋め込み
    let vector: number[];
    try {
      vector = await embedText(c.env.AI, symptom);
    } catch (error) {
      if (isWorkersAiRateLimit(error)) {
        return c.json<DiagnoseErrorResponse>(
          {
            error:
              "Workers AI のトークン制限に達しました。しばらく経ってからお試しください。",
          },
          429,
        );
      }
      throw error;
    }

    // 3. Vectorize Top-K 検索
    const matches = await searchSimilar(c.env.VECTORIZE, vector, TOP_K);
    if (matches.length === 0) {
      return c.json<DiagnoseSuccessResponse>(FALLBACK_RESPONSE);
    }

    // 4. D1 からメタデータ取得
    const records = await getDiagnosesByIds(
      c.env.DB,
      matches.map((m) => m.id),
    );

    if (records.length === 0) {
      return c.json<DiagnoseSuccessResponse>(FALLBACK_RESPONSE);
    }

    const scoreById = new Map(matches.map((m) => [m.id, m.score]));
    const contexts: RetrievedContext[] = records.map((record) => ({
      ...record,
      score: scoreById.get(record.id) ?? 0,
    }));

    // 検索結果の順序はスコア降順を維持
    contexts.sort((a, b) => b.score - a.score);

    // 7-8. confidence は Top-1 スコアを正規化。閾値未満は LLM を呼ばずフォールバック
    const confidence = normalizeConfidence(contexts[0].score);
    if (confidence < CONFIDENCE_THRESHOLD) {
      return c.json<DiagnoseSuccessResponse>(FALLBACK_RESPONSE);
    }

    // 5-6. LLM で診断生成
    if (!c.env.GROQ_API_KEY) {
      return c.json<DiagnoseErrorResponse>(
        { error: "GROQ_API_KEY が設定されていません。" },
        500,
      );
    }

    const llmResult = await generateDiagnosis(
      c.env.GROQ_API_KEY,
      symptom,
      contexts,
    );

    const response: DiagnoseSuccessResponse = {
      part: llmResult.part,
      confidence,
      reason: llmResult.reason,
      nextAction: llmResult.nextAction,
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof LlmRateLimitError) {
      return c.json<DiagnoseErrorResponse>({ error: error.message }, 429);
    }

    if (error instanceof LlmParseError) {
      // 仕様: ユーザーにパース失敗メッセージ、詳細はログ
      console.error("LLM parse error:", error);
      return c.json<DiagnoseErrorResponse>({ error: error.message }, 500);
    }

    if (isWorkersAiRateLimit(error)) {
      return c.json<DiagnoseErrorResponse>(
        {
          error:
            "Workers AI のトークン制限に達しました。しばらく経ってからお試しください。",
        },
        429,
      );
    }

    console.error("diagnose unexpected error:", error);
    return c.json<DiagnoseErrorResponse>(
      { error: "サーバーエラーが発生しました。" },
      500,
    );
  }
});

export { diagnose };
