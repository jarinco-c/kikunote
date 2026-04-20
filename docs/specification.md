# きくノート - 仕様書

## 概要

「きくノート」は、スマホから会議を録音し、AIが自動で議事録を生成するPWA（Progressive Web App）。
録音 → 文字起こし → 話者分離 → 議事録整形をワンストップで完結する。
マルチユーザー対応で、どの端末からでも同じ議事録にアクセス可能。

## 技術スタック

| 項目 | 技術 |
|---|---|
| フレームワーク | Next.js 15 (App Router) |
| 言語 | TypeScript |
| スタイリング | Tailwind CSS |
| AI API | Google Gemini 2.5 Flash（Files API経由で音声処理、テキストストリームで議事録生成） |
| データベース | Supabase（PostgreSQL） |
| 認証 | JWT + httpOnly Cookie |
| ホスティング | Render（無料プラン、Nodeランタイム） |
| PWA | Service Worker + Web App Manifest |

## アーキテクチャ

```
┌─────────────────────────────┐
│  スマホ / PC ブラウザ (PWA)   │
│  - 録音 (MediaRecorder API)  │
│  - 単一Blob連続録音           │
│  - 録音中10分毎に /api/ping   │
│  - JWT Cookie で認証          │
└──────────┬──────────────────┘
           │ FormData (audio) / JSON (transcript)
           ▼
┌─────────────────────────────────────┐
│  Render Web Service (Node, 常時稼働) │
│  /api/auth             (認証)        │
│  /api/transcribe       (文字起こし)   │
│  /api/generate-minutes (整形・ストリーム)│
│  /api/minutes          (CRUD)        │
│  /api/ping             (キープアライブ)│
│  - JWT Cookie 検証                   │
│  - Supabase DB 読み書き              │
│  - Gemini Files API 経由で音声処理    │
└──────────┬──────────────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌──────────┐ ┌────────────────────┐
│ Supabase │ │ Gemini 2.5 Flash   │
│ (DB)     │ │ - Files API (音声)  │
│ - users  │ │ - generateContent   │
│ - minutes│ │ - streaming text   │
└──────────┘ └────────────────────┘
```

### 処理フロー（録音 → 議事録）

1. クライアントが単一Blobで録音（セグメント分割なし）
2. クライアントが `/api/transcribe` に音声をPOST
3. サーバーが `/tmp` に一時保存 → Gemini Files API にアップロード
4. ファイルが `ACTIVE` になるまでポーリング（2秒間隔、最大15分）
5. `generateContentStream` で文字起こし（fileDataリファレンス使用）
6. **NDJSON ストリーム**で進捗と文字起こしチャンクをクライアントへ逐次返却。一時ファイルとGemini側ファイルを finally で削除（クライアント切断時も cancel ハンドラで cleanup）
7. クライアントが `/api/generate-minutes` にtranscriptをPOST
8. サーバーが `generateContentStream` でストリーム返却
9. クライアントが逐次表示 → 完了後にSupabaseへ保存

### /api/transcribe のストリーム仕様（NDJSON）

iOS Safari が長時間 idle な fetch を drop する問題を避けるため、処理中は定期的に進捗メッセージをストリーム送信する。1行1 JSON の NDJSON 形式:

- `{type:"progress", stage:"uploading"}`
- `{type:"progress", stage:"processing", elapsed:<秒>}`
- `{type:"progress", stage:"transcribing"}`
- `{type:"transcript", text:"<文字起こしチャンク>"}`（複数）
- `{type:"done"}` or `{type:"error", message}`

## 画面遷移

1. **ログイン画面** → ユーザーID + パスワード入力
2. **録音画面** → 録音ボタン or ファイルアップロード / 「過去の議事録を見る」 / ログアウト
3. **処理中画面** → ストリーミングで議事録がリアルタイム表示
4. **完成画面** → コピー / ダウンロード / 新規録音（自動でサーバーに保存）
5. **履歴画面** → 過去の議事録一覧 → 選択して閲覧・コピー・削除

## 認証

- ユーザーID + パスワードによるログイン
- パスワードはbcryptでハッシュ化してDBに保存
- ログイン成功時にJWTを発行し、httpOnly Cookieにセット（7日間有効）
- ページリロード時に自動ログインチェック（GET /api/auth）
- ユーザー作成は管理者がCLIスクリプトで実行

### ユーザー作成方法

```bash
npx tsx src/scripts/create-user.ts <ユーザーID> <パスワード> [表示名]
```

