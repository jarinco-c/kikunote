/**
 * パスワードリセットスクリプト
 * 使い方: npx tsx src/scripts/reset-password.ts <userId> <newPassword>
 *
 * 環境変数が必要:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   (.env.local から自動読み込み)
 */

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

// Load .env.local
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local not found, rely on existing env vars
  }
}

loadEnv();

async function main() {
  const [, , userId, newPassword] = process.argv;

  if (!userId || !newPassword) {
    console.error(
      "使い方: npx tsx src/scripts/reset-password.ts <userId> <newPassword>"
    );
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "エラー: SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください"
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const passwordHash = await bcrypt.hash(newPassword, 10);

  const { data, error } = await supabase
    .from("users")
    .update({ password_hash: passwordHash })
    .eq("user_id", userId)
    .select("id, user_id, display_name, is_admin")
    .single();

  if (error) {
    console.error("エラー:", error.message);
    process.exit(1);
  }

  if (!data) {
    console.error(`エラー: ユーザーID "${userId}" が見つかりません`);
    process.exit(1);
  }

  console.log("パスワードをリセットしました:");
  console.log(`  ID: ${data.user_id}`);
  console.log(`  表示名: ${data.display_name}`);
  console.log(`  管理者: ${data.is_admin ? "はい" : "いいえ"}`);
}

main();
