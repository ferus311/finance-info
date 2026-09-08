import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const dataDirectory = path.join(process.cwd(), "data");
mkdirSync(dataDirectory, { recursive: true });

const database = new Database(path.join(dataDirectory, "finance.sqlite"));
database.pragma("journal_mode = WAL");
database.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_data (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        watchlist TEXT NOT NULL DEFAULT '{"cryptoSymbols":[],"stockSymbols":[],"vnDate":null}',
        scenarios TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
    );
`);

type UserRow = { id: string; email: string; password_hash: string };
type SessionRow = { user_id: string; email: string };

export function findUserByEmail(email: string) {
    return database.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email) as UserRow | undefined;
}

export function createUser(id: string, email: string, passwordHash: string) {
    const now = new Date().toISOString();
    database.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(id, email, passwordHash, now);
    database.prepare("INSERT INTO user_data (user_id, updated_at) VALUES (?, ?)").run(id, now);
}

export function createSession(token: string, userId: string, expiresAt: string) {
    database.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt);
}

export function deleteSession(token: string) {
    database.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function findSession(token: string) {
    const row = database.prepare(`
        SELECT sessions.user_id, users.email
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = ? AND sessions.expires_at > ?
    `).get(token, new Date().toISOString()) as SessionRow | undefined;
    return row;
}

export function getUserData(userId: string) {
    const row = database.prepare("SELECT watchlist, scenarios FROM user_data WHERE user_id = ?").get(userId) as { watchlist: string; scenarios: string } | undefined;
    return row ?? { watchlist: '{"cryptoSymbols":[],"stockSymbols":[],"vnDate":null}', scenarios: "[]" };
}

export function updateUserData(userId: string, field: "watchlist" | "scenarios", value: unknown) {
    database.prepare(`UPDATE user_data SET ${field} = ?, updated_at = ? WHERE user_id = ?`).run(JSON.stringify(value), new Date().toISOString(), userId);
}
