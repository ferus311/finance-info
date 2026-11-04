import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import {
    getFlashcardStudyData,
    getMindmapFlashcardStudyData,
    reviewFlashcard,
    reviewMindmapFlashcard,
} from "@/lib/server/db";

export const runtime = "nodejs";

type Language = "en" | "ja" | "vi";
type Rating = "again" | "hard" | "good" | "easy";
type CardType = "vocabulary" | "mindmap";

function parseLanguage(value: unknown): Language | null {
    return value === "en" || value === "ja" || value === "vi" ? value : null;
}

export async function GET(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const searchParams = new URL(request.url).searchParams;
    const deck = searchParams.get("deck") ?? "vocabulary";
    if (deck === "mindmap") {
        const notebookId = searchParams.get("notebookId")?.trim() || undefined;
        const studyData = getMindmapFlashcardStudyData(user.user_id, notebookId);
        return NextResponse.json({
            ...studyData,
            cards: studyData.cards.map((card) => ({ ...card, type: "mindmap" as const })),
        });
    }
    if (deck !== "vocabulary") {
        return NextResponse.json({ error: "Invalid flashcard deck." }, { status: 400 });
    }

    const language = searchParams.get("language");
    if (language !== "en" && language !== "ja") {
        return NextResponse.json({ error: "Invalid vocabulary language." }, { status: 400 });
    }
    const vocabulary = getFlashcardStudyData(user.user_id, language, 30);
    return NextResponse.json({
        ...vocabulary,
        cards: vocabulary.cards.map((card) => ({ ...card, type: "vocabulary" as const })),
    });
}

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const language = parseLanguage(body?.targetLanguage);
    const entryId = typeof body?.entryId === "string" ? body.entryId.trim() : "";
    const rating = body?.rating;
    const cardType: CardType | null = body?.cardType === undefined || body.cardType === "vocabulary"
        ? "vocabulary"
        : body.cardType === "mindmap" ? "mindmap" : null;
    if (!language || !entryId || !cardType || !["again", "hard", "good", "easy"].includes(String(rating))) {
        return NextResponse.json({ error: "Invalid review details." }, { status: 400 });
    }

    if (cardType === "vocabulary" && language === "vi") {
        return NextResponse.json({ error: "Invalid vocabulary language." }, { status: 400 });
    }

    const schedule = cardType === "mindmap"
        ? reviewMindmapFlashcard(user.user_id, language, entryId, rating as Rating)
        : reviewFlashcard(user.user_id, language as "en" | "ja", entryId, rating as Rating);
    if (!schedule) return NextResponse.json({ error: "Flashcard not found." }, { status: 404 });
    return NextResponse.json({ schedule });
}
