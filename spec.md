# クォーツアナログ時計故障診断 RAG API - PoC 仕様書

## 1. 目的

Cloudflare Workers + Hono で動作する、クォーツアナログ時計の故障症状を入力すると最も可能性の高い部品を診断する RAG サービスの PoC を作成する。

**PoC で検証する核心リスク**: RAG 検索の精度（症状→部品の Retrieval 品質）。

## 2. 技術スタック（固定）

| レイヤー | サービス |
|---------|---------|
| フレームワーク | Hono (Cloudflare Workers アダプタ) |
| ベクトル DB | Cloudflare Vectorize |
| メタデータ DB | Cloudflare D1 |
| 埋め込みモデル | Workers AI `@cf/baai/bge-m3` (1024 次元) |
| LLM | Groq API `llama-3.1-8b-instant` |
| キャッシュ | 今回は実装しない（将来拡張） |

## 3. 無料枠制限（設計の前提条件）

- Groq: 14,400 req/日, 30 RPM, 30K TPM
- Workers AI: 10,000 トークン/日
- Vectorize: 30M 次元クエリ/月, 5M 次元保存/月
- D1: 5GB まで

## 4. ディレクトリ構造

```
clock-diagnosis-rag/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── .dev.vars.example
├── README.md
├── spec.md
├── src/
│   ├── index.ts          # Hono アプリエントリーポイント
│   ├── types.ts          # Cloudflare Workers 環境変数の型定義
│   ├── routes/
│   │   └── diagnose.ts   # POST /diagnose エンドポイント
│   └── services/
│       ├── embedding.ts  # Workers AI でベクトル生成
│       ├── vectorize.ts  # Vectorize 検索
│       ├── database.ts   # D1 メタデータ取得
│       └── llm.ts        # Groq API 呼び出し
├── src/data/
│   └── seed.json         # 初期診断データ（50 件以上）
├── scripts/
│   ├── seed.ts           # D1 + Vectorize 初期データ投入スクリプト
│   └── eval.ts           # Retrieval / End-to-end 評価スクリプト
└── tests/
    └── eval.json         # 評価用症状クエリ（seed とは別）
```

## 5. grill-me 決定事項

| 項目 | 決定内容 |
|------|----------|
| 埋め込みテキスト | `symptom` + `part` + `description` を連結。`difficulty` は含めない。 |
| 評価方法 | `tests/eval.json` を別途作成し、`scripts/eval.ts` で自動評価。 |
| 評価指標 | `Recall@3`（正解部品が Top-3 に入る割合）と `Accuracy@1`（最終応答の part が正解か）。 |
| confidence | Top-1 のコサイン類似度スコアを正規化して使用。LLM 生成ではない。 |
| confidence 閾値 | 0.6。未満または検索結果 0 件の場合はフォールバック。 |
| フォールバックメッセージ | 「データに無いため診断できませんでした。」 |
| ローカル開発 | Vectorize モックは使用せず、本番 Vectorize インデックスを参照（読み取り専用）。 |
| seed リスク | PoC なので、seed 実行中の本番一時停止を許容。 |
| JSON パース | Groq JSON mode（`response_format: { type: "json_object" }`）+ 簡易型ガード。 |
| パース失敗時 | ユーザーに「レスポンスの JSON パースに失敗しました。」を表示。詳細はログ出力。 |
| キャッシュ | 今回は実装せず、将来拡張として README に記載。 |
| Top-K | 3。評価結果次第で見直し。 |
| リクエストバリデーション | `symptom` が存在し文字列であることのみ確認。文字数制限は設けない。 |
| レスポンス形式 | 成功/フォールバックは `{ part, confidence, reason, nextAction }`、エラー（429/500 等）は `{ error }`。 |
| LLM プロンプト | 各検索結果の symptom/part/description に加え、類似度スコアも含める。 |

## 6. API 仕様

### 6.1 エンドポイント

- `POST /diagnose`

### 6.2 リクエスト

```json
{
  "symptom": "秒針が5秒おきに飛んで止まる"
}
```

### 6.3 成功レスポンス（200）

```json
{
  "part": "電池",
  "confidence": 0.92,
  "reason": "秒針が5秒間隔で飛ぶ動きは、電池電圧低下時のIC省電力モードの典型症状です。",
  "nextAction": "電池を新品に交換してください。"
}
```

### 6.4 フォールバックレスポンス（200）

```json
{
  "part": null,
  "confidence": 0.0,
  "reason": "データに無いため診断できませんでした。",
  "nextAction": "専門の時計修理店に相談してください。"
}
```

### 6.5 エラーレスポンス

```json
{
  "error": "Workers AI のトークン制限に達しました。しばらく経ってからお試しください。"
}
```

