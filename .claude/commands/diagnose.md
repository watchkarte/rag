# 診断をテストする

`POST /diagnose` を curl で呼び出し、RAG パイプラインが正常に動作するか確認します。

## 前提

- `npm run dev` でローカルサーバーが起動していること
- `.dev.vars` に `GROQ_API_KEY` が設定されていること

## コマンド

```bash
curl -s http://127.0.0.1:8787/diagnose \
  -H 'content-type: application/json' \
  -d '{"symptom":"秒針が5秒おきに飛んで止まる"}'
```

## 確認ポイント

- `part` に期待する部品（例: 電池）が返るか
- `confidence` が 0.0〜1.0 の範囲か
- confidence < 0.6 の場合はフォールバック応答になるか
