/**
 * ユーザー作成スクリプト
 * 使い方: npx tsx src/scripts/create-user.ts <userId> <password> [displayName]
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
  const [, , userId, password, displayName] = process.argv;

  if (!userId || !password) {
    console.error(
      "使い方: npx tsx src/scripts/create-user.ts <userId> <password> [displayName]"
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
  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("users")
    .insert({
      user_id: userId,
      password_hash: passwordHash,
      display_name: displayName || userId,
    })
    .select("id, user_id, display_name")
    .single();

  if (error) {
    if (error.code === "23505") {
      console.error(`エラー: ユーザーID "${userId}" は既に存在します`);
    } else {
      console.error("エラー:", error.message);
    }
    process.exit(1);
  }

  console.log("ユーザーを作成しました:");
  console.log(`  ID: ${data.user_id}`);
  console.log(`  表示名: ${data.display_name}`);
  console.log(`  DB ID: ${data.id}`);
}

main();
