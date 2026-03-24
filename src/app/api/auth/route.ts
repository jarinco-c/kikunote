import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { password } = await request.json();
  const correct = process.env.APP_PASSWORD;

  if (!correct) {
    return NextResponse.json({ error: "APP_PASSWORD not configured" }, { status: 500 });
  }

  if (password === correct) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
