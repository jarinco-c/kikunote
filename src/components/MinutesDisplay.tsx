"use client";

import { useState } from "react";

type MinutesDisplayProps = {
  content: string;
  transcript?: string;
  onReset: () => void;
  onBack?: () => void;
  onGenerateSpec?: () => void;
};

type Tab = "minutes" | "transcript";

export default function MinutesDisplay({ content, transcript, onReset, onBack, onGenerateSpec }: MinutesDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("minutes");

  const displayContent = activeTab === "transcript" && transcript ? transcript : content;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // フォールバック（モバイルブラウザ用）
      const textarea = document.createElement("textarea");
      textarea.value = displayContent;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const suffix = activeTab === "transcript" ? "文字起こし" : "議事録";
    const blob = new Blob([displayContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${suffix}_${dateStr}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <div className="space-y-4">
      {/* タブ切り替え（文字起こしがある場合のみ表示） */}
      {transcript && (
        <div className="flex rounded-lg bg-slate-800 p-1">
          <button
            onClick={() => { setActiveTab("minutes"); setCopied(false); }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "minutes"
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-slate-300"
            }`}
          >
            議事録
          </button>
          <button
            onClick={() => { setActiveTab("transcript"); setCopied(false); }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "transcript"
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-slate-300"
            }`}
          >
            文字起こし
          </button>
        </div>
      )}

      {/* アクションボタン */}
      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors"
        >
          {copied ? "コピーしました!" : "コピー"}
        </button>
        <button
          onClick={handleDownload}
          className="flex-1 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium transition-colors"
        >
          ダウンロード
        </button>
      </div>

      {/* コンテンツ表示 */}
      <div className="bg-slate-800 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
        {displayContent}
      </div>

      {/* この音声から再生成 */}
      {onBack && (
        <button
          onClick={onBack}
          className="w-full py-3 rounded-lg bg-slate-700 hover:bg-slate-600 font-medium transition-colors"
        >
          この音声から再生成
        </button>
      )}

      {/* 文字起こしから仕様書を生成（履歴閲覧時のみ） */}
      {onGenerateSpec && transcript && (
        <button
          onClick={onGenerateSpec}
          className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-medium transition-colors"
        >
          この文字起こしから仕様書を生成
        </button>
      )}

      {/* 新しい録音を開始 */}
      <button
        onClick={onReset}
        className="w-full py-3 rounded-lg bg-slate-700 hover:bg-slate-600 font-medium transition-colors"
      >
        新しい録音を開始
      </button>
    </div>
  );
}
