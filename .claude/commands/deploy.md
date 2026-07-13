# デプロイする

Cloudflare Workers にデプロイし、Groq API キーを Workers Secret に登録します。

## 前提

- `wrangler login` 済み
- `wrangler.toml` の `database_id` が正しく設定されていること

## コマンド

```bash
npm run deploy
npx wrangler secret put GROQ_API_KEY
```

## デプロイ後の確認

```bash
curl -s https://rag.watchkarte.workers.dev/diagnose \
  -H 'content-type: application/json' \
  -d '{"symptom":"秒針が5秒おきに飛んで止まる"}'
```
