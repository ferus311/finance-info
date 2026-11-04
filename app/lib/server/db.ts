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
    CREATE TABLE IF NOT EXISTS vocabulary_entries (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_language TEXT NOT NULL CHECK (target_language IN ('en', 'ja')),
        id TEXT NOT NULL,
        entry_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, target_language, id)
    );
    CREATE TABLE IF NOT EXISTS flashcard_srs (
        user_id TEXT NOT NULL,
        target_language TEXT NOT NULL CHECK (target_language IN ('en', 'ja')),
        entry_id TEXT NOT NULL,
        due_at TEXT NOT NULL,
        interval_days INTEGER NOT NULL DEFAULT 0,
        ease_factor REAL NOT NULL DEFAULT 2.5,
        repetitions INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        last_reviewed_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, target_language, entry_id)
    );
    CREATE INDEX IF NOT EXISTS idx_flashcard_srs_due
        ON flashcard_srs (user_id, target_language, due_at);
    CREATE TABLE IF NOT EXISTS mindmap_flashcards (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        target_language TEXT NOT NULL CHECK (target_language IN ('en', 'ja', 'vi')),
        notebook_id TEXT NOT NULL,
        notebook_title TEXT NOT NULL DEFAULT '',
        node_id TEXT NOT NULL,
        front TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '',
        children_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, id),
        UNIQUE (user_id, target_language, node_id)
    );
    CREATE TABLE IF NOT EXISTS mindmap_flashcard_srs (
        user_id TEXT NOT NULL,
        target_language TEXT NOT NULL CHECK (target_language IN ('en', 'ja', 'vi')),
        card_id TEXT NOT NULL,
        due_at TEXT NOT NULL,
        interval_days INTEGER NOT NULL DEFAULT 0,
        ease_factor REAL NOT NULL DEFAULT 2.5,
        repetitions INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        last_reviewed_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, target_language, card_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mindmap_flashcard_srs_due
        ON mindmap_flashcard_srs (user_id, target_language, due_at);
`);
const mindmapFlashcardColumns = database.pragma("table_info(mindmap_flashcards)") as Array<{ name: string }>;
if (!mindmapFlashcardColumns.some((column) => column.name === "notebook_title")) {
    database.exec("ALTER TABLE mindmap_flashcards ADD COLUMN notebook_title TEXT NOT NULL DEFAULT ''");
}

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

type VocabularyLanguage = "en" | "ja";
export type MindmapFlashcardLanguage = VocabularyLanguage | "vi";
export type MindmapFlashcard = {
    id: string;
    language: MindmapFlashcardLanguage;
    notebookId: string;
    notebookTitle: string;
    nodeId: string;
    front: string;
    context: string;
    children: string[];
};
type StoredVocabularyEntry = { id: string; word?: string };

function normalizeVocabularyWord(word: unknown) {
    return typeof word === "string" ? word.normalize("NFKC").trim().toLocaleLowerCase() : "";
}

export function saveMindmapFlashcard(
    userId: string,
    card: {
        id: string;
        language: MindmapFlashcardLanguage;
        notebookId: string;
        notebookTitle: string;
        nodeId: string;
        front: string;
        context: string;
        children: string[];
    },
) {
    const now = new Date().toISOString();
    return database.transaction(() => {
        const existing = database.prepare(`
            SELECT id FROM mindmap_flashcards
            WHERE user_id = ? AND node_id = ?
            ORDER BY created_at DESC LIMIT 1
        `).get(userId, card.nodeId) as { id: string } | undefined;
        if (existing) {
            database.prepare(`
                UPDATE mindmap_flashcards
                SET notebook_id = ?, notebook_title = ?, front = ?, context = ?, children_json = ?, updated_at = ?
                WHERE user_id = ? AND id = ?
            `).run(
                card.notebookId, card.notebookTitle, card.front, card.context,
                JSON.stringify(card.children), now, userId, existing.id,
            );
            return existing.id;
        }

        database.prepare(`
            INSERT INTO mindmap_flashcards
                (user_id, id, target_language, notebook_id, notebook_title, node_id, front, context, children_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId, card.id, card.language, card.notebookId, card.notebookTitle, card.nodeId,
            card.front, card.context, JSON.stringify(card.children), now, now,
        );
        return card.id;
    })();
}

