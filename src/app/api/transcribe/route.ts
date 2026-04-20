import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getAuthUser } from "@/lib/auth";

// 1時間音声でも耐えられるよう最大15分（Next.jsのVercel環境向け。Renderには影響なし）
export const maxDuration = 900;

const TRANSCRIBE_PROMPT = `この音声を文字起こししてください。
話者が複数いる場合は、声の違いから話者を識別し（話者A、話者B 等）、発言を区別してください。
時系列順に、話者ラベルとともに発言内容を正確に記載してください。
音声の最初から最後まで、省略せずに全ての発言を文字起こししてください。
聞き取れない部分は「（聞き取り不明）」と記載してください。
出力はプレーンテキストのみで、余計な前置きや説明は不要です。`;

// 長時間録音で iOS Safari が idle な fetch を drop するのを避けるため、
// 処理中は NDJSON 形式で進捗メッセージをストリーム出力する
// { type: "progress", stage, elapsed? } / { type: "transcript", text } / { type: "done" } / { type: "error", message }

export async function POST(request: Request) {
  try {
    const authUser = getAuthUser(request);
    if (!authUser) {
      return new Response("Unauthorized", { status: 401 });
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return new Response("No audio file provided", { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response("GEMINI_API_KEY is not configured", { status: 500 });
    }

    const mimeType = audioFile.type || "audio/webm";
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const ext = mimeType.includes("mp4") ? "m4a"
              : mimeType.includes("webm") ? "webm"
              : mimeType.includes("mpeg") ? "mp3"
              : mimeType.includes("wav") ? "wav"
              : mimeType.includes("ogg") ? "ogg"
              : "bin";
    const tempPath = join(tmpdir(), `audio-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);

    const fileManager = new GoogleAIFileManager(apiKey);
    let uploadedFileName: string | null = null;
    let tempFileCreated = false;
    let cleanedUp = false;
    let aborted = false;

    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (tempFileCreated) {
        await unlink(tempPath).catch((err) => {
          console.warn("一時ファイル削除失敗:", err);
        });
      }
      if (uploadedFileName) {
        await fileManager.deleteFile(uploadedFileName).catch((err) => {
          console.warn("Geminiファイル削除失敗:", err);
        });
      }
    };

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        // クライアント切断後の enqueue は throw するので保護
        const send = (obj: unknown) => {
          if (aborted) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          } catch {
            aborted = true;
          }
        };

        try {
          await writeFile(tempPath, buffer);
          tempFileCreated = true;

          send({ type: "progress", stage: "uploading" });
          const uploadResult = await fileManager.uploadFile(tempPath, {
            mimeType,
            displayName: `meeting-${Date.now()}`,
          });
          uploadedFileName = uploadResult.file.name;

          // ACTIVE になるまでポーリング（最大15分、2秒間隔）
          const maxPollSeconds = 900;
          const startTime = Date.now();
          let file = await fileManager.getFile(uploadedFileName);
          while (file.state === FileState.PROCESSING) {
            if (aborted) return;
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            if (elapsed >= maxPollSeconds) break;
            send({ type: "progress", stage: "processing", elapsed });
            await new Promise((r) => setTimeout(r, 2000));
            file = await fileManager.getFile(uploadedFileName);
          }
          if (file.state !== FileState.ACTIVE) {
            throw new Error(`ファイル処理に失敗しました: state=${file.state}`);
          }
          if (!file.uri) {
            throw new Error("Geminiがファイル URI を返しませんでした");
          }

          send({ type: "progress", stage: "transcribing" });

          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

          const result = await model.generateContentStream([
            { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
            { text: TRANSCRIBE_PROMPT },
          ]);
          for await (const chunk of result.stream) {
            if (aborted) return;
            const text = chunk.text();
            if (text) send({ type: "transcript", text });
          }

          send({ type: "done" });
        } catch (err) {
          console.error("Transcribe error:", err);
          const message = err instanceof Error ? err.message : "Internal server error";
          send({ type: "error", message });
        } finally {
          await cleanup();
          try {
            controller.close();
          } catch {
            // すでに close 済み / cancel 済みなら無視
          }
        }
      },
      async cancel() {
        aborted = true;
        await cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (err) {
    console.error("Transcribe error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(message, { status: 500 });
  }
}
