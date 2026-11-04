import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import {
    deleteMindmapFlashcard,
    getMindmapFlashcards,
    updateMindmapFlashcard,
} from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    return NextResponse.json({ cards: getMindmapFlashcards(user.user_id) });
}

export async function PATCH(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const front = typeof body?.front === "string" ? body.front.trim() : "";
    const context = typeof body?.context === "string" ? body.context.trim() : "";
    const children = Array.isArray(body?.children)
        ? body.children.filter((child): child is string => typeof child === "string").map((child) => child.trim()).filter(Boolean)
        : [];
    if (!id || !front || front.length > 10000 || context.length > 10000
        || children.length === 0 || children.length > 100
        || children.some((child) => child.length > 10000)
        || children.length !== (body?.children as unknown[] | undefined)?.length) {
        return NextResponse.json({ error: "Enter a front, context, and at least one valid answer." }, { status: 400 });
    }

    const card = updateMindmapFlashcard(user.user_id, { id, front, context, children });
    if (!card) return NextResponse.json({ error: "Flashcard not found." }, { status: 404 });
    return NextResponse.json({ card });
}

export async function DELETE(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!id) return NextResponse.json({ error: "A flashcard id is required." }, { status: 400 });
    if (!deleteMindmapFlashcard(user.user_id, id)) {
        return NextResponse.json({ error: "Flashcard not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
}
