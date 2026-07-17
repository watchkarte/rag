# Cloudflare アカウント作成後の手順

このドキュメントは、Cloudflare アカウントを作成したあとに行うセットアップを順番にまとめたものです。  
アプリ本体の説明は [`README.md`](./README.md)、仕様は [`spec.md`](./spec.md) を参照してください。

前提:

- リポジトリのコードはすでに用意済み
- `.env` に `GROQ_API_KEY` が設定済みであること
- Node.js / npm が使えること

---

## チェックリスト（全体像）

1. [ ] Wrangler ログイン
2. [ ] Account ID の確認
3. [ ] **workers.dev サブドメインの登録**（`npm run dev` / remote の前提）
4. [ ] API Token の作成
5. [ ] D1 データベース作成
6. [ ] Vectorize インデックス作成
7. [ ] `wrangler.toml` の `database_id` 更新
8. [ ] D1 マイグレーション適用
9. [ ] `.env` / `.dev.vars` の設定
10. [ ] seed（初期データ投入）
11. [ ] seed.json を変更した場合の再投入
12. [ ] ローカル動作確認（`npm run dev` / `npx wrangler dev --remote`）
13. [ ] デプロイ + Secret 登録
14. [ ] （任意）評価スクリプト実行

---

## 1. 依存関係のインストール

プロジェクトルートで:

```bash
npm install
```

以降のコマンドは、特に断りがなければプロジェクトルートで実行します。

---

## 2. Wrangler にログイン

```bash
npx wrangler login
```

ブラウザが開くので、作成した Cloudflare アカウントで許可します。

ログイン確認:

```bash
npx wrangler whoami
```

---

## 3. workers.dev サブドメインを登録する（必須）

本 PoC の `npm run dev` は **`npx wrangler dev --remote`** 相当です。  
Vectorize はローカルモード非対応のため、開発時も Cloudflare 上の remote 実行が必要です。  
remote モードでは、事前に **workers.dev サブドメイン登録** が必須です。

### 何ができていればよいか

| 用語 | 実例（このプロジェクト） | 意味 |
|------|--------------------------|------|
| **workers.dev サブドメイン**（アカウント単位） | `watchkarte.workers.dev` | アカウントに 1 つ。remote dev の前提 |
| **Worker URL**（アプリ単位） | `rag.watchkarte.workers.dev` | Git 連携で作った Worker 名 `rag` の本番 URL |
| **Preview URL** | `*-rag.watchkarte.workers.dev` | プレビュー用 |

`watchkarte` 部分がアカウント共通サブドメインです。これが付いていれば手順 3 の目的は達成です。

### 手順: Create application で有効化する

1. **Workers & Pages** を開く

   `https://dash.cloudflare.com/<ACCOUNT_ID>/workers-and-pages`

2. **Create application** を選ぶ
3. **Import a repository** で GitHub リポジトリを接続する  
   例: `https://github.com/watchkarte/rag`
4. 作成後、Worker の **Domains** 画面を開く  
   例:

   `https://dash.cloudflare.com/<ACCOUNT_ID>/workers/services/view/rag/production/domains`

5. 次の **Worker URL** が表示されていることを確認する

   | 種別 | 表示例 |
   |------|--------|
   | Production | `rag.watchkarte.workers.dev` |
   | Preview | `*-rag.watchkarte.workers.dev` |

6. 各 URL の横にある **有効化セレクトボックスを ON** にする

これでアカウントに `watchkarte.workers.dev` が紐づき、Worker 公開 URL も使える状態になります。

> リポジトリ名が `rag` の場合、ダッシュボード上の Worker 名も `rag` になります。  
> `wrangler.toml` の `name = "rag"` と一致しているため、CLI デプロイでも同じ URL `https://rag.watchkarte.workers.dev/` が使えます。

### 登録できたか確認する

Domains 画面で Production / Preview の workers.dev URL が **ON** なら成功です。

```text
Production  rag.watchkarte.workers.dev          ON
Preview     *-rag.watchkarte.workers.dev        ON
```

