import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

const TRANSCRIBE_PROMPT = `この音声を文字起こししてください。
話者が複数いる場合は、声の違いから話者を識別し（話者A、話者B 等）、発言を区別してください。
時系列順に、話者ラベルとともに発言内容を正確に記載してください。
聞き取れない部分は「（聞き取り不明）」と記載してください。
出力はプレーンテキストのみで、余計な前置きや説明は不要です。`;

export async function POST(request: Request) {
  try {
    const appPassword = process.env.APP_PASSWORD;
    const authHeader = request.headers.get("x-app-password");
    if (!appPassword || authHeader !== appPassword) {
      return new Response("Unauthorized", { status: 401 });
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return new Response("No audio file provided", { status: 400 });
    }

    const segmentIndex = formData.get("segmentIndex") as string | null;
    const totalSegments = formData.get("totalSegments") as string | null;

    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = audioFile.type || "audio/webm";

    let prompt = TRANSCRIBE_PROMPT;
    if (segmentIndex && totalSegments) {
      prompt += `\n\n※これは会議録音の ${totalSegments} 分割中の ${segmentIndex} 番目のセグメントです。`;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent({
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

    const transcript = result.response.text();
    return new Response(JSON.stringify({ transcript }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Transcribe error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(message, { status: 500 });
  }
}
