import { NextResponse } from "next/server";
import { findUserByEmail } from "@/lib/server/db";
import { startSession, verifyPassword } from "@/lib/server/auth";

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";
    const user = findUserByEmail(email);

    if (!user || !verifyPassword(password, user.password_hash)) {
        return NextResponse.json({ error: "Email hoặc mật khẩu không đúng." }, { status: 401 });
    }

    await startSession(user.id);
    return NextResponse.json({ user: { id: user.id, email: user.email } });
}
