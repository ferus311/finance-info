import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import {
  addVocabularyEntries,
  deleteVocabularyEntry,
  getVocabularyEntries,
  updateVocabularyEntry,
} from "@/lib/server/db";

export const runtime = "nodejs";

type Provider = "openai" | "gemini";
type Language = "en" | "ja";
type Example = { sentence: string; translation: string };
type Entry = {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  description: string;
  examples: Example[];
  targetLanguage: Language;
};

const MODELS: Record<Provider, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
};

function asText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function normalizeEntries(
  value: unknown,
  targetLanguage: Language,
  preserveIds = false,
  limit = 30,
): Entry[] {
  if (!Array.isArray(value)) throw new Error("AI trả về danh sách từ không hợp lệ.");
  return value.slice(0, limit).flatMap((item): Entry[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const word = asText(row.word, 120);
    if (!word) return [];
    const hasKanji = /\p{Script=Han}/u.test(word);
    const meaningValue = Array.isArray(row.meaning)
      ? row.meaning.filter((meaning): meaning is string => typeof meaning === "string").join("; ")
      : asText(row.meaning, 1000);
    const legacyExamples = Array.isArray(row.examples)
      ? row.examples
      : [{ sentence: row.example, translation: row.translation }];
    const examples = legacyExamples.slice(0, 2).map((example) => {
      const value = example && typeof example === "object" ? example as Record<string, unknown> : {};
      return {
        sentence: asText(value.sentence, 600),
        translation: asText(value.translation, 600),
      };
    });
    while (examples.length < 2) examples.push({ sentence: "", translation: "" });
    return [{
      id: preserveIds ? asText(row.id, 80) || randomUUID() : randomUUID(),
      word,
      phonetic: targetLanguage === "ja" && !hasKanji ? "" : asText(row.phonetic, 120),
      partOfSpeech: asText(row.partOfSpeech, 80),
      meaning: [...new Set(meaningValue.split(/[;；]/).map((meaning) => meaning.trim()).filter(Boolean))].join("; "),
      description: asText(row.description, 2000),
      examples,
      targetLanguage,
    }];
  });
}

function makePrompt(text: string, language: Language) {
  const rules = language === "ja"
    ? "Extract useful Japanese vocabulary. Use dictionary form (jisho-kei) for verbs and base form for adjectives. For words containing Kanji, phonetic must be the full Hiragana reading. For words without Kanji, phonetic must be empty."
    : "Extract useful English vocabulary in its lemma/base form and use standard IPA for phonetic.";
  return `You are an expert bilingual vocabulary tutor. ${rules}
For every word, return its 1–4 most common distinct Vietnamese meanings, ordered by frequency and separated by semicolons. Do not collapse different senses into one vague definition. Write partOfSpeech in Vietnamese. Add a concise but useful Vietnamese description explaining typical contexts/register/collocations, useful near-synonyms and how they differ, and common confusions when relevant.
Return exactly two example objects with sentence and translation strings. If the word has several meanings, illustrate its two most common meanings with one example each. If it has one main meaning, use two varied natural contexts. For a passage, reuse a complete sentence from the input as the first example when possible, then create a second example. Translate both examples into Vietnamese. For a single word, create both examples. Return JSON only: an object with an entries array; every entry has string fields word, phonetic, partOfSpeech, meaning, description, and an examples array of exactly two objects with sentence and translation.

Input:
${text}`;
}

async function askOpenAI(apiKey: string, model: string, prompt: string): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI không trả về nội dung.");
  const parsed: unknown = JSON.parse(content);
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)) {
    return (parsed as { entries: unknown[] }).entries;
  }
  return parsed;
}

async function askGemini(apiKey: string, model: string, prompt: string): Promise<unknown> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    },
  );
  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!response.ok) throw new Error(`Gemini request failed (${response.status}).`);
  const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!content) throw new Error("Gemini không trả về nội dung.");
  const parsed: unknown = JSON.parse(content);
  return parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
    ? (parsed as { entries: unknown[] }).entries
    : parsed;
}