export function getMindmapFlashcards(userId: string): MindmapFlashcard[] {
    const rows = database.prepare(`
        SELECT id, target_language, notebook_id, notebook_title, node_id,
            front, context, children_json
        FROM mindmap_flashcards
        WHERE user_id = ?
        ORDER BY updated_at DESC, created_at DESC
    `).all(userId) as Array<{
        id: string;
        target_language: MindmapFlashcardLanguage;
        notebook_id: string;
        notebook_title: string;
        node_id: string;
        front: string;
        context: string;
        children_json: string;
    }>;
    return rows.map((row) => ({
        id: row.id,
        language: row.target_language,
        notebookId: row.notebook_id,
        notebookTitle: row.notebook_title,
        nodeId: row.node_id,
        front: row.front,
        context: row.context,
        children: JSON.parse(row.children_json) as string[],
    }));
}

export function updateMindmapFlashcard(
    userId: string,
    card: Pick<MindmapFlashcard, "id" | "front" | "context" | "children">,
) {
    const result = database.prepare(`
        UPDATE mindmap_flashcards
        SET front = ?, context = ?, children_json = ?, updated_at = ?
        WHERE user_id = ? AND id = ?
    `).run(card.front, card.context, JSON.stringify(card.children), new Date().toISOString(), userId, card.id);
    if (result.changes === 0) return null;
    return getMindmapFlashcards(userId).find((entry) => entry.id === card.id) ?? null;
}

export function deleteMindmapFlashcard(userId: string, id: string) {
    return database.transaction(() => {
        database.prepare(`
            DELETE FROM mindmap_flashcard_srs
            WHERE user_id = ? AND card_id = ?
        `).run(userId, id);
        return database.prepare(`
            DELETE FROM mindmap_flashcards
            WHERE user_id = ? AND id = ?
        `).run(userId, id).changes > 0;
    })();
}