その後、手元で:

```bash
npm run dev
```

`register a workers.dev subdomain` / `edge-preview` エラーが出なければ、この手順は完了です。

### Git 連携 Worker と CLI デプロイの関係

現在の本番環境は `https://rag.watchkarte.workers.dev/` です。  
`wrangler.toml` の `name = "rag"` に従い、`npx wrangler deploy` でも Worker 名 `rag` でデプロイされます。

| 経路 | Worker 名 | URL 例 | 位置づけ |
|------|-----------|--------|----------|
| `npx wrangler deploy`（CLI） | `rag` | `https://rag.watchkarte.workers.dev` | 本番デプロイ |
| Create application（GitHub） | `rag` | `https://rag.watchkarte.workers.dev` | workers.dev 有効化用（既に完了） |

Git 連携で作った `rag` は、サブドメイン有効化の目的を果たせば十分です。  
以降の seed / バインディング付き本番運用は、README どおり **CLI（`wrangler deploy`）** を主に使って問題ありません。Git 連携側は残しても削除しても構いません。

### 未登録のときに出るエラー（実例）

```text
✘ [ERROR] You need to register a workers.dev subdomain before running the
dev command in remote mode. You can either enable local mode by pressing l,
or register a workers.dev subdomain here:
https://dash.cloudflare.com/<ACCOUNT_ID>/workers/onboarding

✘ [ERROR] Failed to start the remote proxy session.
Error reloading remote server: A request to the Cloudflare API
(/accounts/.../workers/subdomain/edge-preview) failed.
```

**対処**: 上記手順で workers.dev URL を ON にしてから、`npm run dev` を再実行する。  
`l` キーで local モードに切り替えても、**Vectorize は `not supported` のまま**なので、このプロジェクトでは診断 API は動きません（後述）。

> サブドメイン（例: `watchkarte.workers.dev`）は **1 アカウントにつき 1 回** で足ります。

---

## 4. Account ID を控える

次のいずれかで Account ID を取得します。

- ダッシュボード右サイドバー / Workers 概要に表示される **Account ID**
- または:

```bash
npx wrangler whoami
```

後で `.env` の `CLOUDFLARE_ACCOUNT_ID` に設定します。

---

## 5. API Token を作成する（seed / eval 用）

seed・eval スクリプトは Cloudflare REST API を使うため、API Token が必要です。

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **My Profile** → **API Tokens**
2. **Create Token**
3. カスタム作成、または近いテンプレートから編集
4. 最低限、次の権限を付与する（Account スコープ）:

| 権限 | アクセス |
|------|----------|
| Account / D1 | Edit |
| Account / Vectorize | Edit |
| Account / Workers AI | Run（または Edit 相当） |
| Account / Workers Scripts | Edit（デプロイもトークンで行う場合） |

5. 作成後に表示されるトークンをコピーする（**再表示できない**）

後で `.env` の `CLOUDFLARE_API_TOKEN` に設定します。

> **注意**: トークンを Git にコミットしないこと。`.env` は `.gitignore` 済みです。

---

## 6. D1 データベースを作成する

```bash
npx wrangler d1 create clock-diagnosis-db
```

成功すると、次のような出力が出ます（値は例）:

