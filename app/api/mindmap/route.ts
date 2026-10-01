import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DB_PATH = process.env.MINDMAP_DB_PATH || '/home/fong/project_ai/finance-info/data/finance.sqlite';
const IMAGE_DIR = join(dirname(DB_PATH), 'mindmap_images');

interface NodeRow {
    id: string; notebook_id: string; parent_id: string | null;
    text: string; x: number; y: number;
    type: string; width: number; height: number;
    auto_width: number;
    image_url: string | null; preserve_aspect: number; color: string | null;
    text_align: 'left' | 'center' | 'right';
    created_at: string; updated_at: string;
}

declare global { var __mindmapDb: Database.Database | undefined; }

function getDb(): Database.Database {
    let db = global.__mindmapDb;
    if (!db) {
        const dir = dirname(DB_PATH);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        if (!existsSync(IMAGE_DIR)) mkdirSync(IMAGE_DIR, { recursive: true });

        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        global.__mindmapDb = db;
    }

    // Khởi tạo bảng cơ sở
    db.exec(`
    CREATE TABLE IF NOT EXISTS mindmap_notebooks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mindmap_nodes (
      id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES mindmap_notebooks(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES mindmap_nodes(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '', x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
        CREATE TABLE IF NOT EXISTS mindmap_notebook_groups (
            name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    CREATE INDEX IF NOT EXISTS idx_mindmap_nodes_notebook ON mindmap_nodes(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_mindmap_nodes_parent ON mindmap_nodes(parent_id);
  `);

    // Safe Migrations: Tự động thêm cột tính năng mới nếu chưa có
    const addCol = (query: string) => { try { db.exec(query); } catch (e) { /* Cột đã tồn tại */ } };
    addCol("ALTER TABLE mindmap_notebooks ADD COLUMN deleted_at TEXT DEFAULT NULL");
    addCol("ALTER TABLE mindmap_notebooks ADD COLUMN group_name TEXT NOT NULL DEFAULT ''");
    addCol("ALTER TABLE mindmap_notebooks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN type TEXT DEFAULT 'text'");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN width REAL DEFAULT 208");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN height REAL DEFAULT 60");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN auto_width INTEGER NOT NULL DEFAULT 1");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN image_url TEXT DEFAULT NULL");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN preserve_aspect INTEGER DEFAULT 1");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN color TEXT DEFAULT NULL");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN text_align TEXT NOT NULL DEFAULT 'center'");
    db.exec(`INSERT OR IGNORE INTO mindmap_notebook_groups (name)
            SELECT DISTINCT group_name FROM mindmap_notebooks WHERE TRIM(group_name) <> ''`);

    return db;
}

function nowIso() { return new Date().toISOString(); }
function badRequest(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }
function serverError(err: unknown) { console.error('[mindmap api]', err); return NextResponse.json({ error: 'Database error' }, { status: 500 }); }

