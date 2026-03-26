import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import {
  verifyPassword,
  createToken,
  getSessionCookie,
  getClearSessionCookie,
  getAuthUser,
} from "@/lib/auth";

// POST: ログイン
export async function POST(request: Request) {
  const { userId, password } = await request.json();

  if (!userId || !password) {
    return NextResponse.json(
      { error: "ユーザーIDとパスワードを入力してください" },
      { status: 400 }
    );
  }

  const { data: user, error } = await getSupabase()
    .from("users")
    .select("id, user_id, password_hash, display_name")
    .eq("user_id", userId)
    .single();

  if (error || !user) {
    return NextResponse.json(
      { error: "ユーザーIDまたはパスワードが違います" },
      { status: 401 }
    );
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return NextResponse.json(
      { error: "ユーザーIDまたはパスワードが違います" },
      { status: 401 }
    );
  }

  const token = createToken({ userId: user.user_id, dbId: user.id });

  return new Response(
    JSON.stringify({
      ok: true,
      userId: user.user_id,
      displayName: user.display_name,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": getSessionCookie(token),
      },
    }
  );
}

// GET: ログイン状態チェック
export async function GET(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { data: user } = await getSupabase()
    .from("users")
    .select("user_id, display_name")
    .eq("id", authUser.dbId)
    .single();

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    userId: user.user_id,
    displayName: user.display_name,
  });
}

// DELETE: ログアウト
export async function DELETE() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": getClearSessionCookie(),
    },
  });
}