```text
✅ Successfully created DB 'clock-diagnosis-db'

[[d1_databases]]
binding = "DB"
database_name = "clock-diagnosis-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**`database_id` を控えてください。** 次のステップで `wrangler.toml` に書き込みます。  
同じ値を `.env` の `D1_DATABASE_ID` にも使います。

---

## 7. Vectorize インデックスを作成する

埋め込みモデル `@cf/baai/bge-m3` は **1024 次元**、類似度は **cosine** です。

```bash
npx wrangler vectorize create clock-diagnosis-index --dimensions=1024 --metric=cosine
```

`wrangler.toml` のインデックス名はすでに次のとおりです（変更不要）:

```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "clock-diagnosis-index"
```

---

## 8. `wrangler.toml` を更新する

`database_id` のプレースホルダを、手順 6 で得た実 ID に置き換えます。

```toml
[[d1_databases]]
binding = "DB"
database_name = "clock-diagnosis-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # ← ここを更新
migrations_dir = "migrations"
```

`REPLACE_WITH_D1_DATABASE_ID` のまま残っていると、migrate / deploy が失敗します。

---

## 9. D1 スキーマ（マイグレーション）を適用する

リモート（本番 D1）へ:

```bash
npm run db:migrate:remote
```

同等の直接コマンド:

```bash
npx wrangler d1 migrations apply clock-diagnosis-db --remote
```

ローカル D1 だけ試す場合（任意）:

```bash
npm run db:migrate:local
```

> 本 PoC の Vectorize は本番インデックス参照のため、実質は **remote マイグレーション + seed** が主経路です。

---

## 10. 環境変数を設定する

### 10.1 `.env`（seed / eval + 共通）

未作成なら:

```bash
cp .env.example .env
```

少なくとも次を埋めます:

```bash
# すでに設定済みのはず
GROQ_API_KEY=gsk_...

# Cloudflare（このドキュメントで取得したもの）
CLOUDFLARE_ACCOUNT_ID=<Account ID>
CLOUDFLARE_API_TOKEN=<API Token>
D1_DATABASE_ID=<D1 database_id>
VECTORIZE_INDEX_NAME=clock-diagnosis-index