### パスワードリセット方法

```bash
npx tsx src/scripts/reset-password.ts <ユーザーID> <新しいパスワード>
```

既存ユーザーの password_hash のみを更新する。管理者パスワードを忘れた時や、運用中のリセットに使う。

※ どちらのスクリプトも `.env.local` に `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` が設定されている必要あり

## DBスキーマ（Supabase）

### users テーブル

| カラム | 型 | 説明 |
|---|---|---|
| id | UUID (PK) | 自動生成 |
| user_id | TEXT (UNIQUE) | ログインID |
| password_hash | TEXT | bcryptハッシュ |
| display_name | TEXT | 表示名 |
| is_admin | BOOLEAN | 管理者フラグ |
| created_at | TIMESTAMPTZ | 作成日時 |

### minutes テーブル

| カラム | 型 | 説明 |
|---|---|---|
| id | UUID (PK) | 自動生成 |
| user_id | UUID (FK → users.id) | 所有ユーザー |
| title | TEXT | 議事録タイトル（自動抽出） |
| content | TEXT | 議事録本文 |
| transcript | TEXT | 文字起こし原文（nullable） |
| created_at | TIMESTAMPTZ | 作成日時 |

## API仕様

### POST /api/auth — ログイン

- Request: `{ "userId": "string", "password": "string" }`
- Response 200: `{ "ok": true, "userId": "string", "displayName": "string" }` + Set-Cookie
- Response 401: `{ "error": "ユーザーIDまたはパスワードが違います" }`

### GET /api/auth — セッション確認

- Cookie: session JWT
- Response 200: `{ "ok": true, "userId": "string", "displayName": "string" }`
- Response 401: `{ "ok": false }`

### DELETE /api/auth — ログアウト

- Response 200: `{ "ok": true }` + Cookie削除

### POST /api/transcribe — 文字起こし

- Cookie: session JWT（認証）
- Body: `FormData` with `audio` field（単一Blob、セグメント分割なし）
- サーバー側処理: Gemini Files API にアップロード → ACTIVE待機 → generateContent → ファイル削除
- Response: `{ "transcript": "string" }`

### POST /api/generate-minutes — 議事録生成

- Cookie: session JWT
- Content-Type: `application/json`
- Body: `{ "transcript": "string", "recordedAt?": "string", "outputType?": "minutes" | "spec" }`
- Response: `text/plain` (streaming)

`outputType`: `"minutes"`（議事録、デフォルト）または `"spec"`（仕様書）

### GET /api/ping — キープアライブ

- 認証なし、誰でも叩ける
- Response: `"ok"` (text/plain)
- 用途: Render無料プランの15分スリープ防止。クライアントから録音中に10分間隔で叩く

### GET /api/minutes — 議事録一覧

- Cookie: session JWT
- Response: `[{ "id": "uuid", "title": "string", "content": "string", "transcript": "string|null", "created_at": "string" }]`

### POST /api/minutes — 議事録保存

- Cookie: session JWT
- Body: `{ "content": "string", "transcript?": "string", "title?": "string", "createdAt?": "string" }`
- Response 201: `{ "id": "uuid", "title": "string", "content": "string", "transcript": "string|null", "created_at": "string" }`

### DELETE /api/minutes/[id] — 議事録削除

- Cookie: session JWT
- Response: `{ "ok": true }`
- Response 404: 自分の議事録でない場合

### GET /api/admin/users — ユーザー一覧（管理者のみ）

- Cookie: session JWT（管理者ユーザー）
- Response: `[{ "id": "uuid", "user_id": "string", "display_name": "string", "is_admin": boolean, "created_at": "string" }]`
- Response 403: 管理者でない場合

### POST /api/admin/users — ユーザー作成（管理者のみ）

- Cookie: session JWT（管理者ユーザー）
- Body: `{ "userId": "string", "password": "string", "displayName?": "string" }`
- Response 201: 作成されたユーザー情報
- Response 409: ユーザーIDが重複

## 議事録テンプレート

```markdown
## 議事録

**日時**: YYYY-MM-DD
**参加者**: 話者A, 話者B, ...

### 議題
- トピック1
- トピック2

### 議論の要点
（各議題について要点と結論を簡潔に要約。発言のベタ打ちではなく要約する）

### 決定事項
- 決定1
- 決定2

### アクションアイテム
- [ ] 担当者: タスク内容（期限）

### 備考
（特記事項）
```

## 環境変数

