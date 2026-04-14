// キープアライブ用の軽量エンドポイント。
// Render無料プランは15分アクセスがないとスリープするため、
// 録音中にクライアントから定期的に叩いてサーバーを起こしておく。
// Cache-Control: no-store は将来CDNを挟んだ時に「キャッシュ応答だけ返ってサーバーに届かない＝keepaliveにならない」事態を防ぐため
export async function GET() {
  return new Response("ok", {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
    },
  });
}