# eval 用（ローカル dev の場合）
DIAGNOSE_API_URL=http://127.0.0.1:8787/diagnose
```

### 10.2 `.dev.vars`（`wrangler dev` 用）

Wrangler のローカル/remote 開発実行は `.env` ではなく **`.dev.vars`** を読みます。

```bash
cp .dev.vars.example .dev.vars
```

Worker 本体が必要なのは **`GROQ_API_KEY` のみ** です。

```bash
GROQ_API_KEY=gsk_...   # .env と同じ値
```

> `.env` を丸ごと `.dev.vars` にコピーしても動作はしますが、  
> `CLOUDFLARE_ACCOUNT_ID` などは Worker では使わず、起動ログに Environment Variable として出るだけです。  
> seed / eval 用の変数は **`.env` 側** に置いてください。

---

## 11. 初期データを投入する（seed）

D1 メタデータ + Vectorize ベクトルを投入します。

```bash
npm run seed
```

処理内容:

1. Vectorize インデックス内ベクトルのクリア
2. D1 `diagnoses` のクリア
3. `src/data/seed.json` の全件を D1 へ INSERT
4. Workers AI で埋め込み生成 → Vectorize へ upsert

> **注意**: 本番インデックスを一度空にしてから再投入します。PoC として一時的なサービス停止を許容する前提です。

Workers AI の無料枠（トークン/日）があるため、seed は時間がかかったり、枠超過で失敗したりする場合があります。失敗したら時間をおいて再実行してください。

---

## 12. seed.json を変更した場合

診断データを追加・修正・並び替えしたら、**必ず seed を再実行**してください。`npm run seed` はリモートの D1 と Vectorize を一度クリアしてから、`src/data/seed.json` を再投入します。

### 12.1 変更手順

1. `src/data/seed.json` を編集する
2. JSON 構文を確認する（コメントを許容）:

   ```bash
   node -e "const fs=require('fs'); const r=fs.readFileSync('./src/data/seed.json','utf8'); JSON.parse(r.replace(/\/\/.*$/gm,'').replace(/\/\*[\\s\\S]*?\*\//g,'')); console.log('OK')"
   ```

3. リモートへ再投入:

   ```bash
   npm run seed
   ```

   処理内容:

   - Vectorize インデックス内ベクトルのクリア
   - D1 `diagnoses` のクリア
   - 変更後の `src/data/seed.json` を D1 へ INSERT
   - Workers AI で埋め込み生成 → Vectorize へ upsert

4. 動作確認:

   ```bash
   npm run dev
   ```

   別ターミナルで:

   ```bash
   curl -s http://127.0.0.1:8787/diagnose \
     -H 'content-type: application/json' \
     -d '{"symptom":"秒針が5秒おきに飛んで止まる"}'
   ```

5. （任意）評価スクリプトで影響を確認:

   ```bash
   npm run eval
   ```

### 12.2 ID の命名規則

`src/data/seed.json` の `id` は **`{part の英語prefix}_{連番3桁}`** の形式です。連番は各 `part` ごとに 001 から振り直します。

例:

- `battery_001`（電池）
- `gear_002`（歯車）
- `ic_003`（IC）
- `crown_packing_001`（リューズ防水パッキン）

主要な `part` と prefix の対応:

| part | prefix |
|------|--------|
| IC | `ic` |
| カレンダー機構 | `calendar` |
| ケース | `case` |
| コイル | `coil` |
| ステッピングモーター | `stepping_motor` |
| パッキン | `packing` |
| ムーブメント | `movement` |
| リューズ | `crown` |
| リューズ防水パッキン | `crown_packing` |
| 歯車 | `gear` |
| 潤滑油 | `lubricant` |
| 針 | `hand` |
| 水晶振動子 | `crystal` |
| 電池 | `battery` |
| 電池接点（ムーブメント） | `battery_contact` |
| 秒針 | `second_hand` |
| 文字盤 | `dial` |

新規追加するときは、同じ `part` グループ内で既存の最大連番の次の番号を使ってください。たとえば `battery` グループに追加するなら `battery_006` などです。ID は D1 と Vectorize の双方で主キーとして使われるため、重複させないでください。

### 12.3 並び順について

`src/data/seed.json` は管理しやすさのため `part` 順に並んでいます。ファイル内の順序は Vectorize / D1 への投入結果に影響しません。新規追加時は、該当する `part` グループ内に配置すると管理しやすいです。

### 12.4 Worker コードの再デプロイが必要か

`seed.json` の内容変更だけなら、**Worker 本体の再デプロイは不要**です。診断データは D1 と Vectorize に格納されているため、`npm run seed` だけで反映されます。

ただし、以下の場合は `npx wrangler deploy` が必要です:

- `seed.json` のスキーマ変更（新しいフィールド追加など）に伴い、`src/services/database.ts` などのコードも変更した場合
- 診断ロジック（`src/services/llm.ts` など）を変更した場合

### 12.5 本番環境への反映

本番 D1 / Vectorize へ反映する場合も同様です:

```bash
npm run seed
```

`npm run seed` は `.env` の `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` / `D1_DATABASE_ID` / `VECTORIZE_INDEX_NAME` を使ってリモートリソースを更新します。本番 URL で動作確認してください:

```bash
curl -s https://rag.watchkarte.workers.dev/diagnose \
  -H 'content-type: application/json' \
  -d '{"symptom":"秒針が5秒おきに飛んで止まる"}'
```

> **注意**: `npm run seed` は本番インデックスをクリアして再投入します。運用中のサービスでは、メンテナンスウィンドウ内で実行してください。

---

## 13. ローカルで動作確認する

### 13.1 起動コマンド（重要）

`wrangler` は **グローバルインストールしていません**。  
`npm install` 後に `node_modules` 内へ入るため、次のどちらかで起動します。

| コマンド | 説明 |
|----------|------|
| **`npm run dev`**（推奨） | `package.json` 経由。中身は `wrangler dev --remote` |
| **`npx wrangler dev --remote`** | ローカルの wrangler を `npx` で実行 |

```bash
# 推奨
npm run dev

