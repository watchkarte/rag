/**
 * D1 + Vectorize に初期診断データを投入する。
 *
 * 前提:
 * - wrangler d1 create / vectorize create 済み
 * - migrations 適用済み（remote）
 * - .env に CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 *
 * 注意: 本番インデックスをクリアして再投入します（PoC として一時停止を許容）。
 */
import { config as loadEnv } from "dotenv";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  embedWithWorkersAi,
  loadCloudflareConfig,
  runD1Query,
  vectorizeClearAll,
  vectorizeUpsert,
} from "./lib/cloudflare";

loadEnv();

type SeedItem = {
  id: string;
  symptom: string;
  part: string;
  description: string;
};

function buildEmbeddingText(item: SeedItem): string {
  return `症状: ${item.symptom}\n部品: ${item.part}\n説明: ${item.description}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function stripJsonComments(raw: string): string {
  return raw
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

async function main(): Promise<void> {
  const cf = loadCloudflareConfig();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const seedPath = resolve(root, "src/data/seed.json");
  const raw = await readFile(seedPath, "utf-8");
  const items = JSON.parse(stripJsonComments(raw)) as SeedItem[];

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("seed.json が空です");
  }

  console.log(`seed 件数: ${items.length}`);
  console.log("1/4 Vectorize インデックスをクリア中...");
  const deleted = await vectorizeClearAll(cf);
  console.log(`  削除: ${deleted} vectors`);

  console.log("2/4 D1 diagnoses テーブルをクリア中...");
  await runD1Query(cf, "DELETE FROM diagnoses");

  console.log("3/4 D1 にメタデータを投入中...");
  for (const item of items) {
    await runD1Query(
      cf,
      `INSERT INTO diagnoses (id, symptom, part, description)
       VALUES (?, ?, ?, ?)`,
      [item.id, item.symptom, item.part, item.description],
    );
  }
  console.log(`  投入: ${items.length} rows`);

  console.log("4/4 埋め込み生成 + Vectorize upsert 中...");
  const batchSize = 10;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const vectors = [];

    for (const item of batch) {
      const text = buildEmbeddingText(item);
      const values = await embedWithWorkersAi(cf, text);
      vectors.push({
        id: item.id,
        values,
        metadata: {
          part: item.part,
          symptom: item.symptom,
        },
      });
      // Workers AI 無料枠を考慮した軽いスロットリング
      await sleep(200);
    }

    await vectorizeUpsert(cf, vectors);
    console.log(
      `  upsert ${Math.min(i + batchSize, items.length)} / ${items.length}`,
    );
  }

  console.log("seed 完了");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
