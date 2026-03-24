import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

const AUDIO_PROMPT = `あなたは議事録作成の専門家です。
この音声は会議の録音です。音声を注意深く聞いて、以下の形式で議事録を作成してください。

話者が複数いる場合は、声の違いから話者を識別し（話者A、話者B 等）、発言を区別してください。
話者が1人の場合は、その旨を記載してください。`;

const TRANSCRIPT_PROMPT = `あなたは議事録作成の専門家です。
以下は会議の文字起こしテキストです。この内容を元に議事録を作成してください。`;

const MINUTES_TEMPLATE = `

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
重要: 内容に忠実に作成してください。聞き取れない部分は「（聞き取り不明）」と記載してください。`;

export async function POST(request: Request) {
  try {
    const appPassword = process.env.APP_PASSWORD;
    const authHeader = request.headers.get("x-app-password");
    if (!appPassword || authHeader !== appPassword) {
      return new Response("Unauthorized", { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";
    let prompt: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];

    if (contentType.includes("application/json")) {
      // Text-based: transcript from segmented recording
      const body = await request.json();
      const { transcript, recordedAt } = body;
      if (!transcript) {
        return new Response("No transcript provided", { status: 400 });
      }
      prompt = TRANSCRIPT_PROMPT + MINUTES_TEMPLATE;
      if (recordedAt) {
        prompt += `\n\n※この会議は ${recordedAt} に開始されました。日時欄にはこの情報を使用してください。`;
      }
      parts.push({ text: `${prompt}\n\n--- 文字起こしテキスト ---\n${transcript}` });
    } else {
      // Audio-based: single short recording
      const formData = await request.formData();
      const audioFile = formData.get("audio") as File | null;
      if (!audioFile) {
        return new Response("No audio file provided", { status: 400 });
      }
      const recordedAt = formData.get("recordedAt") as string | null;
      const arrayBuffer = await audioFile.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString("base64");
      const mimeType = audioFile.type || "audio/webm";

      prompt = AUDIO_PROMPT + MINUTES_TEMPLATE;
      if (recordedAt) {
        prompt += `\n\n※この録音は ${recordedAt} に開始されました。日時欄にはこの情報を使用してください。`;
      }
      parts.push({ inlineData: { mimeType, data: base64Audio } });
      parts.push({ text: prompt });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContentStream({
      contents: [{ role: "user", parts }],
    });

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
