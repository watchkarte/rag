# 評価を実行する

`tests/eval.json` を使って Recall@3 と Accuracy@1 を計測します。

## 前提

- `npm run dev` でローカルサーバーが起動していること
- `.dev.vars` に `GROQ_API_KEY` が設定されていること

## コマンド

```bash
npm run eval
```

## リリース基準

- Recall@3 ≥ 70%
- Accuracy@1 ≥ 60%

## 改善が必要な場合

- `tests/eval.json` のクエリが実ユーザーの言い回しを反映しているか確認
- `src/data/seed.json` の symptom / description を追加・修正
- seed 後に再評価
