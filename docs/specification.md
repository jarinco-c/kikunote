# きくノート - 仕様書

## 概要

「きくノート」は、スマホから会議を録音し、AIが自動で議事録を生成するPWA（Progressive Web App）。
録音 → 文字起こし → 話者分離 → 議事録整形をワンストップで完結する。

## 技術スタック

| 項目 | 技術 |
|---|---|
| フレームワーク | Next.js 15 (App Router) |
| 言語 | TypeScript |
| スタイリング | Tailwind CSS |
| AI API | Google Gemini 2.5 Flash（音声処理＋議事録生成） |
| ホスティング | Vercel（無料プラン） |
| PWA | Service Worker + Web App Manifest |

## アーキテクチャ

```
┌─────────────────────────────┐
│  スマホ / PC ブラウザ (PWA)   │
│  - 録音 (MediaRecorder API)  │
│  - 音声ファイルアップロード     │
└──────────┬──────────────────┘
           │ FormData (音声)
           ▼
┌─────────────────────────────┐
│  Vercel Serverless Function      │
│  /api/transcribe (セグメント単位) │
│  /api/generate-minutes (整形)    │
│  - 認証チェック                   │
│  - 音声をbase64変換               │
│  - Gemini APIにストリーミング送信  │
└──────────┬──────────────────┘
           │ ストリーミング応答
           ▼
┌─────────────────────────────┐
│  Google Gemini 2.5 Flash     │
│  - 音声認識（文字起こし）       │
│  - 話者分離（声の識別）         │
│  - 議事録テンプレートで整形     │
└─────────────────────────────┘
```

## 画面遷移

1. **ログイン画面** → パスワード入力
2. **録音画面** → 録音ボタン or ファイルアップロード / 「過去の議事録を見る」
3. **処理中画面** → ストリーミングで議事録がリアルタイム表示
4. **完成画面** → コピー / ダウンロード / 新規録音（自動で履歴に保存）
5. **履歴画面** → 過去の議事録一覧 → 選択して閲覧・コピー・削除

## API仕様

### POST /api/auth

パスワード認証。

- Request: `{ "password": "string" }`
- Response 200: `{ "ok": true }`
- Response 401: `{ "error": "Unauthorized" }`

### POST /api/transcribe

音声セグメントを文字起こし（長時間録音時に使用）。

- Header: `x-app-password: string`
- Body: `FormData` with `audio` field, optional `segmentIndex` / `totalSegments`
- Response: `{ "transcript": "string" }`

### POST /api/generate-minutes

議事録を生成。2つのモードに対応。ストリーミングレスポンス。

**モード1: 音声から直接（短い録音向け）**
- Header: `x-app-password: string`
- Body: `FormData` with `audio` field, optional `recordedAt`
- Response: `text/plain` (streaming)

**モード2: 文字起こしテキストから（長時間録音向け）**
- Header: `x-app-password: string`, `Content-Type: application/json`
- Body: `{ "transcript": "string", "recordedAt": "string" }`
- Response: `text/plain` (streaming)

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
| `APP_PASSWORD` | ログインパスワード | 任意の文字列を設定 |

## 制約事項

- **1セグメントあたりの上限**: Vercel無料プランのペイロード上限は4.5MB（約18分相当）。10分ごとに自動分割するため通常問題なし
- **録音時間**: 自動セグメント分割により1時間以上の会議に対応
- **処理時間**: Vercel無料プランのFunction実行時間は10秒だが、ストリーミングにより長い音声も処理可能
- **話者分離精度**: Geminiの音声認識に依存。はっきり話す場合に精度が高い
- **対応音声形式**: WebM/Opus（ブラウザ録音）、MP3、WAV、M4A等

## デプロイ手順

1. GitHubにリポジトリを作成してpush
2. [Vercel](https://vercel.com) にGitHubでログイン
3. 「Import Project」でリポジトリを選択
4. 環境変数に `GEMINI_API_KEY` と `APP_PASSWORD` を設定
5. 「Deploy」ボタンを押す
6. 発行されたURL（`https://xxx.vercel.app`）にスマホでアクセス
7. ホーム画面に追加すればアプリとして使える

## 実装済み追加機能

- **履歴機能**: 議事録生成後にlocalStorageへ自動保存（最大50件）。一覧表示・閲覧・削除が可能
- **録音時刻の自動記録**: 録音開始時のローカル時刻（日本時間）を議事録の日時欄に自動反映
- **長時間録音**: 10分ごとに自動セグメント分割。各セグメントを順次文字起こし→結合→議事録整形

## 今後の拡張候補

- 議事録の履歴をサーバー側に保存（Supabase等。どの端末からも閲覧可能に）
- PDF出力
- 議事録テンプレートのカスタマイズ
- リアルタイム文字起こし表示
