import { NextResponse } from "next/server";
import kuromoji from "kuromoji";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Block = { id: string; text: string; start: number; end: number };
type Word = { text: string; start: number; end: number };

const DEFAULT_MIN = 7;
const DEFAULT_MAX = 20;
const STRONG = "。！？.!?";
const SOFT = "、，,;；:：";
const NO_SPACE = new Set(["ja", "zh"]); // ngôn ngữ không dùng dấu cách
const EN_WEAK_END = new Set("the a an and or but to of in on at for with that if so because my your our their is are was".split(" "));
const CLOSING_PUNCT = /^[\p{Pe}\p{Pf}\p{Po}]+$/u; // từ chỉ gồm dấu câu -> dính vào từ trước

// ==========================================
// yt-dlp
// ==========================================
function ytDlp(): string {
    const candidates = [process.env.YT_DLP_PATH, "/home/fong/.local/bin/yt-dlp", "/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp"];
    return candidates.find((p): p is string => !!p && fs.existsSync(p)) ?? "yt-dlp";
}

async function fetchJson3(videoId: string, lang: string): Promise<any> {
    const dir = os.tmpdir();
    const prefix = `yt_sub_${videoId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
        await run(
            ytDlp(),
            [
                "--skip-download", "--no-playlist", "--no-warnings",
                "--write-subs", "--write-auto-subs",
                "--sub-langs", `${lang},${lang}-orig`, // KHÔNG dùng "lang-.*" vì sẽ kéo cả bản dịch tự động
                "--sub-format", "json3",
                "-o", path.join(dir, `${prefix}.%(ext)s`),
                `https://www.youtube.com/watch?v=${videoId}`,
            ],
            { timeout: 30000 }
        );
        const files = (await fsp.readdir(dir)).filter((f) => f.startsWith(prefix) && f.endsWith(".json3")).sort((a, b) => a.length - b.length);
        if (!files.length) throw new Error(`No captions available for language "${lang}".`);
        return JSON.parse(await fsp.readFile(path.join(dir, files[0]), "utf-8"));
    } finally {
        for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
            if (f.startsWith(prefix)) await fsp.unlink(path.join(dir, f)).catch(() => { });
        }
    }
}

async function fetchPlaylist(id: string) {
    const { stdout } = await run(
        ytDlp(),
        ["--flat-playlist", "--dump-single-json", "--no-warnings", `https://www.youtube.com/playlist?list=${id}`],
        { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }
    );
    return (JSON.parse(stdout).entries ?? [])
        .filter((e: any) => e?.id)
        .map((e: any) => ({ id: e.id, title: e.title ?? e.id, thumbnail: `https://img.youtube.com/vi/${e.id}/hqdefault.jpg` }));
}

// ==========================================
// json3 -> Word[] (có thời gian bắt đầu / kết thúc ước lượng)
// ==========================================
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function extractWords(json3: any): Word[] {
    const raw: { text: string; start: number; evEnd: number }[] = [];
    for (const ev of json3.events ?? []) {
        if (!ev.segs) continue;
        const base = ev.tStartMs ?? 0;
        const evEnd = (base + (ev.dDurationMs ?? 2000)) / 1000;
        for (const s of ev.segs) {
            const text = decode(String(s.utf8 ?? "")).replace(/\s+/g, " ").trim();
            if (text) raw.push({ text, start: (base + (s.tOffsetMs ?? 0)) / 1000, evEnd });
        }
    }
    raw.sort((a, b) => a.start - b.start);

    const words: Word[] = [];
    raw.forEach((r, i) => {
        const prev = words[words.length - 1];
        if (prev && prev.text === r.text && Math.abs(prev.start - r.start) < 0.05) return; // trùng do rolling caption

        // Sub thủ công: 1 seg = cả câu -> cho phép dài theo số ký tự (trước đây bị cắt cứng 0.6s => lệch nhịp block)
        const cap = r.start + Math.max(0.6, r.text.length * 0.22);
        const nextStart = raw[i + 1] && raw[i + 1].start > r.start ? raw[i + 1].start : Infinity;
        const end = Math.max(r.start + 0.05, Math.min(r.evEnd, cap, nextStart));

        if (prev && CLOSING_PUNCT.test(r.text)) {
            prev.text += r.text;
            prev.end = Math.max(prev.end, end);
        } else {
            words.push({ text: r.text, start: r.start, end });
        }
    });
    return words;
}

// ==========================================
// Kuromoji (lazy)
// ==========================================
let tokenizerPromise: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null> | null = null;
function getTokenizer() {
    tokenizerPromise ??= new Promise((resolve) => {
        let dicPath = path.join(process.cwd(), "node_modules", "kuromoji", "dict");
        if (!fs.existsSync(dicPath)) dicPath = path.join(process.cwd(), "public", "dict");
        kuromoji.builder({ dicPath }).build((err, t) => resolve(err ? null : t));
    });
    return tokenizerPromise;
}

// Phạt khi cắt sau từ i (tiếng Nhật): cắt giữa từ / trước trợ từ / sau tiếp đầu ngữ là rất tệ
function japanesePenalties(words: Word[], tok: kuromoji.Tokenizer<kuromoji.IpadicFeatures>): number[] {
    const tokens = tok.tokenize(words.map((w) => w.text).join(""));
    const byEnd = new Map<number, number>();
    tokens.forEach((t, k) => byEnd.set(t.word_position - 1 + t.surface_form.length, k));
    const dependent = (x?: kuromoji.IpadicFeatures) => !!x && (x.pos === "助動詞" || x.pos === "助詞" || ["接尾", "非自立"].includes(x.pos_detail_1));

    let acc = 0;
    return words.map((w) => {
        acc += w.text.length;
        const k = byEnd.get(acc);
        if (k === undefined) return 12; // cắt giữa một từ
        const t = tokens[k];
        if (t.pos === "接頭詞") return 12;
        if (dependent(tokens[k + 1])) return 8; // câu còn dang dở: 食べ|ます, 行っ|て
        if (t.pos === "助詞" && ["格助詞", "連体化"].includes(t.pos_detail_1)) return 5; // を, に, の...
        return ["助詞", "助動詞", "記号"].includes(t.pos) ? 0 : 3;
    });
}

