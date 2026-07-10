/**
 * seed / eval スクリプト用の Cloudflare REST ヘルパー。
 * Workers バインディングではなく HTTP API 経由で操作する。
 */

const CF_API = "https://api.cloudflare.com/client/v4";

export type CloudflareConfig = {
  accountId: string;
  apiToken: string;
  d1DatabaseId: string;
  vectorizeIndex: string;
};

export function loadCloudflareConfig(): CloudflareConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const d1DatabaseId = process.env.D1_DATABASE_ID;
  const vectorizeIndex =
    process.env.VECTORIZE_INDEX_NAME ?? "clock-diagnosis-index";

  const missing = [
    !accountId && "CLOUDFLARE_ACCOUNT_ID",
    !apiToken && "CLOUDFLARE_API_TOKEN",
    !d1DatabaseId && "D1_DATABASE_ID",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `必要な環境変数が未設定です: ${missing.join(", ")}\n` +
        `.env に設定してください（README 参照）。`,
    );
  }

  return {
    accountId: accountId!,
    apiToken: apiToken!,
    d1DatabaseId: d1DatabaseId!,
    vectorizeIndex,
  };
}

type CfResult<T> = {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result?: T;
};

async function cfFetch<T>(
  config: CloudflareConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const json = (await response.json()) as CfResult<T>;

  if (!response.ok || !json.success) {
    const message =
      json.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `HTTP ${response.status}`;
    throw new Error(`Cloudflare API error (${path}): ${message}`);
  }

  return json.result as T;
}

export async function runD1Query<T = unknown>(
  config: CloudflareConfig,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await cfFetch<{
    results?: T[];
    meta?: unknown;
  }>(
    config,
    `/accounts/${config.accountId}/d1/database/${config.d1DatabaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({ sql, params }),
    },
  );

  // D1 query API は配列で複数結果を返す場合がある
  if (Array.isArray(result)) {
    const first = result[0] as { results?: T[] } | undefined;
    return first?.results ?? [];
  }

  return result?.results ?? [];
}

export async function embedWithWorkersAi(
  config: CloudflareConfig,
  text: string,
): Promise<number[]> {
  const result = await cfFetch<{
    data?: number[][];
    shape?: number[];
  }>(config, `/accounts/${config.accountId}/ai/run/@cf/baai/bge-m3`, {
    method: "POST",
    body: JSON.stringify({ text: [text] }),
  });

  if (!result?.data?.[0]) {
    throw new Error("Workers AI 埋め込みレスポンスが不正です");
  }

  return result.data[0];
}

export type VectorizeMatch = {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export async function vectorizeUpsert(
  config: CloudflareConfig,
  vectors: Array<{
    id: string;
    values: number[];
    metadata?: Record<string, unknown>;
  }>,
): Promise<void> {
  // NDJSON body
  const body = vectors.map((v) => JSON.stringify(v)).join("\n");

  const response = await fetch(
    `${CF_API}/accounts/${config.accountId}/vectorize/v2/indexes/${config.vectorizeIndex}/upsert`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/x-ndjson",
      },
      body,
    },
  );

  const json = (await response.json()) as CfResult<unknown>;
  if (!response.ok || !json.success) {
    const message =
      json.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `HTTP ${response.status}`;
    throw new Error(`Vectorize upsert failed: ${message}`);
  }
}

export async function vectorizeQuery(
  config: CloudflareConfig,
  vector: number[],
  topK: number,
): Promise<VectorizeMatch[]> {
  const result = await cfFetch<{
    matches?: Array<{ id: string; score?: number; metadata?: Record<string, unknown> }>;
  }>(
    config,
    `/accounts/${config.accountId}/vectorize/v2/indexes/${config.vectorizeIndex}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        vector,
        topK,
        returnValues: false,
        returnMetadata: "all",
      }),
    },
  );

  return (result?.matches ?? []).map((m) => ({
    id: m.id,
    score: m.score ?? 0,
    metadata: m.metadata,
  }));
}

/**
 * インデックス内の全ベクトルを削除する（PoC seed 用）。
 * list + deleteByIds でページング処理する。
 */
export async function vectorizeClearAll(
  config: CloudflareConfig,
): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;

  for (;;) {
    const listPath =
      `/accounts/${config.accountId}/vectorize/v2/indexes/${config.vectorizeIndex}/list` +
      (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");

    const listed = await cfFetch<{
      vectors?: Array<{ id: string }>;
      cursor?: string;
    }>(config, listPath, { method: "GET" });

    const ids = (listed?.vectors ?? []).map((v) => v.id);
    if (ids.length === 0) {
      break;
    }

    await cfFetch(
      config,
      `/accounts/${config.accountId}/vectorize/v2/indexes/${config.vectorizeIndex}/delete_by_ids`,
      {
        method: "POST",
        body: JSON.stringify({ ids }),
      },
    );

    deleted += ids.length;
    cursor = listed?.cursor;
    if (!cursor) {
      break;
    }
  }

  return deleted;
}
