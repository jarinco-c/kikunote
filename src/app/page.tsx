"use client";

import { useState, useCallback } from "react";
import LoginForm from "@/components/LoginForm";
import Recorder from "@/components/Recorder";
import MinutesDisplay from "@/components/MinutesDisplay";
import History, { saveToHistory, type HistoryEntry } from "@/components/History";

type AppState = "login" | "ready" | "processing" | "done" | "history" | "viewing";

export default function Home() {
  const [state, setState] = useState<AppState>("login");
  const [password, setPassword] = useState("");
  const [minutes, setMinutes] = useState("");
  const [progress, setProgress] = useState("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const handleLogin = (pw: string) => {
    setPassword(pw);
    setState("ready");
  };

  const handleAudioReady = useCallback((blob: Blob) => {
    setAudioBlob(blob);
  }, []);

  const handleFileSelected = useCallback((file: File) => {
    setAudioBlob(file);
  }, []);

  const generateMinutes = async () => {
    if (!audioBlob) return;

    setState("processing");
    setMinutes("");
    setProgress("音声をアップロード中...");

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob);

      setProgress("AIが音声を分析中...");

      const res = await fetch("/api/generate-minutes", {
        method: "POST",
        headers: { "x-app-password": password },
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `エラー: ${res.status}`);
      }

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

      // Save to history automatically
      saveToHistory(fullText);

      setState("done");
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "エラーが発生しました";
      setProgress("");
      setMinutes("");
      alert(`議事録の生成に失敗しました: ${message}`);
      setState("ready");
    }
  };

  const handleReset = () => {
    setAudioBlob(null);
    setMinutes("");
    setProgress("");
    setState("ready");
  };

  const handleViewHistory = (entry: HistoryEntry) => {
    setMinutes(entry.content);
    setState("viewing");
  };

  if (state === "login") {
    return <LoginForm onLogin={handleLogin} />;
  }

  return (
    <div className="max-w-lg mx-auto p-4 pb-8">
      <header className="text-center py-4 mb-4">
        <h1 className="text-xl font-bold">会議議事録AI</h1>
      </header>

      {/* Ready state: show recorder */}
      {state === "ready" && (
        <div className="space-y-6">
          <Recorder
            onRecordingComplete={handleAudioReady}
            onFileSelected={handleFileSelected}
            disabled={false}
          />

          {audioBlob && (
            <div className="space-y-3">
              <div className="text-center text-sm text-slate-400">
                音声データ準備完了（{(audioBlob.size / 1024 / 1024).toFixed(1)} MB）
              </div>

              {audioBlob.size > 4 * 1024 * 1024 && (
                <div className="text-center text-xs text-yellow-400 bg-yellow-400/10 rounded-lg p-2">
                  ファイルサイズが大きいため、処理に時間がかかる場合があります
                </div>
              )}

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
        <History onSelect={handleViewHistory} onBack={() => setState("ready")} />
      )}

      {/* Viewing a past entry */}
      {state === "viewing" && (
        <MinutesDisplay content={minutes} onReset={() => setState("history")} />
      )}
    </div>
  );
}
