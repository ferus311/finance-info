import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { getFlashcardStudyData, reviewFlashcard } from "@/lib/server/db";

export const runtime = "nodejs";

type Language = "en" | "ja";
type Rating = "again" | "hard" | "good" | "easy";

function parseLanguage(value: unknown): Language | null {
    return value === "en" || value === "ja" ? value : null;
}

export async function GET(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Vui lòng đăng nhập lại." }, { status: 401 });

    const language = parseLanguage(new URL(request.url).searchParams.get("language"));
    if (!language) return NextResponse.json({ error: "Ngôn ngữ không hợp lệ." }, { status: 400 });

    return NextResponse.json(getFlashcardStudyData(user.user_id, language, 30));
}

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Vui lòng đăng nhập lại." }, { status: 401 });

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const language = parseLanguage(body?.targetLanguage);
    const entryId = typeof body?.entryId === "string" ? body.entryId.trim() : "";
    const rating = body?.rating;
    if (!language || !entryId || !["again", "hard", "good", "easy"].includes(String(rating))) {
        return NextResponse.json({ error: "Thông tin ôn tập không hợp lệ." }, { status: 400 });
    }

    const schedule = reviewFlashcard(user.user_id, language, entryId, rating as Rating);
    if (!schedule) return NextResponse.json({ error: "Không tìm thấy thẻ từ vựng." }, { status: 404 });
    return NextResponse.json({ schedule });
}
