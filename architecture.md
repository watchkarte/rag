# アーキテクチャ

## 1. システム概要

WatchKarte は、Cloudflare Workers 上で動作するクォーツアナログ時計の故障診断 RAG サービスです。  
ユーザーが入力した症状テキストから、ベクトル検索と LLM を組み合わせて最も可能性の高い故障部品を推定します。

```
┌─────────────┐     POST /diagnose      ┌─────────────────────────────────────┐
│  ユーザー    │ ───────────────────────▶ │        Cloudflare Workers            │
│  (ブラウザ)  │                          │  Hono + Hono JSX                     │
└─────────────┘                          └─────────────────────────────────────┘
                                                    │
        │                                           │
        ▼                                           ▼
┌─────────────┐                          ┌─────────────────┐
│   GET /     │                          │  Workers AI     │
│  診断 UI    │                          │  @cf/baai/bge-m3 │
└─────────────┘                          │  1024 次元埋め込み │
                                         └─────────────────┘
                                                    │
                                                    ▼
                                         ┌─────────────────┐
                                         │  Cloudflare     │
                                         │  Vectorize      │
                                         │  Top-K=3 検索   │
                                         └─────────────────┘
                                                    │
                                                    ▼
                                         ┌─────────────────┐
                                         │  Cloudflare D1  │
                                         │  メタデータ取得  │
                                         └─────────────────┘
                                                    │
                                                    ▼
                                         ┌─────────────────┐
                                         │  Groq API       │
                                         │  llama-3.1-8b   │
                                         │  JSON mode      │
                                         └─────────────────┘
                                                    │
                                                    ▼
                                          { part, confidence,
                                            reason, nextAction }
```

## 2. コンポーネント責務

### 2.1 エントリポイント

- **`src/index.ts`**: Hono アプリの初期化、ルーティング登録
- **`src/types.ts`**: Cloudflare Workers Bindings と型定数

### 2.2 ルート

| ファイル | パス | 責務 |
|---------|------|------|
| `src/routes/page.ts` | `GET /` | Hono JSX 診断ページを返す |
| `src/routes/diagnose.ts` | `POST /diagnose` | 症状を受け取り診断結果を JSON で返す |

### 2.3 サービス

| ファイル | 責務 |
|---------|------|
| `src/services/embedding.ts` | Workers AI `bge-m3` で症状テキストを 1024 次元ベクトル化 |
| `src/services/vectorize.ts` | Cloudflare Vectorize への Top-K 検索クエリ |
| `src/services/database.ts` | D1 から診断メタデータを取得 |
| `src/services/llm.ts` | Groq API への JSON mode リクエストと簡易型ガード |

### 2.4 コンポーネント

| ファイル | 責務 |
|---------|------|
| `src/components/DiagnosisPage.tsx` | Hono JSX による診断 UI（フォーム・チップ・結果カード） |

### 2.5 データ・スクリプト

| ファイル | 責務 |
|---------|------|
| `src/data/seed.json` | 初期診断データ（60 件） |
| `scripts/seed.ts` | D1 + Vectorize へのデータ投入・再構築 |
| `scripts/eval.ts` | `tests/eval.json` を使った Recall@3 / Accuracy@1 評価 |
| `scripts/lib/cloudflare.ts` | seed / eval 用の Cloudflare API クライアント |

## 3. データフロー

### 3.1 診断リクエスト (`POST /diagnose`)

```
1. リクエストボディから symptom を取得
2. symptom が文字列か検証（無効なら 400）
3. Workers AI bge-m3 で 1024 次元ベクトル生成
4. Vectorize で Top-K=3 検索（returnValues: false, returnMetadata: "all"）
5. 検索結果 ID で D1 から diagnoses 行を取得
6. confidence = Top-1 スコアを [0,1] に正規化
7. confidence < 0.6 または 0 件ならフォールバック応答を返す
8. メタデータ + 類似度スコアをプロンプトに組み込み Groq JSON mode で生成
9. LLM 出力をパースし、{ part, reason, nextAction } を取得
10. confidence と合体して { part, confidence, reason, nextAction } を返す
```

### 3.2 初期データ投入 (`npm run seed`)

```
1. .env から Cloudflare 認証情報を読み込み
2. D1 の diagnoses テーブルをクリア
3. seed.json を D1 に INSERT
4. Vectorize インデックスをクリア
5. D1 から全行取得し、埋め込みテキストを生成
6. Workers AI で埋め込みベクトルをバッチ生成
7. Vectorize に upsert
```

## 4. データモデル

### 4.1 D1 `diagnoses`

```sql
CREATE TABLE diagnoses (
  id TEXT PRIMARY KEY,
  symptom TEXT NOT NULL,
  part TEXT NOT NULL,
  difficulty TEXT,
  description TEXT
);
```

### 4.2 埋め込みテキスト形式

```
症状: {symptom}
部品: {part}
説明: {description}
```

`difficulty` は埋め込みに含めない。

### 4.3 Vectorize メタデータ

```json
{
  "id": "diag_001",
  "namespace": "default"
}
```

## 5. 外部連携

### 5.1 Cloudflare Workers Bindings

| Binding | 型 | 用途 |
|---------|-----|------|
| `DB` | `D1Database` | メタデータの読み書き |
| `VECTORIZE` | `VectorizeIndex` | ベクトル検索 |
| `AI` | `Ai` | Workers AI 埋め込み生成 |
| `GROQ_API_KEY` | `string` | Groq API 認証（Secret） |

### 5.2 Groq API

- URL: `https://api.groq.com/openai/v1/chat/completions`
- Model: `llama-3.1-8b-instant`
- Mode: `response_format: { type: "json_object" }`
- レートリミット（429）時はリトライせず即座にエラー返却

## 6. エラーハンドリング

| 事象 | 動作 |
|------|------|
| リクエスト不正 | 400 `{ error }` |
| Workers AI トークン制限 | 429 `{ error }` |
| Groq レートリミット | 429 `{ error }` |
| Vectorize 0 件 | フォールバック応答（200） |
| confidence < 0.6 | フォールバック応答（200） |
| LLM JSON パース失敗 | 500 `{ error }`、詳細は `console.error` |
| その他サーバーエラー | 500 `{ error }` |

## 7. スクリプト・コマンド

```bash
npm run dev              # wrangler dev --remote
npm run deploy           # wrangler deploy
npm run typecheck        # tsc --noEmit
npm run seed             # D1 + Vectorize 初期化・データ投入
npm run eval             # Recall@3 / Accuracy@1 評価
npm run db:migrate:remote # D1 スキーマ適用（リモート）
```

## 8. 制約・前提

- Vectorize は local モード非対応 → `wrangler dev --remote` が必須
- seed は本番 Vectorize インデックスを一時的にクリアする
- レート制限・認証はコード側では実装せず、Cloudflare WAF/Bot Management に任せる
- 監視は `wrangler tail` + `console.error` のみ
