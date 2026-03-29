"use client";

import { useState, useEffect } from "react";

export type HistoryEntry = {
  id: string;
  content: string;
  transcript: string | null;
  created_at: string;
  title: string;
};

export async function saveToServer(content: string, transcript?: string): Promise<HistoryEntry> {
  const res = await fetch("/api/minutes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, transcript: transcript || null }),
  });

  if (!res.ok) {
    throw new Error("議事録の保存に失敗しました");
  }

  return res.json();
}

export async function deleteFromServer(id: string): Promise<void> {
  const res = await fetch(`/api/minutes/${id}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    throw new Error("削除に失敗しました");
  }
}

const LEGACY_STORAGE_KEY = "meeting-minutes-history";

export function getLegacyHistory(): {
  id: string;
  content: string;
  createdAt: string;
  title: string;
}[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(LEGACY_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function clearLegacyHistory() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

type HistoryProps = {
  onSelect: (entry: HistoryEntry) => void;
  onBack: () => void;
};

export default function History({ onSelect, onBack }: HistoryProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/minutes");
      if (!res.ok) throw new Error("取得に失敗しました");
      const data = await res.json();
      setEntries(data);
    } catch {
      setError("履歴の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("この議事録を削除しますか？")) return;

    try {
      await deleteFromServer(id);
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
    } catch {
      alert("削除に失敗しました");
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">履歴</h2>
        <button
          onClick={onBack}
          className="px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm transition-colors"
        >
          戻る
        </button>
      </div>

      {loading ? (
        <p className="text-slate-400 text-center py-8">読み込み中...</p>
      ) : error ? (
        <p className="text-red-400 text-center py-8">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-slate-500 text-center py-8">
          まだ議事録がありません
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              onClick={() => onSelect(entry)}
              className="bg-slate-800 rounded-lg p-4 cursor-pointer hover:bg-slate-750 active:bg-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{entry.title}</p>
                  <p className="text-sm text-slate-400 mt-1">
                    {formatDate(entry.created_at)}
                  </p>
                </div>
                <button
                  onClick={(e) => handleDelete(entry.id, e)}
                  className="text-slate-500 hover:text-red-400 text-sm shrink-0 px-2 py-1 transition-colors"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