| 変数名 | 説明 | 取得方法 |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini APIキー | [Google AI Studio](https://aistudio.google.com/apikey) で発行 |
| `SUPABASE_URL` | SupabaseプロジェクトURL | Supabaseダッシュボード > Settings > Data API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseサービスロールキー | Supabaseダッシュボード > Settings > API Keys |
| `JWT_SECRET` | JWT署名用シークレット | ランダムな32文字以上の文字列 |

## 制約事項

- **録音ファイルサイズ**: Render側のボディサイズ制限に依存（通常十分）。Gemini Files API は最大2GB / 9.5時間まで対応
- **録音時間**: 理論上9時間超まで対応。実用範囲は数時間
- **Render無料プランの制約**:
  - 15分無アクセスでスリープ → 録音中は `/api/ping` を10分毎に叩いて防止
  - 初回アクセス時にコールドスタート（30〜60秒）→ 会議開始前にアプリを開いて起こしておく運用
- **iPhone自動ロック対策**: Screen Wake Lock API で画面スリープを抑止（録音中のみ）。非対応ブラウザでは無音スキップし、iOSの自動ロック設定を手動でOffにする運用でカバー
- **Supabase Freeの制約**: 7日間アクセスがないとProjectがPaused状態になる。復旧はSupabase dashboardで「Resume project」ボタンを押す
- **話者分離精度**: Geminiの音声認識に依存
- **対応音声形式**: WebM/Opus（ブラウザ録音）、MP4/AAC、MP3、WAV、M4A等
- **DB容量**: Supabase無料プランは500MB。テキストのみなので十分

## デプロイ手順

1. GitHubにリポジトリを作成してpush
2. [Render](https://render.com) にGitHubでログイン
3. 「New +」→「Web Service」でGitHubリポジトリを選択
4. 設定:
   - Environment: Node
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Region: Singapore（日本から最寄り）
   - Instance Type: Free
   - Health Check Path: `/api/ping`
5. 環境変数 `GEMINI_API_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`JWT_SECRET` を設定
6. 「Create Web Service」でデプロイ（5〜10分）
7. 発行されたURL（`https://xxx.onrender.com`）にアクセス
8. スマホでホーム画面に追加すればPWAとして使える

※ リポジトリに `render.yaml` が含まれているため、Blueprint機能を使えば対話不要で自動設定可能

## 実装済み機能

- **マルチユーザー認証**: ユーザーID+パスワードでログイン。JWT+httpOnlyクッキーでセッション管理
- **サーバー側議事録保存**: Supabase(PostgreSQL)に保存。どの端末からでも閲覧可能
- **履歴機能**: 議事録の一覧表示・閲覧・削除
- **議事録と文字起こしのタブ切り替え**: 履歴閲覧時に「議事録」（要約）と「文字起こし」（原文）をタブで切り替え表示
- **録音時刻の自動記録**: 録音開始時のローカル時刻（日本時間）を議事録の日時欄に自動反映
- **長時間録音対応**: 単一Blob録音 + Gemini Files API経由で長時間音声を安定処理。セグメント分割は廃止済み
- **録音中のキープアライブ**: 録音開始と同時に10分間隔で `/api/ping` を叩き、Renderのスリープを防止
- **画面スリープ抑止**: 録音中に `navigator.wakeLock.request("screen")` で画面を起こし続ける。iOS Safari 通常タブでは Wake Lock だけでは不十分なため、AudioContext から無音を出力し続けるハック（NoSleep.js 同様）も併用
- **録音品質改善**: Web Audio APIでゲイン3倍増幅 + DynamicsCompressor（Android対策）。mp4(AAC)優先、128kbps
- **録音データダウンロード**: 管理者のみ、録音後に音声データをダウンロード可能（デバッグ用）
- **localStorage移行**: 旧バージョンのlocalStorageデータをサーバーに自動移行
- **管理者画面**: 管理者ユーザーのみ表示。アプリ内からユーザーの新規登録・一覧確認が可能
- **カスタムアイコン**: PWAアイコン・favicon・Appleタッチアイコンに対応
- **仕様書生成**: 文字起こしから仕様書を自動生成。議事録・仕様書・両方の3モードから選択可能
- **履歴からの仕様書生成**: 過去の議事録エントリに文字起こしがある場合、録音し直さず既存の文字起こしを再利用して仕様書を生成可能。結果は新しい履歴エントリとして保存される

## 今後の拡張候補

- PDF出力
- 議事録テンプレートのカスタマイズ
- リアルタイム文字起こし表示
