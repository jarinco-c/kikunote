import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

const PROMPT = `あなたは議事録作成の専門家です。
この音声は会議の録音です。音声を注意深く聞いて、以下の形式で議事録を作成してください。

話者が複数いる場合は、声の違いから話者を識別し（話者A、話者B 等）、発言を区別してください。
話者が1人の場合は、その旨を記載してください。

## 議事録

**日時**: （音声から推測できない場合は「要記入」）
**参加者**: （識別できた話者を列挙）

### 議題
- （議論された主なトピックを箇条書き）

### 議論内容
（話者ごとの発言を時系列で要約。重要な発言は具体的に記載）

### 決定事項
- （会議で決定されたことを箇条書き。なければ「特になし」）

### アクションアイテム
- [ ] （誰が何をいつまでにやるか。なければ「特になし」）

### 備考
（その他特記事項。なければ省略）

---
重要: 音声の内容に忠実に作成してください。聞き取れない部分は「（聞き取り不明）」と記載してください。`;

export async function POST(request: Request) {
  try {
    // Verify password
    const appPassword = process.env.APP_PASSWORD;
    const authHeader = request.headers.get("x-app-password");
    if (!appPassword || authHeader !== appPassword) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Get audio data from form
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return new Response("No audio file provided", { status: 400 });
    }

    const recordedAt = formData.get("recordedAt") as string | null;

    // Convert to base64
    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = audioFile.type || "audio/webm";

    // Build prompt with recording time
    let prompt = PROMPT;
    if (recordedAt) {
      prompt += `\n\n※この録音は ${recordedAt} に開始されました。日時欄にはこの情報を使用してください。`;
    }

    // Call Gemini API with streaming
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContentStream({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64Audio } },
            { text: prompt },
          ],
        },
      ],
    });

    // Stream the response back
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    console.error("Generate minutes error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(message, { status: 500 });
  }
}
