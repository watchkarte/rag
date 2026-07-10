import {
  GROQ_API_URL,
  GROQ_MODEL,
  type LlmDiagnosis,
  type RetrievedContext,
} from "../types";

function formatRetrievedContexts(contexts: RetrievedContext[]): string {
  return contexts
    .map((ctx, index) => {
      const score = Number.isFinite(ctx.score) ? ctx.score.toFixed(2) : "0.00";
      return [
        `[${index + 1}] 部品: ${ctx.part}（類似度: ${score}）`,
        `症状: ${ctx.symptom}`,
        `説明: ${ctx.description ?? ""}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildSystemPrompt(
  symptom: string,
  contexts: RetrievedContext[],
): string {
  const retrievedContexts = formatRetrievedContexts(contexts);

  return `あなたはクォーツアナログ時計の修理技術者です。
以下の参考情報とユーザーの症状から、最も可能性が高い故障部品を1つ特定し、JSONで出力してください。

参考情報:
${retrievedContexts}

ユーザー症状:
${symptom}

出力形式:
{
  "part": "部品名（日本語）",
  "reason": "診断理由（100文字以内）",
  "nextAction": "ユーザーが取るべき次の行動"
}

注意:
- part は参考情報の中から最も可能性が高い部品を1つ選んでください。
- reason は簡潔に、100文字以内で説明してください。
- nextAction は具体的な次の行動を示してください。`;
}

function isLlmDiagnosis(value: unknown): value is LlmDiagnosis {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.part === "string" &&
    typeof obj.reason === "string" &&
    typeof obj.nextAction === "string"
  );
}

export class LlmRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmRateLimitError";
  }
}

export class LlmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmParseError";
  }
}

/**
 * Groq API (JSON mode) で診断結果を生成する。
 */
export async function generateDiagnosis(
  apiKey: string,
  symptom: string,
  contexts: RetrievedContext[],
): Promise<LlmDiagnosis> {
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: buildSystemPrompt(symptom, contexts),
        },
      ],
    }),
  });

  if (response.status === 429) {
    throw new LlmRateLimitError(
      "Groq API のレートリミットに達しました。しばらく経ってからお試しください。",
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq API エラー (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmParseError("Groq レスポンスに content がありません");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    console.error("LLM JSON parse failed:", content, error);
    throw new LlmParseError("レスポンスの JSON パースに失敗しました。");
  }

  if (!isLlmDiagnosis(parsed)) {
    console.error("LLM JSON type guard failed:", parsed);
    throw new LlmParseError("レスポンスの JSON パースに失敗しました。");
  }

  return parsed;
}