export function getMindmapFlashcardStudyData(
    userId: string,
    notebookId?: string,
    limit = 30,
) {
    const now = new Date().toISOString();
    const stats = database.prepare(`
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN s.card_id IS NULL THEN 1 ELSE 0 END), 0) AS new_count,
            COALESCE(SUM(CASE WHEN s.card_id IS NOT NULL AND s.due_at <= ? THEN 1 ELSE 0 END), 0) AS due_count
        FROM mindmap_flashcards c
        LEFT JOIN mindmap_flashcard_srs s
            ON s.user_id = c.user_id
            AND s.target_language = c.target_language
            AND s.card_id = c.id
        WHERE c.user_id = ? AND (? IS NULL OR c.notebook_id = ?)
    `).get(now, userId, notebookId ?? null, notebookId ?? null) as { total: number; new_count: number; due_count: number };
    const notebooks = database.prepare(`
        SELECT c.notebook_id AS id, c.notebook_title AS title,
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN s.card_id IS NULL THEN 1 ELSE 0 END), 0) AS new_count,
            COALESCE(SUM(CASE WHEN s.card_id IS NOT NULL AND s.due_at <= ? THEN 1 ELSE 0 END), 0) AS due_count
        FROM mindmap_flashcards c
        LEFT JOIN mindmap_flashcard_srs s
            ON s.user_id = c.user_id
            AND s.target_language = c.target_language
            AND s.card_id = c.id
        WHERE c.user_id = ?
        GROUP BY c.notebook_id, c.notebook_title
        ORDER BY c.notebook_title COLLATE NOCASE
    `).all(now, userId) as Array<{
        id: string;
        title: string;
        total: number;
        new_count: number;
        due_count: number;
    }>;
    const rows = database.prepare(`
        SELECT c.id, c.target_language, c.notebook_id, c.notebook_title,
            c.node_id, c.front, c.context, c.children_json,
            s.due_at, s.interval_days, s.ease_factor, s.repetitions, s.lapses, s.last_reviewed_at
        FROM mindmap_flashcards c
        LEFT JOIN mindmap_flashcard_srs s
            ON s.user_id = c.user_id
            AND s.target_language = c.target_language
            AND s.card_id = c.id
        WHERE c.user_id = ? AND (? IS NULL OR c.notebook_id = ?)
            AND (s.card_id IS NULL OR s.due_at <= ?)
        ORDER BY CASE WHEN s.card_id IS NULL THEN 1 ELSE 0 END,
            s.due_at ASC, c.created_at DESC
        LIMIT ?
    `).all(userId, notebookId ?? null, notebookId ?? null, now, limit) as Array<{
        id: string;
        target_language: MindmapFlashcardLanguage;
        notebook_id: string;
        notebook_title: string;
        node_id: string;
        front: string;
        context: string;
        children_json: string;
        due_at: string | null;
        interval_days: number | null;
        ease_factor: number | null;
        repetitions: number | null;
        lapses: number | null;
        last_reviewed_at: string | null;
    }>;

    return {
        total: stats.total,
        newCount: stats.new_count,
        dueCount: stats.due_count,
        notebooks: notebooks.map((notebook) => ({
            id: notebook.id,
            title: notebook.title,
            total: notebook.total,
            newCount: notebook.new_count,
            dueCount: notebook.due_count,
        })),
        cards: rows.map((row) => ({
            entry: {
                id: row.id,
                language: row.target_language,
                notebookId: row.notebook_id,
                notebookTitle: row.notebook_title,
                nodeId: row.node_id,
                front: row.front,
                context: row.context,
                children: JSON.parse(row.children_json) as string[],
            },
            state: row.due_at === null ? null : {
                dueAt: row.due_at,
                intervalDays: row.interval_days ?? 0,
                easeFactor: row.ease_factor ?? 2.5,
                repetitions: row.repetitions ?? 0,
                lapses: row.lapses ?? 0,
                lastReviewedAt: row.last_reviewed_at,
            },
        })),
    };
}

export function getVocabularyEntries(userId: string, language: VocabularyLanguage) {
    const rows = database.prepare(`
        SELECT entry_json FROM vocabulary_entries
        WHERE user_id = ? AND target_language = ?
        ORDER BY created_at DESC, rowid DESC
    `).all(userId, language) as Array<{ entry_json: string }>;
    return rows.map((row) => JSON.parse(row.entry_json) as unknown);
}

