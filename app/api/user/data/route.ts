import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { getUserData, updateUserData } from "@/lib/server/db";

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const data = getUserData(user.user_id);
    return NextResponse.json({
        watchlist: JSON.parse(data.watchlist),
        scenarios: JSON.parse(data.scenarios),
    });
}

export async function PATCH(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null) as { watchlist?: unknown; scenarios?: unknown } | null;
    if (body && Object.hasOwn(body, "watchlist")) updateUserData(user.user_id, "watchlist", body.watchlist);
    if (body && Object.hasOwn(body, "scenarios")) updateUserData(user.user_id, "scenarios", body.scenarios);
    return NextResponse.json({ ok: true });
}
