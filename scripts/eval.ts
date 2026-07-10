/**
 * Retrieval / End-to-end 評価スクリプト。
 *
 * 計測指標:
 * - Recall@3: 正解部品が Vectorize Top-3 に含まれる割合
 * - Accuracy@1: POST /diagnose の part が正解と一致する割合
 *
 * 環境変数:
 * - CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 * - VECTORIZE_INDEX_NAME (optional)
 * - DIAGNOSE_API_URL (default: http://127.0.0.1:8787/diagnose)
 */
import { config as loadEnv } from "dotenv";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  embedWithWorkersAi,
  loadCloudflareConfig,
  runD1Query,
  vectorizeQuery,
} from "./lib/cloudflare";

loadEnv();

type EvalItem = {
  query: string;
  expectedPart: string;
};

type DiagnoseResponse = {
  part?: string | null;
  confidence?: number;
  reason?: string;
  nextAction?: string;
  error?: string;
};

type DiagnosisRow = {
  id: string;
  part: string;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const cf = loadCloudflareConfig();
  const apiUrl =
    process.env.DIAGNOSE_API_URL ?? "http://127.0.0.1:8787/diagnose";
  const topK = Number(process.env.EVAL_TOP_K ?? "3");

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const evalPath = resolve(root, "tests/eval.json");
  const items = JSON.parse(await readFile(evalPath, "utf-8")) as EvalItem[];

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("tests/eval.json が空です");
  }

  console.log(`評価件数: ${items.length}`);
  console.log(`API: ${apiUrl}`);
  console.log(`Top-K: ${topK}`);
  console.log("---");

  let recallHits = 0;
  let accuracyHits = 0;
  let accuracyEvaluated = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    process.stdout.write(`[${i + 1}/${items.length}] ${item.query}\n`);

    // --- Recall@3 (retrieval only) ---
    const vector = await embedWithWorkersAi(cf, item.query);
    const matches = await vectorizeQuery(cf, vector, topK);
    const ids = matches.map((m) => m.id);

    let retrievedParts: string[] = [];
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(", ");
      const rows = await runD1Query<DiagnosisRow>(
        cf,
        `SELECT id, part FROM diagnoses WHERE id IN (${placeholders})`,
        ids,
      );
      const partById = new Map(rows.map((r) => [r.id, r.part]));
      retrievedParts = ids
        .map((id) => partById.get(id))
        .filter((p): p is string => typeof p === "string");
    }

    const recallHit = retrievedParts.includes(item.expectedPart);
    if (recallHit) {
      recallHits += 1;
    }

    // --- Accuracy@1 (end-to-end API) ---
    let predictedPart: string | null = null;
    let apiError: string | null = null;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symptom: item.query }),
      });
      const json = (await response.json()) as DiagnoseResponse;
      if (!response.ok || json.error) {
        apiError = json.error ?? `HTTP ${response.status}`;
      } else {
        predictedPart = json.part ?? null;
        accuracyEvaluated += 1;
        if (predictedPart === item.expectedPart) {
          accuracyHits += 1;
        }
      }
    } catch (error) {
      apiError =
        error instanceof Error ? error.message : "API request failed";
    }

    console.log(
      `  expected=${item.expectedPart} | top${topK}=[${retrievedParts.join(", ")}] | recall=${recallHit ? "HIT" : "MISS"}`,
    );
    if (apiError) {
      console.log(`  api=ERROR (${apiError})`);
    } else {
      console.log(
        `  api.part=${predictedPart} | accuracy=${predictedPart === item.expectedPart ? "HIT" : "MISS"}`,
      );
    }

    await sleep(300);
  }

  const recall = recallHits / items.length;
  const accuracy =
    accuracyEvaluated > 0 ? accuracyHits / accuracyEvaluated : 0;

  console.log("---");
  console.log(`Recall@${topK}: ${(recall * 100).toFixed(1)}% (${recallHits}/${items.length})`);
  console.log(
    `Accuracy@1: ${(accuracy * 100).toFixed(1)}% (${accuracyHits}/${accuracyEvaluated}` +
      (accuracyEvaluated < items.length
        ? `, API成功 ${accuracyEvaluated}/${items.length}`
        : "") +
      `)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
