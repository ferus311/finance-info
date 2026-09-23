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
    image_url: string | null; preserve_aspect: number; color: string | null;
    created_at: string; updated_at: string;
}

declare global { var __mindmapDb: Database.Database | undefined; }

function getDb(): Database.Database {
    if (global.__mindmapDb) return global.__mindmapDb;

    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(IMAGE_DIR)) mkdirSync(IMAGE_DIR, { recursive: true });

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

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
    CREATE INDEX IF NOT EXISTS idx_mindmap_nodes_notebook ON mindmap_nodes(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_mindmap_nodes_parent ON mindmap_nodes(parent_id);
  `);

    // Safe Migrations: Tự động thêm cột tính năng mới nếu chưa có
    const addCol = (query: string) => { try { db.exec(query); } catch (e) { /* Cột đã tồn tại */ } };
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN type TEXT DEFAULT 'text'");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN width REAL DEFAULT 208");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN height REAL DEFAULT 60");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN image_url TEXT DEFAULT NULL");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN preserve_aspect INTEGER DEFAULT 1");
    addCol("ALTER TABLE mindmap_nodes ADD COLUMN color TEXT DEFAULT NULL");

    global.__mindmapDb = db;
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
            const rows = db.prepare('SELECT * FROM mindmap_notebooks ORDER BY created_at ASC').all();
            return NextResponse.json({ notebooks: rows });
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

            const insertBoth = db.transaction(() => {
                db.prepare('INSERT INTO mindmap_notebooks (id, title) VALUES (?, ?)').run(id, title);
                db.prepare(`INSERT INTO mindmap_nodes (id, notebook_id, parent_id, text, x, y, type, width, height)
                    VALUES (?, ?, NULL, ?, 0, 0, 'text', 208, 60)`).run(rootId, id, 'Central idea');
            });
            insertBoth();
            return NextResponse.json({ ok: true });
        }

        if (body.resource === 'node') {
            const { notebookId, parentId = null, text = '', x = 0, y = 0, type = 'text', width = 208, height = 60, imageUrl = null, preserveAspect = 1, color = null } = body;
            if (!notebookId) return badRequest('notebookId is required');
            const id = body.id || randomUUID();

            db.prepare(`INSERT INTO mindmap_nodes (id, notebook_id, parent_id, text, x, y, type, width, height, image_url, preserve_aspect, color)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(id, notebookId, parentId, text, x, y, type, width, height, imageUrl, preserveAspect, color);

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
            db.prepare('UPDATE mindmap_notebooks SET title = ?, updated_at = ? WHERE id = ?').run(
                String(body.title || 'Untitled').slice(0, 120), nowIso(), body.id
            );
            return NextResponse.json({ ok: true });
        }

        if (body.resource === 'node') {
            const { id, text, x, y, width, height, preserveAspect, color } = body;
            const existing = db.prepare('SELECT * FROM mindmap_nodes WHERE id = ?').get(id) as NodeRow;
            if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

            db.prepare(`UPDATE mindmap_nodes
                  SET text = ?, x = ?, y = ?, width = ?, height = ?, preserve_aspect = ?, color = ?, updated_at = ?
                  WHERE id = ?`).run(
                text ?? existing.text, x ?? existing.x, y ?? existing.y, width ?? existing.width, height ?? existing.height,
                preserveAspect ?? existing.preserve_aspect, color !== undefined ? color : existing.color, nowIso(), id
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
  if (!id) return badRequest('id is required');

  try {
    const db = getDb();

    if (resource === 'notebook') {
      // Quét tất cả các node thuộc Notebook này có chứa ảnh
      const nodesWithImages = db.prepare(`
        SELECT image_url FROM mindmap_nodes
        WHERE notebook_id = ? AND image_url IS NOT NULL
      `).all(id) as { image_url: string }[];

      // Xóa toàn bộ file vật lý trước khi xóa Notebook
      for (const node of nodesWithImages) {
        const match = node.image_url?.match(/name=([^&]+)/);
        if (match && match[1]) {
          const filePath = join(IMAGE_DIR, match[1]);
          if (existsSync(filePath)) try { unlinkSync(filePath); } catch (e) {}
        }
      }

      db.prepare('DELETE FROM mindmap_notebooks WHERE id = ?').run(id);
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
          if (existsSync(filePath)) try { unlinkSync(filePath); } catch (e) {}
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
