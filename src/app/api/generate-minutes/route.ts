import { GoogleGenerativeAI } from "@google/generative-ai";
import { getAuthUser } from "@/lib/auth";

// --- 議事録用プロンプト ---

const MINUTES_TRANSCRIPT_PROMPT = `あなたは議事録作成の専門家です。
以下は会議の文字起こしテキストです。この内容を元に議事録を作成してください。

【重要なルール】
- 議事録は「要約」です。発言をそのまま書き起こすのではなく、要点を整理してまとめてください。
- 「えっと」「あの」などのフィラーや、挨拶・雑談は省略してください。
- 同じ話題について複数人が話した場合は、結論や合意内容を中心にまとめてください。
- テキストの最初の部分だけでなく、最後まで全て読んで議事録に反映してください。`;

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

const SPEC_TRANSCRIPT_PROMPT = `あなたは仕様書作成の専門家です。
以下は、誰かがアイデアや要件を口頭で議論した内容の文字起こしです。この内容を元に、実装者が読んで作業に取り掛かれるレベルの仕様書を作成してください。

【重要なルール】
- 仕様書は「構造化されたドキュメント」です。発言をそのまま書き起こすのではなく、論点ごとに整理・再構成してください。
- 発言の中で言及されたアイデア・要件・懸念・制約は漏らさず拾い上げ、適切なセクションに配置してください。
- 「えっと」「あの」などのフィラーや、会議進行のための発言は省略してください。
- 話の流れから自然に導ける背景・前提は、推論であることが分かる書き方で補完して構いません（例：「〜と考えられる」「〜が想定される」）。
- 発言量が少ないセクションでも、触れられているトピックがあれば必ず記載してください。空欄にしないでください。
- テキストの最初の部分だけでなく、最後まで全て読んで仕様書に反映してください。`;

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

### 画面・UI
（画面構成やユーザー操作の流れ）

### データ・システム構成
（必要なデータ、API、外部サービス等）

### 非機能要件
（性能、セキュリティ、コスト等の制約）

### 優先度・スケジュール
（優先順位や期限について）

### 未決事項・検討事項
- （発言の中で決まっていない点や、追加で検討が必要な点を箇条書き）

---
重要:
- 発言内容に忠実に、ただし構造化・整理して作成してください。発言のベタ打ちにはしないでください。
- 発言に根拠のない機能や要件を捏造しないでください。
- 聞き取れない部分は「（聞き取り不明）」と記載してください。
- 言及のあったトピックは空欄にせず記載。言及がまったくないセクションは「要議論」と明記してください。`;

type OutputType = "minutes" | "spec";

function getPrompts(outputType: OutputType) {
  if (outputType === "spec") {
    return {
      transcriptPrompt: SPEC_TRANSCRIPT_PROMPT,
      template: SPEC_TEMPLATE,
    };
  }
  return {
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

    const body = await request.json();
    const { transcript, recordedAt, outputType = "minutes" } = body as {
      transcript?: string;
      recordedAt?: string;
      outputType?: OutputType;
    };

    if (!transcript) {
      return new Response("No transcript provided", { status: 400 });
    }

    const prompts = getPrompts(outputType);
    let prompt = prompts.transcriptPrompt + prompts.template;
    if (recordedAt) {
      prompt += `\n\n※この録音は ${recordedAt} に行われました。日時欄にはこの情報を使用してください。`;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response("GEMINI_API_KEY is not configured", { status: 500 });
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContentStream({
      contents: [
        {
          role: "user",
          parts: [{ text: `${prompt}\n\n--- 文字起こしテキスト ---\n${transcript}` }],
        },
      ],
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
