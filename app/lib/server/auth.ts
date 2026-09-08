import { cookies } from "next/headers";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createSession, deleteSession, findSession } from "./db";

export const SESSION_COOKIE = "finance_session";
const SESSION_DAYS = 3650;

export function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
    const [salt, expected] = stored.split(":");
    if (!salt || !expected) return false;
    const actual = scryptSync(password, salt, 64);
    const expectedBuffer = Buffer.from(expected, "hex");
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export async function getCurrentUser() {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    return token ? findSession(hashToken(token)) : undefined;
}

export function hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}

export async function startSession(userId: string) {
    const rawToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    createSession(hashToken(rawToken), userId, expiresAt);
    (await cookies()).set(SESSION_COOKIE, rawToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_DAYS * 24 * 60 * 60,
        path: "/",
    });
}

export async function endSession() {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (token) deleteSession(hashToken(token));
    cookieStore.delete(SESSION_COOKIE);
}