function parseLanguage(value: string | null): Language | null {
  return value === "en" || value === "ja" ? value : null;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Vui lòng đăng nhập lại." }, { status: 401 });
  const language = parseLanguage(new URL(request.url).searchParams.get("language"));
  if (!language) return NextResponse.json({ error: "Ngôn ngữ không hợp lệ." }, { status: 400 });
  return NextResponse.json({ vocabulary: getVocabularyEntries(user.user_id, language) });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Vui lòng đăng nhập lại." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const language = body && (body.targetLanguage === "en" || body.targetLanguage === "ja")
    ? body.targetLanguage
    : null;
  if (!language || !Array.isArray(body?.entries)) {
    return NextResponse.json({ error: "Dữ liệu nhập từ thiết bị không hợp lệ." }, { status: 400 });
  }
  if (body.entries.length > 1000) {
    return NextResponse.json({ error: "Chỉ có thể nhập tối đa 1.000 từ mỗi lần." }, { status: 413 });
  }
  try {
    const entries = normalizeEntries(body.entries, language, true, 1000);
    addVocabularyEntries(user.user_id, language, entries);
    return NextResponse.json({ imported: entries.length });
  } catch {
    return NextResponse.json({ error: "Không thể nhập dữ liệu từ thiết bị." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Vui lòng đăng nhập lại." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const language = body && (body.targetLanguage === "en" || body.targetLanguage === "ja")
    ? body.targetLanguage
    : null;
  if (!language || !body?.entry || typeof body.entry !== "object") {
    return NextResponse.json({ error: "Dữ liệu sửa từ không hợp lệ." }, { status: 400 });
  }
  const [entry] = normalizeEntries([body.entry], language, true);
  if (!entry || !updateVocabularyEntry(user.user_id, language, entry)) {
    return NextResponse.json({ error: "Không tìm thấy từ vựng cần sửa." }, { status: 404 });
  }
  return NextResponse.json({ vocabulary: entry });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Vui lòng đăng nhập lại." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const language = parseLanguage(params.get("language"));
  const id = params.get("id")?.trim();
  if (!language || !id) return NextResponse.json({ error: "Thiếu từ vựng cần xóa." }, { status: 400 });
  if (!deleteVocabularyEntry(user.user_id, language, id)) {
    return NextResponse.json({ error: "Không tìm thấy từ vựng cần xóa." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Vui lòng đăng nhập lại." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const provider = input.provider;
  const language = input.targetLanguage;
  const model = asText(input.model, 80);
  if (!text) return NextResponse.json({ error: "Hãy nhập từ hoặc đoạn văn cần tra." }, { status: 400 });
  if (text.length > 10000) return NextResponse.json({ error: "Nội dung tối đa 10.000 ký tự." }, { status: 400 });
  if (provider !== "openai" && provider !== "gemini") {
    return NextResponse.json({ error: "Nhà cung cấp AI không hợp lệ." }, { status: 400 });
  }
  if (language !== "en" && language !== "ja") {
    return NextResponse.json({ error: "Ngôn ngữ đích không hợp lệ." }, { status: 400 });
  }
  if (!MODELS[provider].includes(model)) {
    return NextResponse.json({ error: "Model AI không được hỗ trợ." }, { status: 400 });
  }

  const apiKey = provider === "openai"
    ? process.env.OPENAI_API_KEY
    : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: `Chưa cấu hình ${provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"} trong môi trường máy chủ.`,
    }, { status: 503 });
  }

  try {
    const prompt = makePrompt(text, language);
    const result = provider === "openai"
      ? await askOpenAI(apiKey, model, prompt)
      : await askGemini(apiKey, model, prompt);
    const vocabulary = normalizeEntries(result, language);
    if (!vocabulary.length) {
      return NextResponse.json({ error: "Không tìm thấy từ vựng phù hợp." }, { status: 422 });
    }
    addVocabularyEntries(user.user_id, language, vocabulary);
    return NextResponse.json({ vocabulary });
  } catch (error) {
    console.error("Vocabulary generation failed:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Không thể xử lý nội dung lúc này.",
    }, { status: 502 });
  }
}