# 同等
npx wrangler dev --remote
```

**使わないこと:**

```bash
wrangler dev --remote
# → wrangler: コマンドが見つかりません
```

グローバルに `wrangler` が無いため、パスが通りません。

### 13.2 なぜ `--remote` が必要か

このプロジェクトは Vectorize + Workers AI +（seed 済みの）リモート D1 を使います。

`npx wrangler dev`（`--remote` なし）を **local モード**で起動すると、バインディングは概ね次のようになります。

| Binding | Mode（local） | 意味 |
|---------|---------------|------|
| `DB` | local | 手元の空に近い D1（remote の seed データは見えない） |
| `VECTORIZE` | **not supported** | 検索不可 → 診断不可 |
| `AI` | remote | 埋め込みだけ Cloudflare 側 |
| `GROQ_API_KEY` | local | `.dev.vars` から読込 |

そのため **pure local では `POST /diagnose` は成立しません**。  
`npm run dev` / `npx wrangler dev --remote` では Worker 本体・D1・Vectorize・AI が Cloudflare 側で動き、seed 済みデータで診断できます。

### 13.3 起動前チェック

- [ ] プロジェクトルートで `npm install` 済み
- [ ] **手順 3**: workers.dev サブドメイン登録済み
- [ ] **手順 11**: `npm run seed` 済み（remote D1 + Vectorize）
- [ ] **手順 10.2**: `.dev.vars` に `GROQ_API_KEY` あり

### 13.4 起動

```bash
cd ~/project/rag   # プロジェクトルート
npm run dev
```

成功時のバインディング表示では、Vectorize が `not supported` ではなく remote 利用可能な状態になります。  
（表示文言は wrangler バージョンで多少異なります。）

### 13.5 リクエスト確認

別ターミナルで:

```bash
curl -s http://127.0.0.1:8787/health

curl -s http://127.0.0.1:8787/diagnose \
  -H 'content-type: application/json' \
  -d '{"symptom":"秒針が5秒おきに飛んで止まる"}'
```

期待する例:

- `part` が部品名（例: `電池`）
- `confidence` が 0〜1 の数値
- `reason` / `nextAction` が入っている

フォールバック時は `part: null` と固定メッセージになります（confidence < 0.6 など）。

### 13.6 よくあるエラー: `wrangler: コマンドが見つかりません`

**症状（実ログ）:**

```text
$ wrangler dev --remote
wrangler: コマンドが見つかりません
```

**原因:** `wrangler` をグローバルコマンドとして叩いている。本プロジェクトでは devDependency のため PATH に無い。

**対処:**

```bash
npm run dev
# または
npx wrangler dev --remote
```

まだ失敗する場合:

```bash
npm install
npm run dev
```

### 13.7 よくあるエラー: workers.dev サブドメイン未登録

**症状（実ログ）:**

```text
Using secrets defined in .dev.vars
Your Worker has access to the following bindings:
  env.DB (...)            D1 Database      local
  env.VECTORIZE (...)     Vectorize Index  not supported
  env.AI                  AI               remote
  ...

⎔ Establishing remote connection...
✘ [ERROR] You need to register a workers.dev subdomain before running the
dev command in remote mode. You can either enable local mode by pressing l,
or register a workers.dev subdomain here:
https://dash.cloudflare.com/<ACCOUNT_ID>/workers/onboarding

✘ [ERROR] Failed to start the remote proxy session.
Error reloading remote server: A request to the Cloudflare API
(/accounts/.../workers/subdomain/edge-preview) failed.
```

**原因:**

1. AI などが remote 接続しようとしている（または `npx wrangler dev --remote`）
2. アカウントに **workers.dev サブドメインが未登録**

**対処（このプロジェクトで正しい方）:**

1. Create application で workers.dev URL を ON にする（[手順 3](#3-workersdev-サブドメインを登録する必須)）
2. もう一度 `npm run dev` を実行する

**やってはいけないこと:**

- エラーメッセージどおり `l` で local モードにする  
  → Vectorize が `not supported` のままなので `/diagnose` は使えない

### 13.8 （参考）`dev:local` について

```bash
npm run dev:local   # = npx wrangler dev（--remote なし）
```

埋め込みや Hono ルーティングの軽確認用です。Vectorize 非対応のため **RAG 診断の検証には使いません**。

---

## 14. 本番デプロイする

```bash
npx wrangler deploy
```

Workers の Secret に Groq キーを登録（ダッシュボードでも可）:

```bash
npx wrangler secret put GROQ_API_KEY
```

プロンプトが出たら `.env` と同じキーを貼り付けます。

デプロイ後の URL（`wrangler.toml` の `name = "rag"` により決まる）:

```text
https://rag.watchkarte.workers.dev
```

動作確認:

```bash
curl -s https://rag.watchkarte.workers.dev/diagnose \
  -H 'content-type: application/json' \
  -d '{"symptom":"秒針が5秒おきに飛んで止まる"}'
