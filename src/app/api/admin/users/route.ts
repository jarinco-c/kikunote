import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getAuthUser } from "@/lib/auth";
import bcrypt from "bcryptjs";

async function verifyAdmin(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser) return null;

  const { data: user } = await getSupabase()
    .from("users")
    .select("id, is_admin")
    .eq("id", authUser.dbId)
    .single();

  if (!user?.is_admin) return null;
  return authUser;
}

// GET: ユーザー一覧
export async function GET(request: Request) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await getSupabase()
    .from("users")
    .select("id, user_id, display_name, is_admin, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST: ユーザー作成
export async function POST(request: Request) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId, password, displayName } = await request.json();

  if (!userId || !password) {
    return NextResponse.json(
      { error: "ユーザーIDとパスワードは必須です" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await getSupabase()
    .from("users")
    .insert({
      user_id: userId,
      password_hash: passwordHash,
      display_name: displayName || userId,
    })
    .select("id, user_id, display_name, is_admin, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `ユーザーID「${userId}」は既に使われています` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
