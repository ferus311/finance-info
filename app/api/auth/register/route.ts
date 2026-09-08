import { NextResponse } from "next/server";
import { createUser, findUserByEmail } from "@/lib/server/db";
import { hashPassword, startSession } from "@/lib/server/auth";

export async function POST(request: Request) {
    const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";

    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
        return NextResponse.json({ error: "Email hợp lệ và mật khẩu tối thiểu 8 ký tự." }, { status: 400 });
    }
    if (findUserByEmail(email)) {
        return NextResponse.json({ error: "Email này đã được đăng ký." }, { status: 409 });
    }

    const userId = crypto.randomUUID();
    createUser(userId, email, hashPassword(password));
    await startSession(userId);
    return NextResponse.json({ user: { id: userId, email } }, { status: 201 });
}
