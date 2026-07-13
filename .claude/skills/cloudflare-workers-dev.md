# Cloudflare Workers 開発

## ローカル開発

Vectorize は local モード非対応のため、`npm run dev`（内部は `wrangler dev --remote`）を使う。

```bash
npm run dev
```

## 前提条件

- `wrangler login` 済み
- workers.dev サブドメイン登録済み
- `.dev.vars` に `GROQ_API_KEY` が設定されている

## よくあるエラー

### `edge-preview` エラー

workers.dev サブドメインが未登録。Cloudflare ダッシュボードでサブドメインを登録する。

### `コマンドが見つかりません`

`wrangler` がグローバルにインストールされていない。`npx wrangler` を使うか、`npm run` 経由で実行する。

## リソース作成コマンド

```bash
npx wrangler d1 create clock-diagnosis-db
npx wrangler vectorize create clock-diagnosis-index --dimensions=1024 --metric=cosine
```

## マイグレーション

```bash
npm run db:migrate:remote
```

## シークレット設定

```bash
npx wrangler secret put GROQ_API_KEY
```

## ログ確認

```bash
npx wrangler tail
```

## 注意

- `npm run seed` は本番 Vectorize インデックスをクリアする
- D1 のローカルモードとリモートモードでデータが分離していることに注意
