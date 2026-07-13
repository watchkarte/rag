# 初期データを投入する

`src/data/seed.json` を D1 と Vectorize に再投入します。

## 前提

- `.env` に以下が設定されていること
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN`（D1 / Vectorize / Workers AI 権限）
  - `D1_DATABASE_ID`
  - `GROQ_API_KEY`

## コマンド

```bash
npm run seed
```

## 注意

- 本番 Vectorize インデックスをクリアして再投入します
- PoC として一時的なサービス停止を許容しています
