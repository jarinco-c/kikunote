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
| AI API | Google Gemini 2.5 Flash（音声処理＋議事録生成） |
| データベース | Supabase（PostgreSQL） |
| 認証 | JWT + httpOnly Cookie |
| ホスティング | Vercel（無料プラン） |
| PWA | Service Worker + Web App Manifest |

## アーキテクチャ

```
┌─────────────────────────────┐
│  スマホ / PC ブラウザ (PWA)   │
│  - 録音 (MediaRecorder API)  │
│  - 音声ファイルアップロード     │
│  - JWT Cookie で認証          │
└──────────┬──────────────────┘
           │ FormData (音声) / JSON
           ▼
┌─────────────────────────────┐
│  Vercel Serverless Function      │
│  /api/auth (認証)                │
│  /api/transcribe (セグメント単位) │
│  /api/generate-minutes (整形)    │
│  /api/minutes (CRUD)             │
│  - JWT Cookie 検証               │
│  - Supabase DB 読み書き          │
│  - Gemini APIにストリーミング送信  │
└──────────┬──────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌──────────┐ ┌──────────────┐
│ Supabase │ │ Gemini 2.5   │
│ (DB)     │ │ Flash (AI)   │
│ - users  │ │ - 音声認識    │
│ - minutes│ │ - 話者分離    │
└──────────┘ │ - 議事録整形  │
             └──────────────┘
```

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

※ `.env.local` に `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` が設定されている必要あり

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
- Body: `FormData` with `audio` field, optional `segmentIndex` / `totalSegments`
- Response: `{ "transcript": "string" }`

### POST /api/generate-minutes — 議事録生成

**モード1: 音声から直接（短い録音向け）**
- Cookie: session JWT
- Body: `FormData` with `audio` field, optional `recordedAt`
- Response: `text/plain` (streaming)

**モード2: 文字起こしテキストから（長時間録音向け）**
- Cookie: session JWT, `Content-Type: application/json`
- Body: `{ "transcript": "string", "recordedAt": "string", "outputType?": "minutes" | "spec" }`
- Response: `text/plain` (streaming)

`outputType` パラメータ: `"minutes"`（議事録、デフォルト）または `"spec"`（仕様書）。FormDataの場合は `outputType` フィールドで指定。

### GET /api/minutes — 議事録一覧

- Cookie: session JWT
- Response: `[{ "id": "uuid", "title": "string", "content": "string", "created_at": "string" }]`

### POST /api/minutes — 議事録保存

- Cookie: session JWT
- Body: `{ "content": "string", "title?": "string", "createdAt?": "string" }`
- Response 201: `{ "id": "uuid", "title": "string", "content": "string", "created_at": "string" }`

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

### 議論内容
（話者ごとの発言を時系列で要約）

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

- **1セグメントあたりの上限**: Vercel無料プランのペイロード上限は4.5MB（約18分相当）。10分ごとに自動分割するため通常問題なし
- **録音時間**: 自動セグメント分割により1時間以上の会議に対応
- **処理時間**: Vercel無料プランのFunction実行時間は10秒だが、ストリーミングにより長い音声も処理可能
- **話者分離精度**: Geminiの音声認識に依存。はっきり話す場合に精度が高い
- **対応音声形式**: WebM/Opus（ブラウザ録音）、MP3、WAV、M4A等
- **DB容量**: Supabase無料プランは500MB。テキストのみなので十分

## デプロイ手順

1. GitHubにリポジトリを作成してpush
2. [Vercel](https://vercel.com) にGitHubでログイン
3. 「Import Project」でリポジトリを選択
4. 環境変数に `GEMINI_API_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`JWT_SECRET` を設定
5. 「Deploy」ボタンを押す
6. 発行されたURL（`https://xxx.vercel.app`）にスマホでアクセス
7. ホーム画面に追加すればアプリとして使える

## 実装済み機能

- **マルチユーザー認証**: ユーザーID+パスワードでログイン。JWT+httpOnlyクッキーでセッション管理
- **サーバー側議事録保存**: Supabase(PostgreSQL)に保存。どの端末からでも閲覧可能
- **履歴機能**: 議事録の一覧表示・閲覧・削除
- **録音時刻の自動記録**: 録音開始時のローカル時刻（日本時間）を議事録の日時欄に自動反映
- **長時間録音**: 10分ごとに自動セグメント分割。各セグメントを順次文字起こし→結合→議事録整形
- **localStorage移行**: 旧バージョンのlocalStorageデータをサーバーに自動移行
- **管理者画面**: 管理者ユーザーのみ表示。アプリ内からユーザーの新規登録・一覧確認が可能
- **カスタムアイコン**: PWAアイコン・favicon・Appleタッチアイコンに対応
- **仕様書生成**: 音声から仕様書を自動生成。議事録・仕様書・両方の3モードから選択可能
- **再生成機能**: 生成完了後に「この音声から再生成」ボタンで録音データを保持したまま戻り、別の種類で再生成可能

## 今後の拡張候補

- PDF出力
- 議事録テンプレートのカスタマイズ
- リアルタイム文字起こし表示
