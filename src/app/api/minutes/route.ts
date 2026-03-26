import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getAuthUser } from "@/lib/auth";

// GET: 議事録一覧を取得
export async function GET(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await getSupabase()
    .from("minutes")
    .select("id, title, content, created_at")
    .eq("user_id", authUser.dbId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST: 議事録を保存
export async function POST(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { content, title: providedTitle, createdAt } = await request.json();

  if (!content) {
    return NextResponse.json(
      { error: "Content is required" },
      { status: 400 }
    );
  }

  // Extract title from content if not provided
  let title = providedTitle;
  if (!title) {
    const titleMatch = content.match(/^##?\s*(.+)/m);
    title = titleMatch
      ? titleMatch[1].replace(/\*\*/g, "").trim()
      : content.slice(0, 30) + "...";
  }

  const insertData: Record<string, unknown> = {
    user_id: authUser.dbId,
    title,
    content,
  };

  // Allow specifying created_at for migration
  if (createdAt) {
    insertData.created_at = createdAt;
  }

  const { data, error } = await getSupabase()
    .from("minutes")
    .insert(insertData)
    .select("id, title, content, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
