"use client";

import { useState, useEffect } from "react";

type User = {
  id: string;
  user_id: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
};

export default function AdminPanel({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserId, setNewUserId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        setUsers(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: newUserId,
          password: newPassword,
          displayName: newDisplayName || newUserId,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`「${data.user_id}」を登録しました`);
        setNewUserId("");
        setNewPassword("");
        setNewDisplayName("");
        fetchUsers();
      } else {
        setMessage(data.error || "登録に失敗しました");
      }
    } catch {
      setMessage("接続エラーが発生しました");
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">ユーザー管理</h2>
        <button
          onClick={onBack}
          className="px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm transition-colors"
        >
          戻る
        </button>
      </div>

      {/* ユーザー作成フォーム */}
      <form onSubmit={handleCreate} className="bg-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="font-medium text-sm text-slate-300">新規ユーザー登録</h3>
        <input
          type="text"
          value={newUserId}
          onChange={(e) => setNewUserId(e.target.value)}
          placeholder="ユーザーID"
          className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
        />
        <input
          type="text"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="パスワード"
          className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
        />
        <input
          type="text"
          value={newDisplayName}
          onChange={(e) => setNewDisplayName(e.target.value)}
          placeholder="表示名（省略可）"
          className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
        />
        <button
          type="submit"
          disabled={creating || !newUserId || !newPassword}
          className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-medium text-sm transition-colors"
        >
          {creating ? "登録中..." : "登録する"}
        </button>
        {message && (
          <p className={`text-sm text-center ${message.includes("登録しました") ? "text-green-400" : "text-red-400"}`}>
            {message}
          </p>
        )}
      </form>

      {/* ユーザー一覧 */}
      <div>
        <h3 className="font-medium text-sm text-slate-300 mb-2">登録済みユーザー</h3>
        {loading ? (
          <p className="text-slate-400 text-center py-4">読み込み中...</p>
        ) : (
          <div className="space-y-2">
            {users.map((user) => (
              <div key={user.id} className="bg-slate-800 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{user.display_name}</span>
                    <span className="text-slate-400 text-sm ml-2">@{user.user_id}</span>
                    {user.is_admin && (
                      <span className="text-xs bg-blue-600 rounded px-1.5 py-0.5 ml-2">管理者</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500">{formatDate(user.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
