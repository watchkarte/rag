# WatchKarte MVP 仕様書

> **作成背景**: `clock-diagnosis-rag` PoC の RAG 精度を検証し、`/home/masasikatano/project/app`（Astro 6 + React Islands のチャット MVP）を参考に、エンドユーザーが直接触れる最小構成の MVP としたもの。
> このドキュメントは grill-me プロセスでユーザーと合意した **Single Source of Truth** とする。

## 1. 製品概要

**製品名**: WatchKarte

**コンセプト**: クォーツアナログ時計の故障症状を入力すると、最も可能性の高い部品と次のアクションを診断するシンプルな Web サービス。

**ターゲットユーザー**:

- クォーツアナログ時計の不具合を自分で把握したい一般ユーザー
- 修理に出す前に原因を絞りたい人

**価値提案**:

- 専門用語を使わず、症状だけで部品を推定
- 信頼感のある簡潔な診断結果と、今日からできる次のアクションを提示

## 2. MVP スコープ

### 2.1 採択（MVP に含める）

- **Hono + Cloudflare Workers で動作する診断 API** (`POST /diagnose`)
- **Hono JSX で実装した単一画面診断 UI** (`GET /`)
  - 症状入力フォーム
  - 診断結果カード（part / confidence / reason / nextAction）
  - 例示症状チップ 6〜10 件
- **app 準拠のライトモード・携帯特化 UI**（max-width 440px 想定）
- **PoC と同じ RAG パイプライン**
  - Workers AI `@cf/baai/bge-m3` による 1024 次元ベクトル化
  - Cloudflare Vectorize Top-K=3 検索
  - Cloudflare D1 からのメタデータ取得
  - Groq `llama-3.1-8b-instant` JSON mode による診断生成
- **診断データ 60 件、評価セット 20 件を維持**
- **リリース品質基準**: Recall@3 ≥ 70%、Accuracy@1 ≥ 60%



### 2.2 非採用（MVP では入れない）

- Astro + React への移行（将来的に検討）
- ユーザーアカウント・ログイン
- レートリミットのコード実装（WAF/Bot Management に任せる）
- Cloudflare AI Gateway によるキャッシュ
- 診断履歴の保存・フィードバック機能
- 本番/dev 用インデックス分離
- Cloudflare Workers Analytics / Observability（`wrangler tail` + `console.error` のみ）



## 3. 技術スタック


| レイヤー     | サービス                                   |
| -------- | -------------------------------------- |
| フレームワーク  | Hono (Cloudflare Workers アダプタ)         |
| UI       | Hono JSX (`hono/jsx`)                  |
| ベクトル DB  | Cloudflare Vectorize                   |
| メタデータ DB | Cloudflare D1                          |
| 埋め込みモデル  | Workers AI `@cf/baai/bge-m3` (1024 次元) |
| LLM      | Groq API `llama-3.1-8b-instant`        |
| キャッシュ    | なし                                     |
| 監視       | `wrangler tail` + `console.error`      |




## 4. ディレクトリ構造

```
rag/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── .env.example
├── .dev.vars.example
├── README.md
├── spec.md              # PoC 仕様書（参照用）
├── spec_mvp.md          # 本ドキュメント
├── migrations/
│   └── 0001_create_diagnoses.sql
├── src/
│   ├── index.ts         # Hono アプリエントリーポイント
│   ├── types.ts         # Cloudflare Workers 環境変数・型定義
│   ├── routes/
│   │   ├── diagnose.ts  # POST /diagnose エンドポイント
│   │   └── page.ts      # GET / 診断 UI（Hono JSX）
│   ├── components/
│   │   └── DiagnosisPage.tsx   # Hono JSX 診断ページ
│   ├── services/
│   │   ├── embedding.ts # Workers AI でベクトル生成
│   │   ├── vectorize.ts # Vectorize 検索
│   │   ├── database.ts  # D1 メタデータ取得
│   │   └── llm.ts       # Groq API 呼び出し
│   └── data/
│       └── seed.json    # 初期診断データ（60 件）
├── scripts/
│   ├── seed.ts          # D1 + Vectorize 初期データ投入
│   └── eval.ts          # Retrieval / End-to-end 評価
└── tests/
    └── eval.json        # 評価用症状クエリ（20 件）
```



## 5. grill-me 決定事項


