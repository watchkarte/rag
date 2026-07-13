# WatchKarte / クォーツアナログ時計故障診断 RAG API

症状テキストから、最も可能性の高い故障部品を推定する RAG サービスの PoC / MVP です。

- **製品名**: WatchKarte
- **主要リスク**: RAG 検索の精度（症状 → 部品の Retrieval 品質）
- **状態**: PoC 完成、MVP 仕様は `spec_mvp.md` に記載
- **技術スタック**: Hono + Cloudflare Workers / Vectorize / D1 / Workers AI / Groq

仕様の詳細:

- PoC: [`spec.md`](./spec.md)
- MVP: [`spec_mvp.md`](./spec_mvp.md)
- Cloudflare 詳細手順: [`README_cloudflare.md`](./README_cloudflare.md)
- アーキテクチャ: [`architecture.md`](./architecture.md)

## 技術スタック

| レイヤー | サービス |
|---------|---------|
| フレームワーク | Hono (Cloudflare Workers) |
| UI | Hono JSX (`hono/jsx`) |
| ベクトル DB | Cloudflare Vectorize |
| メタデータ DB | Cloudflare D1 |
| 埋め込み | Workers AI `@cf/baai/bge-m3` (1024 次元) |
| LLM | Groq API `llama-3.1-8b-instant` |
| キャッシュ | 未実装（将来拡張） |

## エンドポイント

### `GET /`

Hono JSX で実装された単一画面診断 UI。

### `POST /diagnose`

**リクエスト**

```json
{
  "symptom": "秒針が5秒おきに飛んで止まる"
}
```

**成功レスポンス (200)**

```json
{
  "part": "電池",
  "confidence": 0.92,
  "reason": "…",
  "nextAction": "…"
}
```

**フォールバック (200)** — confidence < 0.6 または検索 0 件

```json
{
  "part": null,
  "confidence": 0.0,
  "reason": "データに無いため診断できませんでした。",
  "nextAction": "専門の時計修理店に相談してください。"
}
```

**エラー**

- `400` `{ "error": "…" }` リクエスト不正
- `429` レートリミット（Groq / Workers AI）
- `500` サーバーエラー / JSON パース失敗

## セットアップ

### 1. 依存関係

```bash
npm install
```

### 2. 環境変数

`.env.example` を参考に `.env` を用意します（`GROQ_API_KEY` は必須）。

```bash
cp .env.example .env
# GROQ_API_KEY=gsk_... を設定
```

`wrangler dev` は `.env` ではなく **`.dev.vars`** を読むため、同じキーをコピーします。

```bash
cp .dev.vars.example .dev.vars
# GROQ_API_KEY を .env と同じ値に設定
```

### 3. Cloudflare リソース作成

> **アカウント作成後の詳細手順**: [`README_cloudflare.md`](./README_cloudflare.md)

Cloudflare アカウント作成・ `wrangler login` の後:

```bash
npx wrangler d1 create clock-diagnosis-db
npx wrangler vectorize create clock-diagnosis-index --dimensions=1024 --metric=cosine
```

`wrangler.toml` の `database_id` を、作成時に表示された ID に置き換えます。

```toml
[[d1_databases]]
binding = "DB"
database_name = "clock-diagnosis-db"
database_id = "<作成された ID>"
```

リモートにスキーマを適用:

```bash
npm run db:migrate:remote
```

### 4. seed（初期データ投入）

`.env` に以下を設定します。

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`（D1 / Vectorize / Workers AI 権限）
- `D1_DATABASE_ID`

```bash
npm run seed
```

> **注意**: seed は本番 Vectorize インデックスをクリアして再投入します（PoC として一時停止を許容）。

### 5. デプロイ

```bash
npx wrangler deploy
npx wrangler secret put GROQ_API_KEY
```

### 6. ローカル開発

Vectorize は local モード非対応のため、`npm run dev`（中身は `npx wrangler dev --remote`）を使います。  
素の `wrangler` コマンドはグローバル未導入のため動きません（`コマンドが見つかりません`）。  
事前に **workers.dev サブドメイン登録** が必要です（未登録だと `edge-preview` エラーになります）。  
詳細は [`README_cloudflare.md`](./README_cloudflare.md) の手順 3・12 を参照してください。

```bash
npm run dev
curl -s http://127.0.0.1:8787/diagnose \
  -H 'content-type: application/json' \
  -d '{"symptom":"秒針が5秒おきに飛んで止まる"}'
```

## 評価

`tests/eval.json` のクエリで以下を計測します。

- **Recall@3**: 正解部品が Vectorize Top-3 に含まれる割合
- **Accuracy@1**: `POST /diagnose` の `part` が正解と一致する割合

```bash
# 先に wrangler dev を起動した状態で
npm run eval
```

MVP リリース基準: Recall@3 ≥ 70%、Accuracy@1 ≥ 60%。

## ディレクトリ構造

```
.
├── wrangler.toml
├── package.json
├── tsconfig.json
├── .dev.vars.example
├── .env.example
├── README.md
├── AGENTS.md          # README.md の symlink
├── CLAUDE.md          # README.md の symlink
├── ANTIGRAVITY.md     # README.md の symlink
├── architecture.md
├── spec.md
├── spec_mvp.md
├── migrations/
│   └── 0001_create_diagnoses.sql
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── routes/
│   │   ├── diagnose.ts
│   │   └── page.ts
│   ├── components/
│   │   └── DiagnosisPage.tsx
│   ├── services/
│   │   ├── embedding.ts
│   │   ├── vectorize.ts
│   │   ├── database.ts
│   │   └── llm.ts
│   └── data/seed.json
├── scripts/
│   ├── seed.ts
│   ├── eval.ts
│   └── lib/cloudflare.ts
└── tests/
    └── eval.json
```

## パイプライン概要

1. `symptom` を受け取る
2. Workers AI `bge-m3` で 1024 次元ベクトル化
3. Vectorize で Top-K=3 検索
4. 検索 ID で D1 からメタデータ取得
5. メタデータ + 類似度を LLM プロンプトへ注入
6. Groq（JSON mode）で `part` / `reason` / `nextAction` を生成
7. `confidence` は Top-1 コサイン類似度を `[0,1]` に正規化（LLM 生成ではない）
8. `confidence < 0.6` または検索 0 件ならフォールバック（LLM は呼ばない）

## 主要定数

- `CONFIDENCE_THRESHOLD = 0.6`
- `TOP_K = 3`
- `EMBEDDING_MODEL = "@cf/baai/bge-m3"`
- `GROQ_MODEL = "llama-3.1-8b-instant"`

## 今後の拡張

- Cloudflare AI Gateway によるレスポンスキャッシュ
- 入力デバウンス（フロントエンド側）
- 部品画像や修理動画リンク
- 対話型診断（追加質問）
- 本番運用時の dev 用インデックス分離
