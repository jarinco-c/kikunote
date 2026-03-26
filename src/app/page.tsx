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
  const [audioSegments, setAudioSegments] = useState<Blob[]>([]);
  const [recordedAt, setRecordedAt] = useState<string>("");

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
    (segments: Blob[], startedAt: string) => {
      setAudioSegments(segments);
      setRecordedAt(startedAt);
    },
    []
  );

  const handleFileSelected = useCallback((file: File) => {
    setAudioSegments([file]);
    setRecordedAt("");
  }, []);

  const transcribeSegment = async (
    blob: Blob,
    index: number,
    total: number
  ): Promise<string> => {
    const formData = new FormData();
    formData.append("audio", blob);
    formData.append("segmentIndex", String(index + 1));
    formData.append("totalSegments", String(total));

    const res = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `セグメント${index + 1}の文字起こしに失敗: ${errorText}`
      );
    }

    const data = await res.json();
    return data.transcript;
  };

  const generateFromAudio = async (blob: Blob) => {
    const formData = new FormData();
    formData.append("audio", blob);
    if (recordedAt) formData.append("recordedAt", recordedAt);

    const res = await fetch("/api/generate-minutes", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || `エラー: ${res.status}`);
    }
    return res;
  };

  const generateFromTranscript = async (transcript: string) => {
    const res = await fetch("/api/generate-minutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transcript, recordedAt }),
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

  const generateMinutes = async () => {
    if (audioSegments.length === 0) return;

    setState("processing");
    setMinutes("");

    try {
      let fullText: string;

      if (
        audioSegments.length === 1 &&
        audioSegments[0].size <= 3.5 * 1024 * 1024
      ) {
        setProgress("AIが音声を分析中...");
        const res = await generateFromAudio(audioSegments[0]);
        fullText = await readStream(res);
      } else {
        const transcripts: string[] = [];
        const total = audioSegments.length;

        for (let i = 0; i < total; i++) {
          setProgress(`音声を文字起こし中... (${i + 1}/${total})`);
          const transcript = await transcribeSegment(
            audioSegments[i],
            i,
            total
          );
          transcripts.push(
            `--- セグメント ${i + 1}/${total} ---\n${transcript}`
          );
        }

        const combinedTranscript = transcripts.join("\n\n");

        setProgress("議事録を生成中...");
        const res = await generateFromTranscript(combinedTranscript);
        fullText = await readStream(res);
      }

      await saveToServer(fullText);
      setState("done");
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error ? err.message : "エラーが発生しました";
      setProgress("");
      setMinutes("");
      alert(`議事録の生成に失敗しました: ${message}`);
      setState("ready");
    }
  };

  const handleReset = () => {
    setAudioSegments([]);
    setRecordedAt("");
    setMinutes("");
    setProgress("");
    setState("ready");
  };

  const handleViewHistory = (entry: HistoryEntry) => {
    setMinutes(entry.content);
    setState("viewing");
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

  const totalSize = audioSegments.reduce((sum, s) => sum + s.size, 0);

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

          {audioSegments.length > 0 && (
            <div className="space-y-3">
              <div className="text-center text-sm text-slate-400">
                音声データ準備完了（{(totalSize / 1024 / 1024).toFixed(1)} MB
                {audioSegments.length > 1 &&
                  ` / ${audioSegments.length}セグメント`}
                ）
              </div>

              <button
                onClick={generateMinutes}
                className="w-full py-4 rounded-lg bg-green-600 hover:bg-green-500 font-bold text-lg transition-colors shadow-lg shadow-green-600/20"
              >
                議事録を生成する
              </button>
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
        <MinutesDisplay content={minutes} onReset={handleReset} />
      )}

      {/* History list */}
      {state === "history" && (
        <History
          onSelect={handleViewHistory}
          onBack={() => setState("ready")}
        />
      )}

      {/* Viewing a past entry */}
      {state === "viewing" && (
        <MinutesDisplay
          content={minutes}
          onReset={() => setState("history")}
        />
      )}

      {/* Admin panel */}
      {state === "admin" && (
        <AdminPanel onBack={() => setState("ready")} />
      )}
    </div>
  );
}