| 項目            | 決定内容                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| MVP スコープ      | API + Hono JSX 最小診断 UI。Astro 移行は後回し。                                     |
| UI 実装方式       | Hono JSX。`GET /` でフォーム + 結果表示の単一ページ。                                     |
| 製品名           | WatchKarte                                                               |
| UI ブランド       | app 風ライトモード・携帯特化。信頼感重視。                                                  |
| LLM プロバイダー    | Groq `llama-3.1-8b-instant` のまま JSON mode で使用。                           |
| レート制限・認証      | コード側では実装せず、Cloudflare WAF/Bot Management に任せる。認証なし。                      |
| キャッシュ         | なし。                                                                      |
| 監視            | `wrangler tail` + `console.error` のみ。                                    |
| データ・評価        | seed 60 件、eval 20 件を維持。リリース基準 Recall@3 ≥ 70%、Accuracy@1 ≥ 60%。           |
| UI 機能         | 例示症状チップ 6〜10 件を表示。                                                       |
| メッセージスタイル     | 簡潔・事実的。app 風のキャラ口調は採用しない。                                                |
| Top-K         | 3                                                                        |
| confidence 閾値 | 0.6（未満または検索結果 0 件はフォールバック）                                               |
| 文字数制限         | なし                                                                       |
| 埋め込みテキスト      | `symptom` + `part` + `description` を連結。`difficulty` は含めない。               |
| confidence    | Top-1 のコサイン類似度スコアを正規化。LLM 生成ではない。                                        |
| フォールバックメッセージ  | 「データに無いため診断できませんでした。」                                                    |
| JSON パース      | Groq JSON mode + 簡易型ガード。失敗時はユーザーにエラーメッセージ、詳細はログ。                         |
| レスポンス形式       | 成功/フォールバックは `{ part, confidence, reason, nextAction }`、エラーは `{ error }`。 |




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
- 500: サーバーエラー / JSON パース失敗



## 7. UI 仕様



### 7.1 ページ構成

`GET /` で返す Hono JSX ページ。

### 7.2 レイアウト

- ヘッダー: 製品名「WatchKarte」
- メイン: 症状入力フォーム + 送信ボタン
- 例示チップ: 画面下部または入力欄下に 6〜10 件
- 結果エリア: 診断結果カード（part / confidence / reason / nextAction）
- フッター: 免責事項（「この診断は参考情報です。重要な修理は専門店へ」など）



### 7.3 スタイル

- ライトモード（白背景 + 紺/グレーアクセント）
- 携帯特化、中央寄せ、max-width 440px
- app の `styles/global.css` の簡易版を参考に、Hono JSX 内で `<style>` または Tailwind CDN で実装



### 7.4 例示症状チップ（候補）

- 「秒針が5秒おきに飛んで止まる」
- 「針がぶつかって止まる」
- 「電池を交換しても動かない」
- 「時刻が遅れる」
- 「液晶が暗い」
- 「リュウズが回らない」



## 8. RAG パイプライン

1. リクエスト `symptom` を受け取る
2. `symptom` を Workers AI `bge-m3` で 1024 次元ベクトル化
3. Vectorize で Top-K=3 検索（`returnValues: false`, `returnMetadata: "all"`）
4. 検索結果の ID で D1 からメタデータ取得
5. メタデータ + 類似度スコアを LLM プロンプトに注入
6. Groq で JSON モードで診断結果を生成
7. `confidence` は Top-1 の類似度スコアを `[0,1]` に正規化
8. `confidence < 0.6` または検索結果 0 件の場合は LLM を呼ばずフォールバック



## 9. データモデル



### 9.1 D1 テーブル

```sql
CREATE TABLE diagnoses (
  id TEXT PRIMARY KEY,
  symptom TEXT NOT NULL,
  part TEXT NOT NULL,
  difficulty TEXT,
  description TEXT
);
```



### 9.2 seed.json スキーマ

```json
[
  {
    "id": "battery_001",
    "symptom": "秒針が5秒おきに飛んで止まる",
    "part": "電池",
    "difficulty": "容易",
    "description": "電池電圧が低下すると、秒針が5秒間隔で飛んで動くICの省電力モードが発動します。"
  }
]
```



### 9.3 eval.json スキーマ

```json
[
  {
    "query": "秒針が5秒ずつ飛んで動く",
    "expectedPart": "電池"
  }
]
```

