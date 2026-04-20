"use client";

import { useState, useCallback, useEffect } from "react";
import LoginForm from "@/components/LoginForm";
import Recorder from "@/components/Recorder";
import MinutesDisplay from "@/components/MinutesDisplay";
import History, {
  saveToServer,
  getLegacyHistory,
  clearLegacyHistory,
  type HistoryEntry,
} from "@/components/History";
import AdminPanel from "@/components/AdminPanel";

type AppState =
  | "loading"
  | "login"
  | "ready"
  | "processing"
  | "done"
  | "history"
  | "viewing"
  | "admin";

export default function Home() {
  const [state, setState] = useState<AppState>("loading");
  const [userId, setUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [progress, setProgress] = useState("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordedAt, setRecordedAt] = useState<string>("");
  const [lastTranscript, setLastTranscript] = useState<string>("");
  const [viewingEntry, setViewingEntry] = useState<HistoryEntry | null>(null);

  // Check existing session on mount
  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const res = await fetch("/api/auth");
      if (res.ok) {
        const data = await res.json();
        setUserId(data.userId);
        setIsAdmin(data.isAdmin || false);
        setState("ready");
        checkLegacyMigration();
      } else {
        setState("login");
      }
    } catch {
      setState("login");
    }
  };

  const checkLegacyMigration = () => {
    const legacy = getLegacyHistory();
    if (legacy.length === 0) return;

    const doMigrate = confirm(
      `端末に保存された議事録が ${legacy.length} 件あります。サーバーに移行しますか？`
    );
    if (doMigrate) {
      migrateLegacyData(legacy);
    }
  };

  const migrateLegacyData = async (
    legacy: { content: string; createdAt: string; title: string }[]
  ) => {
    try {
      for (const entry of legacy) {
        await fetch("/api/minutes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: entry.content,
            title: entry.title,
            createdAt: entry.createdAt,
          }),
        });
      }
      clearLegacyHistory();
      alert("移行が完了しました");
    } catch {
      alert("移行中にエラーが発生しました。次回ログイン時に再試行します。");
    }
  };

  const handleLogin = (loginUserId: string, loginIsAdmin?: boolean) => {
    setUserId(loginUserId);
    setIsAdmin(loginIsAdmin || false);
    setState("ready");
    checkLegacyMigration();
  };

  const handleLogout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    setUserId("");
    setState("login");
  };

  const handleRecordingComplete = useCallback(
    (blob: Blob, startedAt: string) => {
      setAudioBlob(blob);
      setRecordedAt(startedAt);
    },
    []
  );

  const handleFileSelected = useCallback((file: File) => {
    setAudioBlob(file);
    setRecordedAt("");
  }, []);

  // 音声を文字起こしする（Gemini Files API経由、NDJSONストリーム）
  // サーバから progress メッセージが定期的に流れてくるので、
  // iOS Safari が idle な fetch を drop するのを防ぐ
  const transcribe = async (blob: Blob): Promise<string> => {
    setProgress("音声をアップロード中...");
    const formData = new FormData();
    formData.append("audio", blob);

    const res = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });

    if (!res.ok || !res.body) {
      const errorText = await res.text().catch(() => "");
      throw new Error(errorText || `エラー: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let transcript = "";
    let errorMessage: string | null = null;
    let sawDone = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // プロキシ経由の CRLF にも耐えるため \r?\n で split
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as
            | { type: "progress"; stage: string; elapsed?: number }
            | { type: "transcript"; text: string }
            | { type: "done" }
            | { type: "error"; message: string };

          if (msg.type === "progress") {
            if (msg.stage === "uploading") {
              setProgress("Geminiにアップロード中...");
            } else if (msg.stage === "processing") {
              setProgress(`Gemini処理中... ${msg.elapsed ?? 0}秒経過`);
            } else if (msg.stage === "transcribing") {
              setProgress("文字起こし生成中...");
            }
          } else if (msg.type === "transcript") {
            transcript += msg.text;
          } else if (msg.type === "error") {
            errorMessage = msg.message;
          } else if (msg.type === "done") {
            sawDone = true;
          }
        } catch (err) {
          // パース失敗した行はログのみ出して続行
          console.warn("NDJSON行のパース失敗:", line.slice(0, 100), err);
        }
      }
    }

    if (errorMessage) throw new Error(errorMessage);
    if (!sawDone) throw new Error("文字起こしが途中で切断されました");
    return transcript;
  };

  const generateFromTranscript = async (
    transcript: string,
    outputType: string = "minutes",
    overrideRecordedAt?: string
  ) => {
    const res = await fetch("/api/generate-minutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcript,
        recordedAt: overrideRecordedAt ?? recordedAt,
        outputType,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || `エラー: ${res.status}`);
    }
    return res;
  };

  const readStream = async (res: Response) => {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("ストリームを読み取れません");

    const decoder = new TextDecoder();
    let fullText = "";

    setProgress("");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      setMinutes(fullText);
    }

    return fullText;
  };

  const typeLabel = (t: string) => (t === "spec" ? "仕様書" : "議事録");

  // 文字起こしから1種類を生成
  const generateOne = async (
    outputType: string,
    transcript: string,
    overrideRecordedAt?: string
  ): Promise<string> => {
    setProgress(`${typeLabel(outputType)}を生成中...`);
    const res = await generateFromTranscript(transcript, outputType, overrideRecordedAt);
    return await readStream(res);
  };

  const generate = async (mode: "minutes" | "spec" | "both") => {
    if (!audioBlob) return;

    setState("processing");
    setMinutes("");

    try {
      // まず文字起こしを取得（タブ表示＆再利用のため）
      const transcript = await transcribe(audioBlob);
      setLastTranscript(transcript);

      if (mode === "both") {
        // 議事録を生成
        const minutesText = await generateOne("minutes", transcript);
        await saveToServer(minutesText, transcript);

        // 仕様書を生成
        setMinutes("");
        const specText = await generateOne("spec", transcript);
        await saveToServer(specText, transcript);

        // 両方の結果を表示
        setMinutes(minutesText + "\n\n---\n\n" + specText);
      } else {
        const fullText = await generateOne(mode, transcript);
        await saveToServer(fullText, transcript);
      }

      setState("done");
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error ? err.message : "エラーが発生しました";
      setProgress("");
      setMinutes("");
      alert(`生成に失敗しました: ${message}`);
      setState("ready");
    }
  };

  const handleReset = () => {
    setAudioBlob(null);
    setRecordedAt("");
    setMinutes("");
    setProgress("");
    setLastTranscript("");
    setViewingEntry(null);
    setState("ready");
  };

  const handleViewHistory = (entry: HistoryEntry) => {
    setMinutes(entry.content);
    setViewingEntry(entry);
    setState("viewing");
  };

  // ISO日時を録音時と同じ「YYYY年M月D日 HH:MM」形式に変換
  const formatRecordedAt = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  // 履歴閲覧中のエントリの文字起こしから仕様書を生成（新しい履歴エントリとして保存）
  const handleGenerateSpecFromHistory = async () => {
    if (!viewingEntry?.transcript) return;

    const transcript = viewingEntry.transcript;
    const overrideRecordedAt = formatRecordedAt(viewingEntry.created_at);

    setLastTranscript(transcript);
    setMinutes("");
    setProgress("");
    setState("processing");

    try {
      const specText = await generateOne("spec", transcript, overrideRecordedAt);
      await saveToServer(specText, transcript);
      setViewingEntry(null);
      setState("done");
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error ? err.message : "エラーが発生しました";
      setProgress("");
      setMinutes("");
      alert(`生成に失敗しました: ${message}`);
      setState("viewing");
    }
  };

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state === "login") {
    return <LoginForm onLogin={handleLogin} />;
  }

  return (
    <div className="max-w-lg mx-auto p-4 pb-8">
      <header className="text-center py-4 mb-4">
        <h1 className="text-xl font-bold">きくノート</h1>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className="text-xs text-slate-400">{userId}</span>
          <button
            onClick={handleLogout}
            className="text-xs text-slate-500 hover:text-slate-300 underline transition-colors"
          >
            ログアウト
          </button>
        </div>
      </header>

      {/* Ready state: show recorder */}
      {state === "ready" && (
        <div className="space-y-6">
          <Recorder
            onRecordingComplete={handleRecordingComplete}
            onFileSelected={handleFileSelected}
            disabled={false}
          />

          {audioBlob && (
            <div className="space-y-3">
              <div className="text-center text-sm text-slate-400">
                音声データ準備完了（{(audioBlob.size / 1024 / 1024).toFixed(1)} MB）
              </div>

              <div className="space-y-2">
                <button
                  onClick={() => generate("minutes")}
                  className="w-full py-4 rounded-lg bg-green-600 hover:bg-green-500 font-bold text-lg transition-colors shadow-lg shadow-green-600/20"
                >
                  議事録を生成する
                </button>
                <button
                  onClick={() => generate("spec")}
                  className="w-full py-4 rounded-lg bg-purple-600 hover:bg-purple-500 font-bold text-lg transition-colors shadow-lg shadow-purple-600/20"
                >
                  仕様書を生成する
                </button>
                <button
                  onClick={() => generate("both")}
                  className="w-full py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm transition-colors"
                >
                  両方を生成する
                </button>
              </div>

              {/* デバッグ用：録音データダウンロード（管理者のみ表示） */}
              {isAdmin && (
                <div className="border border-slate-700 rounded-lg p-3 space-y-2">
                  <div className="text-xs text-slate-500">
                    録音データの確認（デバッグ用）
                  </div>
                  {(() => {
                    const ext = audioBlob.type.includes("mp4") ? "m4a"
                              : audioBlob.type.includes("webm") ? "webm"
                              : "bin";
                    return (
                      <button
                        onClick={() => {
                          const url = URL.createObjectURL(audioBlob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `recording.${ext}`;
                          a.click();
                          // ブラウザがダウンロードを開始するまで待ってから解放
                          setTimeout(() => URL.revokeObjectURL(url), 10000);
                        }}
                        className="w-full py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-400 transition-colors"
                      >
                        録音データをダウンロード（{(audioBlob.size / 1024).toFixed(0)} KB / {audioBlob.type}）
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* History button */}
          <button
            onClick={() => setState("history")}
            className="w-full py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 transition-colors"
          >
            過去の議事録を見る
          </button>

          {/* Admin button */}
          {isAdmin && (
            <button
              onClick={() => setState("admin")}
              className="w-full py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 transition-colors"
            >
              ユーザー管理
            </button>
          )}
        </div>
      )}

      {/* Processing state */}
      {state === "processing" && (
        <div className="space-y-4">
          {progress && (
            <div className="text-center">
              <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-slate-300">{progress}</p>
            </div>
          )}
          {minutes && (
            <div className="bg-slate-800 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
              {minutes}
              <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-0.5" />
            </div>
          )}
        </div>
      )}

      {/* Done state */}
      {state === "done" && (
        <MinutesDisplay
          content={minutes}
          transcript={lastTranscript || undefined}
          onReset={handleReset}
          onBack={audioBlob ? () => {
            setMinutes("");
            setProgress("");
            setState("ready");
          } : undefined}
        />
      )}

      {/* History list */}
      {state === "history" && (
        <History
          onSelect={handleViewHistory}
          onBack={() => setState("ready")}
        />
      )}

      {/* Viewing a past entry */}
      {state === "viewing" && viewingEntry && (
        <MinutesDisplay
          content={viewingEntry.content}
          transcript={viewingEntry.transcript || undefined}
          onReset={() => {
            setViewingEntry(null);
            setState("history");
          }}
          onGenerateSpec={
            viewingEntry.transcript ? handleGenerateSpecFromHistory : undefined
          }
        />
      )}

      {/* Admin panel */}
      {state === "admin" && (
        <AdminPanel onBack={() => setState("ready")} />
      )}
    </div>
  );
}