// ==========================================
// Chia block bằng quy hoạch động: tối thiểu hoá (chi phí điểm cắt + chi phí độ dài)
// ==========================================
function segment(words: Word[], lang: string, min: number, max: number, grammar: number[] | null): [number, number][] {
    const n = words.length;
    const silence = NO_SPACE.has(lang) ? 0.8 : 1.0;
    const target = (min + max) / 2;

    // Chi phí khi cắt ngay sau từ i (càng thấp càng tự nhiên)
    const cutCost = (i: number) => {
        if (i === n - 1) return 0;
        const text = words[i].text;
        if (STRONG.includes(text.slice(-1))) return 0;
        const gap = words[i + 1].start - words[i].end;
        let c = gap >= silence ? 2 : gap >= 0.4 ? 5 : 9; // khoảng lặng thật của người nói
        if (SOFT.includes(text.slice(-1))) c = Math.min(c, gap >= 0.3 ? 3 : 6); // dấu phẩy chỉ là ứng viên yếu
        if (c >= 5) c += grammar ? grammar[i] : EN_WEAK_END.has(text.toLowerCase()) ? 5 : 0;
        return c;
    };
    const durCost = (d: number, isLast: boolean) =>
        d < min ? (min - d) ** 2 * (isLast ? 0.3 : 1.2) : d > max ? (d - max) ** 2 * 2 : 3 * ((d - target) / (max - min)) ** 2;

    const best = new Array(n + 1).fill(Infinity);
    const from = new Array(n + 1).fill(0);
    best[0] = 0;
    for (let j = 1; j <= n; j++) {
        const cc = cutCost(j - 1);
        for (let i = j - 1; i >= 0; i--) {
            const d = words[j - 1].end - words[i].start;
            if (d > max + 6 && i < j - 1) break;
            const v = best[i] + cc + durCost(d, j === n);
            if (v < best[j]) { best[j] = v; from[j] = i; }
        }
    }
    const ranges: [number, number][] = [];
    for (let j = n; j > 0; j = from[j]) ranges.unshift([from[j], j - 1]);
    return ranges;
}

// Ghép block + thời gian liền mạch: end(block k) === start(block k+1) khi người nói không ngừng
function buildBlocks(words: Word[], ranges: [number, number][], spaced: boolean): Block[] {
    const r2 = (x: number) => Number(x.toFixed(2));
    let startT = r2(Math.max(0, words[0].start - 0.2));

    return ranges.map(([a, b], k) => {
        const last = words[b];
        const next = words[b + 1];
        // Nếu có câu tiếp theo: lấy điểm chia hợp lý (tối đa cộng thêm 0.5s sau khi nói xong, phần còn lại nhường cho đầu câu sau, hoặc chạm vào câu sau)
        // Muốn end(k) === start(k+1) tuyệt đối:
        const boundary = next
            ? r2((last.end + next.start) / 2) // Chia đôi khoảng cách giữa 2 block
            : r2(last.end + 0.3);

        const text = words.slice(a, b + 1).map((w) => w.text).join(spaced ? " " : "");
        const block = { id: `block-${k + 1}`, text, start: startT, end: boundary };
        startT = boundary; // Dùng chính giá trị đã làm tròn để tránh lệch 0.01s do floating point
        return block;
    });
}

// ==========================================
// Handler
// ==========================================
const fail = (error: string, status = 404) => NextResponse.json({ success: false, error }, { status });
const wordsCache = new Map<string, Word[]>(); // đổi min/max không phải tải lại phụ đề

export async function GET(request: Request) {
    try {
        const sp = new URL(request.url).searchParams;

        const playlistId = sp.get("playlist");
        if (playlistId) {
            if (!/^[\w-]{10,50}$/.test(playlistId)) return fail("Invalid playlist id.", 400);
            return NextResponse.json({ success: true, data: await fetchPlaylist(playlistId) });
        }

        const videoId = sp.get("videoId");
        if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) return fail("Missing or invalid videoId.", 400);
        const lang = (sp.get("lang")?.trim() || "ja").toLowerCase();
        if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/.test(lang)) return fail("Invalid lang.", 400);
        const base = lang.split("-")[0];

        const num = (v: string | null, f: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : f);
        const min = num(sp.get("minDuration"), DEFAULT_MIN);
        const max = Math.max(min + 1, num(sp.get("maxDuration"), DEFAULT_MAX));

        const key = `${videoId}:${lang}`;
        let words = wordsCache.get(key);
        if (!words) {
            words = extractWords(await fetchJson3(videoId, lang));
            if (wordsCache.size >= 50) wordsCache.delete(wordsCache.keys().next().value!);
            wordsCache.set(key, words);
        }
        if (!words.length) return fail(`No valid word tokens extracted for language "${lang}".`);

        const tok = base === "ja" ? await getTokenizer() : null;
        const ranges = segment(words, base, min, max, tok ? japanesePenalties(words, tok) : null);
        return NextResponse.json({ success: true, data: buildBlocks(words, ranges, !NO_SPACE.has(base)) });
    } catch (e: any) {
        console.error("Transcript API error:", e?.message);
        return fail(e?.message || "Failed to extract transcript.");
    }
}