export function addVocabularyEntries(
    userId: string,
    language: VocabularyLanguage,
    entries: StoredVocabularyEntry[],
) {
    const insert = database.prepare(`
        INSERT OR IGNORE INTO vocabulary_entries
            (user_id, target_language, id, entry_json, created_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    const existingRows = database.prepare(`
        SELECT entry_json FROM vocabulary_entries
        WHERE user_id = ? AND target_language = ?
    `);
    const createdAt = new Date().toISOString();
    const saveEntries = database.transaction((items: StoredVocabularyEntry[]) => {
        const knownWords = new Set(
            (existingRows.all(userId, language) as Array<{ entry_json: string }>).map((row) => {
                try {
                    return normalizeVocabularyWord((JSON.parse(row.entry_json) as { word?: unknown }).word);
                } catch {
                    return "";
                }
            }).filter(Boolean),
        );
        const candidates: StoredVocabularyEntry[] = [];
        for (const entry of items) {
            const word = normalizeVocabularyWord(entry.word);
            if (!word || knownWords.has(word)) continue;
            knownWords.add(word);
            candidates.push(entry);
        }

        const inserted: StoredVocabularyEntry[] = [];
        for (const entry of candidates.reverse()) {
            const result = insert.run(userId, language, entry.id, JSON.stringify(entry), createdAt);
            if (result.changes > 0) inserted.push(entry);
        }
        return inserted.reverse();
    });
    return saveEntries(entries);
}

export type FlashcardRating = "again" | "hard" | "good" | "easy";

type FlashcardStateRow = {
    due_at: string;
    interval_days: number;
    ease_factor: number;
    repetitions: number;
    lapses: number;
    last_reviewed_at: string | null;
};

function calculateFlashcardSchedule(
    previous: FlashcardStateRow | undefined,
    rating: FlashcardRating,
) {
    const now = new Date();
    const nowIso = now.toISOString();
    const oldRepetitions = previous?.repetitions ?? 0;
    const oldInterval = previous?.interval_days ?? 0;
    let easeFactor = previous?.ease_factor ?? 2.5;
    let intervalDays: number;
    let repetitions: number;
    let lapses = previous?.lapses ?? 0;
    let dueAt: Date;

    if (rating === "again") {
        intervalDays = 0;
        repetitions = 0;
        dueAt = new Date(now.getTime() + 10 * 60 * 1000);
        if (oldRepetitions > 0) {
            easeFactor = Math.max(1.3, easeFactor - 0.2);
            lapses += 1;
        }
    } else {
        repetitions = oldRepetitions + 1;
        if (rating === "hard") {
            intervalDays = oldRepetitions === 0 ? 1 : Math.max(1, Math.round(oldInterval * 1.2));
            easeFactor = Math.max(1.3, easeFactor - 0.15);
        } else if (rating === "good") {
            intervalDays = oldRepetitions === 0 ? 1 : oldRepetitions === 1 ? 3 : Math.max(1, Math.round(oldInterval * easeFactor));
        } else {
            intervalDays = oldRepetitions === 0 ? 4 : Math.max(1, Math.round(oldInterval * easeFactor * 1.3));
            easeFactor += 0.15;
        }
        dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    }

    return {
        dueAt: dueAt.toISOString(),
        intervalDays,
        easeFactor,
        repetitions,
        lapses,
        lastReviewedAt: nowIso,
    };
}

export function getFlashcardStudyData(userId: string, language: VocabularyLanguage, limit = 30) {
    const now = new Date().toISOString();
    const stats = database.prepare(`
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN s.entry_id IS NULL THEN 1 ELSE 0 END), 0) AS new_count,
            COALESCE(SUM(CASE WHEN s.entry_id IS NOT NULL AND s.due_at <= ? THEN 1 ELSE 0 END), 0) AS due_count
        FROM vocabulary_entries v
        LEFT JOIN flashcard_srs s
            ON s.user_id = v.user_id
            AND s.target_language = v.target_language
            AND s.entry_id = v.id
        WHERE v.user_id = ? AND v.target_language = ?
    `).get(now, userId, language) as { total: number; new_count: number; due_count: number };
    const rows = database.prepare(`
        SELECT v.entry_json, s.due_at, s.interval_days, s.ease_factor,
            s.repetitions, s.lapses, s.last_reviewed_at
        FROM vocabulary_entries v
        LEFT JOIN flashcard_srs s
            ON s.user_id = v.user_id
            AND s.target_language = v.target_language
            AND s.entry_id = v.id
        WHERE v.user_id = ? AND v.target_language = ?
            AND (s.entry_id IS NULL OR s.due_at <= ?)
        ORDER BY CASE WHEN s.entry_id IS NULL THEN 1 ELSE 0 END,
            s.due_at ASC, v.created_at DESC, v.rowid DESC
        LIMIT ?
    `).all(userId, language, now, limit) as Array<{
        entry_json: string;
        due_at: string | null;
        interval_days: number | null;
        ease_factor: number | null;
        repetitions: number | null;
        lapses: number | null;
        last_reviewed_at: string | null;
    }>;

    return {
        total: stats.total,
        newCount: stats.new_count,
        dueCount: stats.due_count,
        cards: rows.map((row) => ({
            entry: JSON.parse(row.entry_json) as unknown,
            state: row.due_at === null ? null : {
                dueAt: row.due_at,
                intervalDays: row.interval_days ?? 0,
                easeFactor: row.ease_factor ?? 2.5,
                repetitions: row.repetitions ?? 0,
                lapses: row.lapses ?? 0,
                lastReviewedAt: row.last_reviewed_at,
            },
        })),
    };
}

export function reviewFlashcard(
    userId: string,
    language: VocabularyLanguage,
    entryId: string,
    rating: FlashcardRating,
) {
    const review = database.transaction(() => {
        const exists = database.prepare(`
            SELECT 1 FROM vocabulary_entries
            WHERE user_id = ? AND target_language = ? AND id = ?
        `).get(userId, language, entryId);
        if (!exists) return null;

        const previous = database.prepare(`
            SELECT due_at, interval_days, ease_factor, repetitions, lapses, last_reviewed_at
            FROM flashcard_srs
            WHERE user_id = ? AND target_language = ? AND entry_id = ?
        `).get(userId, language, entryId) as FlashcardStateRow | undefined;
        const nowIso = new Date().toISOString();
        const schedule = calculateFlashcardSchedule(previous, rating);
        database.prepare(`
            INSERT INTO flashcard_srs
                (user_id, target_language, entry_id, due_at, interval_days, ease_factor,
                    repetitions, lapses, last_reviewed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, target_language, entry_id) DO UPDATE SET
                due_at = excluded.due_at,
                interval_days = excluded.interval_days,
                ease_factor = excluded.ease_factor,
                repetitions = excluded.repetitions,
                lapses = excluded.lapses,
                last_reviewed_at = excluded.last_reviewed_at,
                updated_at = excluded.updated_at
        `).run(
            userId, language, entryId, schedule.dueAt, schedule.intervalDays, schedule.easeFactor,
            schedule.repetitions, schedule.lapses, schedule.lastReviewedAt, nowIso,
        );
        return schedule;
    });

    return review();
}

export function reviewMindmapFlashcard(
    userId: string,
    language: MindmapFlashcardLanguage,
    cardId: string,
    rating: FlashcardRating,
) {
    const review = database.transaction(() => {
        const exists = database.prepare(`
            SELECT 1 FROM mindmap_flashcards
            WHERE user_id = ? AND target_language = ? AND id = ?
        `).get(userId, language, cardId);
        if (!exists) return null;

        const previous = database.prepare(`
            SELECT due_at, interval_days, ease_factor, repetitions, lapses, last_reviewed_at
            FROM mindmap_flashcard_srs
            WHERE user_id = ? AND target_language = ? AND card_id = ?
        `).get(userId, language, cardId) as FlashcardStateRow | undefined;
        const schedule = calculateFlashcardSchedule(previous, rating);
        const updatedAt = new Date().toISOString();
        database.prepare(`
            INSERT INTO mindmap_flashcard_srs
                (user_id, target_language, card_id, due_at, interval_days, ease_factor,
                    repetitions, lapses, last_reviewed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, target_language, card_id) DO UPDATE SET
                due_at = excluded.due_at,
                interval_days = excluded.interval_days,
                ease_factor = excluded.ease_factor,
                repetitions = excluded.repetitions,
                lapses = excluded.lapses,
                last_reviewed_at = excluded.last_reviewed_at,
                updated_at = excluded.updated_at
        `).run(
            userId, language, cardId, schedule.dueAt, schedule.intervalDays, schedule.easeFactor,
            schedule.repetitions, schedule.lapses, schedule.lastReviewedAt, updatedAt,
        );
        return schedule;
    });

    return review();
}

export function updateVocabularyEntry(
    userId: string,
    language: VocabularyLanguage,
    entry: StoredVocabularyEntry,
) {
    return database.prepare(`
        UPDATE vocabulary_entries SET entry_json = ?
        WHERE user_id = ? AND target_language = ? AND id = ?
    `).run(JSON.stringify(entry), userId, language, entry.id).changes > 0;
}

export function deleteVocabularyEntry(userId: string, language: VocabularyLanguage, id: string) {
    return database.transaction(() => {
        database.prepare(`
            DELETE FROM flashcard_srs
            WHERE user_id = ? AND target_language = ? AND entry_id = ?
        `).run(userId, language, id);
        return database.prepare(`
            DELETE FROM vocabulary_entries
            WHERE user_id = ? AND target_language = ? AND id = ?
        `).run(userId, language, id).changes > 0;
    })();
}
