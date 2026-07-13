# WatchKarte RAG パイプライン

## 目的

クォーツアナログ時計の症状テキストから、最も可能性の高い故障部品を推定する。

## 入力

```json
{ "symptom": "秒針が5秒おきに飛んで止まる" }
```

## 出力

```json
{
  "part": "電池",
  "confidence": 0.92,
  "reason": "秒針が5秒間隔で飛ぶ動きは、電池電圧低下時のIC省電力モードの典型症状です。",
  "nextAction": "電池を新品に交換してください。"
}
```

## 処理ステップ

1. **バリデーション**: `symptom` が文字列であることを確認。無効なら 400。
2. **埋め込み生成**: Workers AI `@cf/baai/bge-m3` で 1024 次元ベクトルを生成。
3. **ベクトル検索**: Cloudflare Vectorize で Top-K=3 検索。
4. **メタデータ取得**: 検索結果の ID で D1 `diagnoses` テーブルから行を取得。
5. **confidence 計算**: Top-1 のコサイン類似度スコアを `[0,1]` に正規化。
6. **フォールバック判定**: `confidence < 0.6` または 0 件なら LLM を呼ばずフォールバック応答。
7. **LLM 生成**: Groq `llama-3.1-8b-instant` JSON mode で `part` / `reason` / `nextAction` を生成。
8. **応答**: `confidence` と LLM 出力を合体して返す。

## 埋め込みテキスト形式

```
症状: {symptom}
部品: {part}
説明: {description}
```

## 主要ファイル

| ファイル | 責務 |
|---------|------|
| `src/routes/diagnose.ts` | エンドポイント実装 |
| `src/services/embedding.ts` | 埋め込み生成 |
| `src/services/vectorize.ts` | ベクトル検索 |
| `src/services/database.ts` | D1 からメタデータ取得 |
| `src/services/llm.ts` | Groq API 呼び出し |
| `src/types.ts` | 定数・型定義 |

## 変更時の注意

- `seed.json` を変更したら `npm run seed` を実行して Vectorize を再構築すること
- `confidence` の計算ロジックを変える場合、`src/types.ts` の `CONFIDENCE_THRESHOLD` も見直すこと
- LLM プロンプトを変える場合は `src/services/llm.ts` を修正し、`npm run eval` で評価すること
