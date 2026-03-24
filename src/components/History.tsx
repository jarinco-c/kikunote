"use client";

import { useState } from "react";

export type HistoryEntry = {
  id: string;
  content: string;
  createdAt: string;
  title: string;
};

const STORAGE_KEY = "meeting-minutes-history";

export function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveToHistory(content: string): HistoryEntry {
  const history = loadHistory();
  // Extract title from first heading or first line
  const titleMatch = content.match(/^##?\s*(.+)/m);
  const title = titleMatch
    ? titleMatch[1].replace(/\*\*/g, "").trim()
    : content.slice(0, 30) + "...";

  const entry: HistoryEntry = {
    id: Date.now().toString(),
    content,
    createdAt: new Date().toISOString(),
    title,
  };

  history.unshift(entry);
  // Keep max 50 entries
  if (history.length > 50) history.pop();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  return entry;
}

export function deleteFromHistory(id: string) {
  const history = loadHistory().filter((e) => e.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

type HistoryProps = {
  onSelect: (entry: HistoryEntry) => void;
  onBack: () => void;
};

export default function History({ onSelect, onBack }: HistoryProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>(loadHistory);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("この議事録を削除しますか？")) {
      deleteFromHistory(id);
      setEntries(loadHistory());
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

      {entries.length === 0 ? (
        <p className="text-slate-500 text-center py-8">まだ議事録がありません</p>
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
                  <p className="text-sm text-slate-400 mt-1">{formatDate(entry.createdAt)}</p>
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