HTTP ステータスコード:
- 400: リクエストボディ不正
- 429: レートリミット（Groq / Workers AI）
- 500: サーバーエラー

## 7. RAG パイプライン

### 7.1 処理フロー

1. リクエスト `symptom` を受け取る
2. `symptom` を Workers AI `bge-m3` で 1024 次元ベクトル化
3. Vectorize で Top-K=3 検索（`returnValues: false`, `returnMetadata: "all"`）
4. 検索結果の ID で D1 からメタデータ取得
5. メタデータ + 類似度スコアを LLM プロンプトに注入
6. Groq で JSON モードで診断結果を生成
7. confidence は Top-1 の類似度スコアを正規化して使用
8. confidence < 0.6 または検索結果 0 件の場合はフォールバック

### 7.2 埋め込みテキスト形式

```
症状: {symptom}
部品: {part}
説明: {description}
```

## 8. データモデル

### 8.1 D1 テーブル

```sql
CREATE TABLE diagnoses (
  id TEXT PRIMARY KEY,
  symptom TEXT NOT NULL,
  part TEXT NOT NULL,
  difficulty TEXT,
  description TEXT
);
```

### 8.2 seed.json スキーマ

```json
[
  {
    "id": "diag_001",
    "symptom": "秒針が5秒おきに飛んで止まる",
    "part": "電池",
    "difficulty": "容易",
    "description": "電池電圧が低下すると、秒針が5秒間隔で飛んで動くICの省電力モードが発動します。"
  }
]
```

### 8.3 eval.json スキーマ

```json
[
  {
    "query": "秒針が5秒ずつ飛んで動く",
    "expectedPart": "電池"
  }
]
```

## 9. プロンプト設計

### 9.1 システムプロンプト

```
あなたはクォーツアナログ時計の修理技術者です。
以下の参考情報とユーザーの症状から、最も可能性が高い故障部品を1つ特定し、JSONで出力してください。

参考情報:
{retrievedContexts}

ユーザー症状:
{symptom}

出力形式:
{
  "part": "部品名（日本語）",
  "reason": "診断理由（100文字以内）",
  "nextAction": "ユーザーが取るべき次の行動"
}

注意:
- part は参考情報の中から最も可能性が高い部品を1つ選んでください。
- reason は簡潔に、100文字以内で説明してください。
- nextAction は具体的な次の行動を示してください。
```

### 9.2 retrievedContexts 形式

```
[1] 部品: 電池（類似度: 0.92）
症状: 秒針が5秒おきに飛んで止まる
説明: 電池電圧が低下すると、秒針が5秒間隔で飛んで動くICの省電力モードが発動します。

[2] 部品: 歯車（類似度: 0.45）
症状: 針がぶつかって止まる
説明: 衝撃で歯車が変形すると、針同士が干渉して停止します。
```

## 10. エラーハンドリング

- Workers AI トークン制限超過時: 429 を返す
- Groq レートリミット（429）時: リトライなし、即座にエラーレスポンス
- Vectorize 検索結果 0 件時: フォールバックメッセージを返す
- LLM レスポンス JSON パース失敗時: ユーザーにパース失敗メッセージ、サーバーサイドにログ
- その他のサーバーエラー: 500 + `{ error }`

## 11. ローカル開発

- Vectorize は `wrangler dev` で動作しないため、本番 Vectorize インデックスを参照する
- `wrangler dev` 時の読み取りは本番インデックスに影響しない
- seed 実行時は本番インデックスのデータを削除・再投入するため、PoC として一時的なサービス停止を許容
- `.dev.vars.example` に必要な環境変数を記載

## 12. デプロイ手順

1. `npm install`
2. `wrangler d1 create clock-diagnosis-db`
3. `wrangler vectorize create clock-diagnosis-index --dimensions=1024 --metric=cosine`
4. `wrangler d1 migrations apply clock-diagnosis-db --local`（スキーマ作成）
5. `npx tsx scripts/seed.ts`（初期データ投入）
6. `wrangler deploy`
7. Groq API キーを Workers Secret に登録: `wrangler secret put GROQ_API_KEY`

## 13. 評価

- `tests/eval.json` に評価クエリを定義
- `scripts/eval.ts` で以下を計測:
  - `Recall@3`: 正解部品が Vectorize Top-3 に含まれる割合
  - `Accuracy@1`: 最終 API レスポンスの `part` が正解と一致する割合

## 14. 今後の拡張

- Cloudflare AI Gateway によるレスポンスキャッシュ
- 入力デバウンス（フロントエンド側）
- 部品画像や修理動画のリンク追加
- 対話型診断（追加質問）
- 本番運用時の dev 用インデックス分離
