"use client";

import { useState } from "react";

type MinutesDisplayProps = {
  content: string;
  onReset: () => void;
  onBack?: () => void;
};

export default function MinutesDisplay({ content, onReset, onBack }: MinutesDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for mobile browsers
      const textarea = document.createElement("textarea");
      textarea.value = content;
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
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `議事録_${dateStr}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Action buttons */}
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

      {/* Minutes content */}
      <div className="bg-slate-800 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
        {content}
      </div>

      {/* Back to generate buttons */}
      {onBack && (
        <button
          onClick={onBack}
          className="w-full py-3 rounded-lg bg-slate-700 hover:bg-slate-600 font-medium transition-colors"
        >
          この音声から再生成
        </button>
      )}

      {/* New recording button */}
      <button
        onClick={onReset}
        className="w-full py-3 rounded-lg bg-slate-700 hover:bg-slate-600 font-medium transition-colors"
      >
        新しい録音を開始
      </button>
    </div>
  );
}