```

---

## 15. （任意）評価を実行する

`tests/eval.json` で Retrieval / End-to-end を計測します。

1. `npm run dev` を起動したまま（または `DIAGNOSE_API_URL` を本番 URL に変更）
2. 実行:

```bash
npm run eval
```

出力指標:

- **Recall@3**: 正解部品が Vectorize Top-3 に含まれる割合
- **Accuracy@1**: API レスポンスの `part` が正解と一致する割合

本番 API で評価する場合:

```bash
DIAGNOSE_API_URL=https://rag.watchkarte.workers.dev/diagnose npm run eval
```

---

## よくある失敗と対処

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| `wrangler: コマンドが見つかりません` | グローバル `wrangler` が無い | `npm run dev` または `npx wrangler ...` を使う（手順 13.1 / 13.6） |
| `register a workers.dev subdomain` / `edge-preview` 失敗 | サブドメイン未登録 | [手順 3](#3-workersdev-サブドメインを登録する必須) で登録後、`npm run dev` |
| `VECTORIZE` が `not supported` | local モードで起動している | `npm run dev`（`--remote`）を使う。`l` で local にしない |
| `database_id` 関連エラー | `wrangler.toml` が未更新 | 手順 8 を実施 |
| seed で 401 / 403 | API Token 権限不足 or 誤り | 手順 5 を見直し再作成 |
| seed で Workers AI エラー | 無料枠超過・権限不足 | 時間をおく / Token に Workers AI 権限 |
| `wrangler dev` で Groq エラー | `.dev.vars` 未設定 | 手順 10.2 |
| デプロイ後だけ Groq 失敗 | Secret 未登録 | `wrangler secret put GROQ_API_KEY` |
| 常にフォールバック | seed 未実施 or 類似度不足 | seed 実行 / クエリを変えて再試行 |
| Vectorize が見つからない | インデックス未作成 or 名前不一致 | 手順 7 / `index_name` 確認 |
| remote なのに診断データなし | remote へ migrate/seed していない | 手順 9 → 11 |

---

## 作成される Cloudflare リソース一覧

| リソース | 名前（既定） | 用途 |
|----------|--------------|------|
| Workers（CLI / 本番） | `rag` | `wrangler deploy` 時の API 本体。本番 URL `https://rag.watchkarte.workers.dev` |
| Workers（Git 連携・手順 3） | `rag` | Create application 時。workers.dev 有効化用 |
| workers.dev サブドメイン | `watchkarte.workers.dev` | remote dev / 公開 URL の親ドメイン |
| D1 | `clock-diagnosis-db` | 診断メタデータ |
| Vectorize | `clock-diagnosis-index` | 埋め込み検索（1024 次元 / cosine） |
| Workers AI | `@cf/baai/bge-m3` | 埋め込み生成 |
| Secret | `GROQ_API_KEY` | LLM（Groq） |

---

## 次にやること（まとめコマンド）

アカウント作成後、最短での通し手順:

```bash
npm install
npx wrangler login

# 1) 必須: Workers & Pages → Create application → GitHub 連携
#    Domains で Production/Preview の workers.dev を ON
#    例: rag.watchkarte.workers.dev

npx wrangler d1 create clock-diagnosis-db
# → 表示された database_id を wrangler.toml と .env に反映

npx wrangler vectorize create clock-diagnosis-index --dimensions=1024 --metric=cosine

# .env に CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / D1_DATABASE_ID を設定
# .dev.vars に GROQ_API_KEY のみ設定（推奨）

npm run db:migrate:remote
npm run seed

npm run dev   # = npx wrangler dev --remote（素の wrangler コマンドは使わない）
# 動作確認後
npx wrangler deploy
npx wrangler secret put GROQ_API_KEY
```
