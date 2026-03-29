import { GoogleGenerativeAI } from "@google/generative-ai";
import { getAuthUser } from "@/lib/auth";

export const maxDuration = 60;

// --- 議事録用プロンプト ---

const MINUTES_AUDIO_PROMPT = `あなたは議事録作成の専門家です。
この音声は会議の録音です。音声を注意深く聞いて、以下の形式で議事録を作成してください。

【重要なルール】
- 議事録は「要約」です。発言をそのまま書き起こすのではなく、要点を整理してまとめてください。
- 「えっと」「あの」などのフィラーや、挨拶・雑談は省略してください。
- 同じ話題について複数人が話した場合は、結論や合意内容を中心にまとめてください。
- 話者が複数いる場合は、声の違いから話者を識別し（話者A、話者B 等）、発言を区別してください。`;

const MINUTES_TRANSCRIPT_PROMPT = `あなたは議事録作成の専門家です。
以下は会議の文字起こしテキストです。この内容を元に議事録を作成してください。

【重要なルール】
- 議事録は「要約」です。発言をそのまま書き起こすのではなく、要点を整理してまとめてください。
- 「えっと」「あの」などのフィラーや、挨拶・雑談は省略してください。
- 同じ話題について複数人が話した場合は、結論や合意内容を中心にまとめてください。`;

const MINUTES_TEMPLATE = `

## 議事録

**日時**: （音声から推測できない場合は「要記入」）
**参加者**: （識別できた話者を列挙）

### 議題
- （議論された主なトピックを箇条書き）

### 議論の要点
（各議題について、何が話し合われ、どのような意見が出たかを簡潔に要約。
発言の一字一句を書くのではなく、議論のポイントと結論をまとめる。）

### 決定事項
- （会議で決定されたことを箇条書き。なければ「特になし」）

### アクションアイテム
- [ ] 【担当: ○○】内容（期限: ○○まで）
- （誰が何をいつまでにやるかを明確に。なければ「特になし」）

### 備考
（その他特記事項。なければ省略）

---
重要:
- 内容に忠実に、ただし要約して作成してください。
- 発言のベタ打ち（文字起こし）にはしないでください。
- 聞き取れない部分は「（聞き取り不明）」と記載してください。`;

// --- 仕様書用プロンプト ---

const SPEC_AUDIO_PROMPT = `あなたは仕様書作成の専門家です。
この音声は、誰かがアイデアや要件を口頭で説明したものです。音声を注意深く聞いて、整理された仕様書を作成してください。

話している内容が断片的でも、文脈を読み取って論理的に整理してください。`;

const SPEC_TRANSCRIPT_PROMPT = `あなたは仕様書作成の専門家です。
以下は、誰かがアイデアや要件を口頭で説明した内容の文字起こしです。この内容を元に整理された仕様書を作成してください。`;

const SPEC_TEMPLATE = `

## 仕様書

**プロジェクト名 / 機能名**: （内容から推測。不明の場合は「要記入」）
**作成日**: （日時情報があれば記載、なければ「要記入」）

### 概要
（プロジェクトや機能の目的を1〜3文で簡潔に）

### 背景・課題
（なぜこれが必要なのか、現状の課題は何か）

### 機能要件
- （実現したい機能を箇条書きで整理）

### 画面・UI（該当する場合）
（画面構成やユーザー操作の流れ。言及がなければ省略）

### データ・システム構成（該当する場合）
（必要なデータ、API、外部サービス等。言及がなければ省略）

### 非機能要件（該当する場合）
（性能、セキュリティ、コスト等の制約。言及がなければ省略）

### 優先度・スケジュール（該当する場合）
（優先順位や期限について言及があれば記載。なければ省略）

### 未決事項・検討事項
- （発言の中で決まっていない点や、追加で検討が必要な点を箇条書き）

---
重要: 発言内容に忠実に作成してください。発言者が明確に言っていないことを勝手に追加しないでください。聞き取れない部分は「（聞き取り不明）」と記載してください。該当しないセクションは省略してください。`;

type OutputType = "minutes" | "spec";

function getPrompts(outputType: OutputType) {
  if (outputType === "spec") {
    return {
      audioPrompt: SPEC_AUDIO_PROMPT,
      transcriptPrompt: SPEC_TRANSCRIPT_PROMPT,
      template: SPEC_TEMPLATE,
    };
  }
  return {
    audioPrompt: MINUTES_AUDIO_PROMPT,
    transcriptPrompt: MINUTES_TRANSCRIPT_PROMPT,
    template: MINUTES_TEMPLATE,
  };
}

export async function POST(request: Request) {
  try {
    const authUser = getAuthUser(request);
    if (!authUser) {
      return new Response("Unauthorized", { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];
    let prompt: string;

    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { transcript, recordedAt, outputType = "minutes" } = body;
      if (!transcript) {
        return new Response("No transcript provided", { status: 400 });
      }
      const prompts = getPrompts(outputType);
      prompt = prompts.transcriptPrompt + prompts.template;
      if (recordedAt) {
        prompt += `\n\n※この録音は ${recordedAt} に行われました。日時欄にはこの情報を使用してください。`;
      }
      parts.push({ text: `${prompt}\n\n--- 文字起こしテキスト ---\n${transcript}` });
    } else {
      const formData = await request.formData();
      const audioFile = formData.get("audio") as File | null;
      if (!audioFile) {
        return new Response("No audio file provided", { status: 400 });
      }
      const recordedAt = formData.get("recordedAt") as string | null;
      const outputType = (formData.get("outputType") as string | null) || "minutes";
      const arrayBuffer = await audioFile.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString("base64");
      const mimeType = audioFile.type || "audio/webm";

      const prompts = getPrompts(outputType as OutputType);
      prompt = prompts.audioPrompt + prompts.template;
      if (recordedAt) {
        prompt += `\n\n※この録音は ${recordedAt} に行われました。日時欄にはこの情報を使用してください。`;
      }
      parts.push({ inlineData: { mimeType, data: base64Audio } });
      parts.push({ text: prompt });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response("GEMINI_API_KEY is not configured", { status: 500 });
    }
    const genAI = new GoogleGenerativeAI(apiKey);
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
    console.error("Generate error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(message, { status: 500 });
  }
}