export async function GET(req: NextRequest) {
    const resource = req.nextUrl.searchParams.get('resource');
    const db = getDb();

    try {
        // Phục vụ file ảnh vật lý
        if (resource === 'image_file') {
            const fileName = req.nextUrl.searchParams.get('name');
            if (!fileName || fileName.includes('..')) return badRequest('Invalid filename');
            const filePath = join(IMAGE_DIR, fileName);
            if (!existsSync(filePath)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
            const buffer = readFileSync(filePath);
            return new NextResponse(buffer, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' } });
        }

        if (resource === 'notebooks') {
            const rows = db.prepare(`SELECT n.* FROM mindmap_notebooks n
                LEFT JOIN mindmap_notebook_groups g ON g.name = n.group_name
                WHERE n.deleted_at IS NULL
                ORDER BY CASE WHEN n.group_name = '' THEN 1 ELSE 0 END, g.sort_order, n.group_name COLLATE NOCASE, n.sort_order, n.created_at`).all();
            const groups = db.prepare('SELECT name, sort_order FROM mindmap_notebook_groups ORDER BY sort_order, name COLLATE NOCASE').all();
            return NextResponse.json({ notebooks: rows, groups });
        }

        if (resource === 'nodes') {
            const notebookId = req.nextUrl.searchParams.get('notebookId');
            if (!notebookId) return badRequest('notebookId is required');
            const rows = db.prepare('SELECT * FROM mindmap_nodes WHERE notebook_id = ? ORDER BY created_at ASC').all(notebookId);
            return NextResponse.json({ nodes: rows });
        }

        return badRequest('Unknown resource');
    } catch (err) { return serverError(err); }
}

export async function POST(req: NextRequest) {
    const db = getDb();
    try {
        const body = await req.json();

        // Upload Base64 thành file
        if (body.resource === 'upload') {
            const { base64 } = body;
            const buffer = Buffer.from(base64.split(',')[1], 'base64');
            const fileName = `${randomUUID()}.png`;
            writeFileSync(join(IMAGE_DIR, fileName), buffer);
            return NextResponse.json({ url: `/api/mindmap?resource=image_file&name=${fileName}` });
        }

        if (body.resource === 'notebook') {
            const id = body.id || randomUUID();
            const rootId = body.rootId || randomUUID();
            const title = String(body.title || 'Untitled notebook').slice(0, 120);
            const sortOrderRow = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM mindmap_notebooks WHERE group_name = ? AND deleted_at IS NULL').get(String(body.groupName || '')) as { next_order: number } | undefined;
            const sortOrder = Number(sortOrderRow?.next_order ?? 0);

            const insertBoth = db.transaction(() => {
                db.prepare('INSERT INTO mindmap_notebooks (id, title, group_name, sort_order) VALUES (?, ?, ?, ?)').run(id, title, String(body.groupName || '').slice(0, 80), sortOrder);
                db.prepare(`INSERT INTO mindmap_nodes (id, notebook_id, parent_id, text, x, y, type, width, height)
                    VALUES (?, ?, NULL, ?, 0, 0, 'text', 208, 60)`).run(rootId, id, 'Central idea');
            });
            insertBoth();
            return NextResponse.json({ ok: true });
        }

        if (body.resource === 'group') {
            const name = String(body.name || '').trim().slice(0, 80);
            if (!name) return badRequest('Group name is required');
            const nextOrderRow = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM mindmap_notebook_groups').get() as { next_order: number } | undefined;
            const nextOrder = Number(nextOrderRow?.next_order ?? 0);
            db.prepare('INSERT OR IGNORE INTO mindmap_notebook_groups (name, sort_order) VALUES (?, ?)').run(name, nextOrder);
            return NextResponse.json({ ok: true });
        }

        if (body.resource === 'node') {
            const { notebookId, parentId = null, text = '', x = 0, y = 0, type = 'text', width = 208, height = 60, autoWidth = true, imageUrl = null, preserveAspect = 1, color = null } = body;
            if (!notebookId) return badRequest('notebookId is required');
            const id = body.id || randomUUID();

            db.prepare(`INSERT INTO mindmap_nodes (id, notebook_id, parent_id, text, x, y, type, width, height, auto_width, image_url, preserve_aspect, color)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(id, notebookId, parentId, text, x, y, type, width, height, Number(Boolean(autoWidth)), imageUrl, preserveAspect, color);

            const node = db.prepare('SELECT * FROM mindmap_nodes WHERE id = ?').get(id);
            return NextResponse.json({ node });
        }
        return badRequest('Unknown resource');
    } catch (err) { return serverError(err); }
}

export async function PATCH(req: NextRequest) {
    const db = getDb();
    try {
        const body = await req.json();

        if (body.resource === 'notebook') {
            if (body.action === 'restore') {
                db.prepare('UPDATE mindmap_notebooks SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), body.id);
                return NextResponse.json({ ok: true });
            }

            if (body.action === 'reorder') {
                const updateOrder = db.prepare('UPDATE mindmap_notebooks SET sort_order = ?, group_name = COALESCE(?, group_name), updated_at = ? WHERE id = ? AND deleted_at IS NULL');
                const applyOrder = db.transaction((items: { id: string; sortOrder: number; groupName?: string }[]) => {
                    const ts = nowIso();
                    for (const item of items) {
                        if (item.groupName) db.prepare('INSERT OR IGNORE INTO mindmap_notebook_groups (name) VALUES (?)').run(item.groupName);
                        updateOrder.run(item.sortOrder, item.groupName ?? null, ts, item.id);
                    }
                });
                applyOrder(Array.isArray(body.notebooks) ? body.notebooks : []);
                return NextResponse.json({ ok: true });
            }

            if (body.groupName !== undefined) {
                const groupName = String(body.groupName || '').trim().slice(0, 80);
                if (groupName) db.prepare('INSERT OR IGNORE INTO mindmap_notebook_groups (name) VALUES (?)').run(groupName);
                db.prepare('UPDATE mindmap_notebooks SET group_name = ?, updated_at = ? WHERE id = ?').run(groupName, nowIso(), body.id);
            }

            if (body.title !== undefined) {
                db.prepare('UPDATE mindmap_notebooks SET title = ?, updated_at = ? WHERE id = ?').run(
                    String(body.title || 'Untitled').slice(0, 120), nowIso(), body.id
                );
            }
            return NextResponse.json({ ok: true });
        }

        if (body.resource === 'group' && body.action === 'reorder') {
            const updateOrder = db.prepare('UPDATE mindmap_notebook_groups SET sort_order = ? WHERE name = ?');
            const applyOrder = db.transaction((items: { name: string; sortOrder: number }[]) => {
                for (const item of items) updateOrder.run(item.sortOrder, item.name);
            });
            applyOrder(Array.isArray(body.groups) ? body.groups : []);
            return NextResponse.json({ ok: true });
        }

        if (body.resource === 'node') {
            const { id, text, x, y, width, height, autoWidth, preserveAspect, color, parentId, textAlign, type, imageUrl } = body;
            const existing = db.prepare('SELECT * FROM mindmap_nodes WHERE id = ?').get(id) as NodeRow;
            if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

            if (parentId !== undefined && parentId !== null) {
                const newParent = db.prepare('SELECT id, notebook_id FROM mindmap_nodes WHERE id = ?').get(parentId) as { id: string; notebook_id: string } | undefined;
                if (!newParent || newParent.notebook_id !== existing.notebook_id) return badRequest('Parent must belong to the same notebook');
                const isDescendant = db.prepare(`WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM mindmap_nodes WHERE parent_id = ?
                    UNION ALL SELECT n.id FROM mindmap_nodes n JOIN descendants d ON n.parent_id = d.id
                ) SELECT 1 FROM descendants WHERE id = ? LIMIT 1`).get(id, parentId);
                if (isDescendant || parentId === id) return badRequest('A node cannot be moved under its own descendant');
            }

            const validTextAlign = ['left', 'center', 'right'].includes(textAlign) ? textAlign : existing.text_align || 'center';
            const validType = type === 'image' || type === 'text' ? type : existing.type;
            const savedPreserveAspect = preserveAspect === undefined
                ? existing.preserve_aspect
                : Number(Boolean(preserveAspect));
            const savedAutoWidth = autoWidth === undefined ? existing.auto_width : Number(Boolean(autoWidth));
            db.prepare(`UPDATE mindmap_nodes
                                    SET text = ?, x = ?, y = ?, width = ?, height = ?, auto_width = ?, preserve_aspect = ?, color = ?, parent_id = ?, text_align = ?, type = ?, image_url = ?, updated_at = ?
                  WHERE id = ?`).run(
                text ?? existing.text, x ?? existing.x, y ?? existing.y, width ?? existing.width, height ?? existing.height,
                savedAutoWidth, savedPreserveAspect, color !== undefined ? color : existing.color,
                parentId !== undefined ? parentId : existing.parent_id, validTextAlign, validType,
                imageUrl !== undefined ? imageUrl : existing.image_url, nowIso(), id
            );
            return NextResponse.json({ ok: true });
        }

        if (body.resource === 'nodes-bulk') {
            const stmt = db.prepare('UPDATE mindmap_nodes SET x = ?, y = ?, updated_at = ? WHERE id = ?');
            const applyAll = db.transaction((items: any[]) => {
                const ts = nowIso();
                for (const item of items) stmt.run(item.x, item.y, ts, item.id);
            });
            applyAll(body.nodes || []);
            return NextResponse.json({ ok: true });
        }
        return badRequest('Unknown resource');
    } catch (err) { return serverError(err); }
}

export async function DELETE(req: NextRequest) {
    const resource = req.nextUrl.searchParams.get('resource');
    const id = req.nextUrl.searchParams.get('id');
    const groupName = req.nextUrl.searchParams.get('name');
    if (resource === 'group' ? !groupName : !id) return badRequest(resource === 'group' ? 'Group name is required' : 'id is required');

    try {
        const db = getDb();

        if (resource === 'group') {
            const images = db.prepare(`SELECT n.image_url FROM mindmap_nodes n
                JOIN mindmap_notebooks b ON b.id = n.notebook_id
                WHERE b.group_name = ? AND n.image_url IS NOT NULL`).all(groupName) as { image_url: string }[];
            const deleteGroup = db.transaction(() => {
                db.prepare('DELETE FROM mindmap_notebooks WHERE group_name = ?').run(groupName);
                db.prepare('DELETE FROM mindmap_notebook_groups WHERE name = ?').run(groupName);
            });
            deleteGroup();

            for (const node of images) {
                const match = node.image_url.match(/name=([^&]+)/);
                if (match?.[1] && !match[1].includes('..')) {
                    const filePath = join(IMAGE_DIR, match[1]);
                    if (existsSync(filePath)) try { unlinkSync(filePath); } catch { }
                }
            }
            return NextResponse.json({ ok: true });
        }

        if (resource === 'notebook') {
            db.prepare('UPDATE mindmap_notebooks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
            return NextResponse.json({ ok: true });
        }

        if (resource === 'node') {
            // Dùng CTE đệ quy quét Node hiện tại VÀ TOÀN BỘ các Node con/cháu của nó
            const nodesWithImages = db.prepare(`
        WITH RECURSIVE descendants AS (
          SELECT id, image_url FROM mindmap_nodes WHERE id = ?
          UNION ALL
          SELECT n.id, n.image_url FROM mindmap_nodes n
          INNER JOIN descendants d ON n.parent_id = d.id
        )
        SELECT image_url FROM descendants WHERE image_url IS NOT NULL
      `).all(id) as { image_url: string }[];

            // Xóa các file ảnh vật lý của nhánh sắp bị xóa
            for (const node of nodesWithImages) {
                const match = node.image_url?.match(/name=([^&]+)/);
                if (match && match[1]) {
                    const filePath = join(IMAGE_DIR, match[1]);
                    if (existsSync(filePath)) try { unlinkSync(filePath); } catch (e) { }
                }
            }

            // Xóa data trong DB (SQLite sẽ tự động Cascade xóa node con)
            db.prepare('DELETE FROM mindmap_nodes WHERE id = ?').run(id);
            return NextResponse.json({ ok: true });
        }

        return badRequest('Unknown resource');
    } catch (err) {
        return serverError(err);
    }
}
