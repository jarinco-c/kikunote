import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getAuthUser } from "@/lib/auth";

const TRANSCRIBE_PROMPT = `この音声を文字起こししてください。
話者が複数いる場合は、声の違いから話者を識別し（話者A、話者B 等）、発言を区別してください。
時系列順に、話者ラベルとともに発言内容を正確に記載してください。
音声の最初から最後まで、省略せずに全ての発言を文字起こししてください。
聞き取れない部分は「（聞き取り不明）」と記載してください。
出力はプレーンテキストのみで、余計な前置きや説明は不要です。`;

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

    // 一時ファイルに書き出し（Gemini Files APIがファイルパスを要求するため）
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

    try {
      await writeFile(tempPath, buffer);
      tempFileCreated = true;

      // Gemini Files APIにアップロード（inlineDataの20MB制限を回避）
      const uploadResult = await fileManager.uploadFile(tempPath, {
        mimeType,
        displayName: `meeting-${Date.now()}`,
      });
      uploadedFileName = uploadResult.file.name;

      // ファイルが ACTIVE になるまでポーリング（最大5分）
      const maxPolls = 150; // 2秒間隔 × 150 = 300秒
      let file = await fileManager.getFile(uploadedFileName);
      for (let i = 0; i < maxPolls && file.state === FileState.PROCESSING; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        file = await fileManager.getFile(uploadedFileName);
      }
      if (file.state !== FileState.ACTIVE) {
        throw new Error(`ファイル処理に失敗しました: state=${file.state}`);
      }
      if (!file.uri) {
        throw new Error("Geminiがファイル URI を返しませんでした");
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const result = await model.generateContent([
        { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
        { text: TRANSCRIBE_PROMPT },
      ]);

      const transcript = result.response.text();
      return new Response(JSON.stringify({ transcript }), {
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      // ローカル一時ファイルを削除（writeFile成功時のみ）
      if (tempFileCreated) {
        await unlink(tempPath).catch((err) => {
          console.warn("一時ファイル削除失敗:", err);
        });
      }
      // Gemini上のファイルも削除（48時間で自動削除されるが明示的に消す）
      if (uploadedFileName) {
        await fileManager.deleteFile(uploadedFileName).catch((err) => {
          console.warn("Geminiファイル削除失敗:", err);
        });
      }
    }
  } catch (err) {
    console.error("Transcribe error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(message, { status: 500 });
  }
}
