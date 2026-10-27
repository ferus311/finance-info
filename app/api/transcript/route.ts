import { NextResponse } from "next/server";
import kuromoji from "kuromoji";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Prevent Next.js from caching this API route
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ==========================================
// DATA TYPES (100% tương thích với UI hiện tại)
// ==========================================
type Block = { id: string; text: string; start: number; end: number };
type Token = kuromoji.IpadicFeatures;
type WordToken = { word: string; start: number; end: number };

const DEFAULT_MIN_BLOCK_SEC = 7;
const DEFAULT_MAX_BLOCK_SEC = 20;

// ==========================================
// LANGUAGE CONFIG (Tối giản hóa cho Word-Level)
// ==========================================
type LangConfig = {
    strongEnders: string[];
    softEnders: string[];
    dependentMarks: string[]; // Các dấu câu không bao giờ được phép đứng đầu câu mới
    useTokenizer: boolean;
    joinWithSpace: boolean;
    silenceThreshold: number; // Ngưỡng khoảng lặng (giây) để nhận diện ngắt nghỉ tự nhiên
};

const LANG_CONFIGS: Record<string, LangConfig> = {
    ja: {
        strongEnders: ["。", "！", "？", ".", "!", "?"],
        softEnders: ["、", "，", ",", "；", ";"],
        dependentMarks: ["。", "、", "！", "？", ".", ",", "!", "?", "」", "』", ")", "）", "】", "…"],
        useTokenizer: true,
        joinWithSpace: false,
        silenceThreshold: 0.8,
    },
    zh: {
        strongEnders: ["。", "！", "？", ".", "!", "?"],
        softEnders: ["，", "、", ",", "；", ";"],
        dependentMarks: ["。", "，", "、", "！", "？", ".", ",", "!", "?", "”", "’", ")", "）", "】"],
        useTokenizer: false,
        joinWithSpace: false,
        silenceThreshold: 0.8,
    },
};

const DEFAULT_LANG_CONFIG: LangConfig = {
    strongEnders: [".", "!", "?"],
    softEnders: [",", ";", ":"],
    dependentMarks: [".", ",", "!", "?", ";", ":", ")", "]", "}", '"', "'"],
    useTokenizer: false,
    joinWithSpace: true,
    silenceThreshold: 1.0,
};

function getLangConfig(lang: string): LangConfig {
    return LANG_CONFIGS[lang] ?? DEFAULT_LANG_CONFIG;
}

// ==========================================
// Kuromoji tokenizer (Lazy load cho Tiếng Nhật)
// ==========================================
let tokenizerPromise: Promise<kuromoji.Tokenizer<Token> | null> | null = null;
function getTokenizer() {
    if (!tokenizerPromise) {
        tokenizerPromise = new Promise((resolve) => {
            let dicPath = path.join(process.cwd(), "node_modules", "kuromoji", "dict");
            if (!fs.existsSync(dicPath)) {
                dicPath = path.join(process.cwd(), "public", "dict");
            }
            kuromoji.builder({ dicPath }).build((err, tokenizer) => {
                if (err) {
                    console.warn("Kuromoji failed to load. Falling back to timing-based cuts.", err);
                    resolve(null);
                } else resolve(tokenizer);
            });
        });
    }
    return tokenizerPromise;
}

function parseDurationParam(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getYtDlpPath(): string {
    const candidates = [
        "/home/fong/.local/bin/yt-dlp", // 🎯 Đường dẫn thực tế vừa cài đặt qua pip
        "/home/fong/project_ai/python-app/.venv/bin/yt-dlp", // Đường dẫn trong .venv hôm nọ
        "/usr/local/bin/yt-dlp",
        "/usr/bin/yt-dlp",
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return "yt-dlp"; // Fallback cuối cùng nếu không thấy
}


// ==========================================
// CORE ENGINE 1: Tải và Bóc tách json3 bằng yt-dlp
// ==========================================
async function fetchJson3WithYtDlp(videoId: string, lang: string): Promise<any> {
    // Validate videoId để chống lỗi Command Injection tuyệt đối
    if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
        throw new Error("Invalid YouTube videoId format.");
    }

    const tempDir = os.tmpdir();
    const uniquePrefix = `yt_sub_${videoId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const outTemplate = path.join(tempDir, `${uniquePrefix}.%(ext)s`);
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    try {
        // Dùng execFile thay vì exec để truyền tham số an toàn không qua shell
        await execFileAsync(getYtDlpPath(), [
            "--skip-download",
            "--write-subs",        // Ưu tiên lấy sub do người tạo
            "--write-auto-subs",   // Lấy cả sub tự động nếu cần
            "--sub-langs", lang, // Bắt cả mã vùng (vd: en-US, ja-JP)
            "--sub-format", "json3",
            "-o", outTemplate,
            url,
        ], { timeout: 30000 }); // Timeout sau 30s tránh treo server

        const files = await fsp.readdir(tempDir);
        const subFiles = files.filter((f) => f.startsWith(uniquePrefix) && f.endsWith(".json3"));

        if (subFiles.length === 0) {
            throw new Error(`No captions available for language "${lang}".`);
        }

        // Nếu có nhiều file (ví dụ vừa có ja thủ công, vừa có ja-orig tự động), ưu tiên file khớp tên ngắn nhất (thường là bản chuẩn)
        subFiles.sort((a, b) => a.length - b.length);
        const targetFile = path.join(tempDir, subFiles[0]);
        const rawContent = await fsp.readFile(targetFile, "utf-8");

        // Dọn dẹp toàn bộ file tạm ngay sau khi đọc vào RAM
        await Promise.all(subFiles.map((f) => fsp.unlink(path.join(tempDir, f)).catch(() => {})));

        return JSON.parse(rawContent);
    } catch (err: any) {
        // Đảm bảo dọn rác kể cả khi lỗi
        const files = await fsp.readdir(tempDir).catch(() => []);
        await Promise.all(
            files.filter((f) => f.startsWith(uniquePrefix)).map((f) => fsp.unlink(path.join(tempDir, f)).catch(() => {}))
        );
        throw new Error(err?.message || `Failed to fetch json3 via yt-dlp for language "${lang}".`);
    }
}

// ==========================================
// CORE ENGINE 2: Phẳng hóa json3 thành mảng Word-level
// ==========================================
function extractWordsFromJson3(rawJson3: any): WordToken[] {
    const rawWords: { word: string; start: number; eventEnd: number }[] = [];

    for (const event of rawJson3.events || []) {
        if (!event.segs) continue;
        const baseStartMs = event.tStartMs ?? 0;
        const durationMs = event.dDurationMs ?? 2000;
        const eventEndSec = (baseStartMs + durationMs) / 1000.0;

        for (const seg of event.segs) {
            const text = (seg.utf8 || "").replace(/\s+/g, " ").trim();
            if (!text) continue;

            const offsetMs = seg.tOffsetMs ?? 0;
            const startSec = (baseStartMs + offsetMs) / 1000.0;

            rawWords.push({
                word: text,
                start: startSec,
                eventEnd: eventEndSec,
            });
        }
    }

    // Nội suy thời gian kết thúc (end_time) chuẩn xác cho từng từ
    const words: WordToken[] = [];
    for (let i = 0; i < rawWords.length; i++) {
        const curr = rawWords[i];
        const next = rawWords[i + 1];

        let endSec = curr.start + 0.35; // Mặc định mỗi âm tiết kéo dài ~0.35s
        if (next && next.start > curr.start) {
            // Không bao giờ để thời gian kết thúc của chữ trước đè lên chữ sau, hoặc kéo dài quá 0.6s qua khoảng lặng
            endSec = Math.min(next.start, curr.start + 0.6, curr.eventEnd);
        } else {
            endSec = Math.min(curr.eventEnd, curr.start + 0.6);
        }

        words.push({
            word: curr.word,
            start: Number(curr.start.toFixed(3)),
            end: Number(Math.max(curr.start + 0.05, endSec).toFixed(3)),
        });
    }

    return words;
}

function joinWords(base: string, word: string, config: LangConfig): string {
    if (!base) return word;
    if (!config.joinWithSpace) return base + word;
    // Với ngôn ngữ có dấu cách (Anh, Việt): Không thêm dấu cách nếu token tiếp theo là dấu câu
    if (config.dependentMarks.includes(word)) return base + word;
    return `${base} ${word}`;
}

// ==========================================
// MAIN API HANDLER
// ==========================================
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const videoId = searchParams.get("videoId");
        if (!videoId) return NextResponse.json({ success: false, error: "Missing videoId" }, { status: 400 });

        const lang = (searchParams.get("lang")?.trim() || "ja").toLowerCase();
        const config = getLangConfig(lang);

        const MIN_BLOCK_SEC = parseDurationParam(searchParams.get("minDuration"), DEFAULT_MIN_BLOCK_SEC);
        const MAX_BLOCK_SEC = Math.max(
            MIN_BLOCK_SEC + 1,
            parseDurationParam(searchParams.get("maxDuration"), DEFAULT_MAX_BLOCK_SEC)
        );

        // 1. Kéo dữ liệu json3 và giải nén thành từng chữ (Word-level)
        const rawJson3 = await fetchJson3WithYtDlp(videoId, lang);
        const words = extractWordsFromJson3(rawJson3);

        if (words.length === 0) {
            throw new Error(`No valid word tokens extracted for language "${lang}".`);
        }

        const tokenizer = config.useTokenizer ? await getTokenizer() : null;

        // 2. THUẬT TOÁN GOM BLOCK TỪ TỪNG CHỮ (WORD-LEVEL AGGREGATION)
        const blocks: Block[] = [];
        let currentText = "";
        let blockStart = -1;
        let blockEnd = 0;

        for (let i = 0; i < words.length; i++) {
            const w = words[i];

            // Chống lỗi "dấu câu mồ côi": Nếu đang bắt đầu Block mới mà gặp ngay dấu câu (rớt từ câu trước),
            // lập tức nhét nó vào đuôi của Block trước đó thay vì mở Block mới bằng dấu chấm!
            if (currentText === "" && config.dependentMarks.includes(w.word)) {
                if (blocks.length > 0) {
                    blocks[blocks.length - 1].text += w.word;
                    blocks[blocks.length - 1].end = Number(w.end.toFixed(2));
                }
                continue;
            }

            if (currentText === "") {
                blockStart = w.start;
            }

            currentText = joinWords(currentText, w.word, config);
            blockEnd = w.end;

            // --- LOOK-AHEAD: Nhìn trước các token phụ thuộc ---
            // Nếu token tiếp theo là dấu câu (VD: "こんにちは" rồi đến "。"), BẮT BUỘC phải gom hết vào chung 1 nhịp
            while (i + 1 < words.length && config.dependentMarks.includes(words[i + 1].word)) {
                i++;
                const nextDep = words[i];
                currentText = joinWords(currentText, nextDep.word, config);
                blockEnd = nextDep.end;
            }

            const currentDuration = blockEnd - blockStart;
            const lastChar = currentText.slice(-1);

            const isStrongEnd = config.strongEnders.includes(lastChar);
            const isSoftEnd = config.softEnders.includes(lastChar);
            const isLastWord = i === words.length - 1;

            // Đo khoảng lặng âm thanh thực tế đến chữ tiếp theo
            const gapToNext = !isLastWord ? words[i + 1].start - blockEnd : 999;
            const isSilenceGap = gapToNext >= config.silenceThreshold;

            let shouldCut = false;

            // ==========================================
            // HỆ THỐNG PHÂN TẦNG QUYẾT ĐỊNH NGẮT BLOCK
            // ==========================================
            if (isLastWord) {
                shouldCut = true;
            }
            // TẦNG 1: Đã đủ độ dài tối thiểu (MIN_BLOCK_SEC) -> Tìm điểm ngắt câu hoàn hảo
            else if (currentDuration >= MIN_BLOCK_SEC) {
                if (isStrongEnd) {
                    // Cắt ngay lập tức khi gặp dấu kết câu (。！？)
                    shouldCut = true;
                } else if (isSoftEnd && gapToNext >= 0.3) {
                    // Gặp dấu phẩy (、) kèm theo một nhịp lấy hơi nhẹ
                    shouldCut = true;
                } else if (isSilenceGap) {
                    // AI quên đánh dấu câu nhưng người nói thực sự đã dừng lại nghỉ (Silence Gap)
                    if (config.useTokenizer && tokenizer) {
                        const tokens = tokenizer.tokenize(currentText);
                        const lastToken = tokens[tokens.length - 1];
                        // Chỉ cắt ở khoảng lặng nếu từ cuối cùng không phải là Tiếp đầu ngữ (接頭詞) đang nói dở
                        if (lastToken?.pos !== "接頭詞") {
                            shouldCut = true;
                        }
                    } else {
                        shouldCut = true;
                    }
                }
            }

            // TẦNG 2: Câu quá dài vượt ngưỡng (MAX_BLOCK_SEC) mà người nói không chấm câu -> Ép cắt mềm (Soft Cut)
            if (!shouldCut && currentDuration >= MAX_BLOCK_SEC) {
                if (isSoftEnd || gapToNext >= 0.25) {
                    shouldCut = true;
                } else if (config.useTokenizer && tokenizer) {
                    // Dùng Kuromoji tìm ranh giới từ loại an toàn để cắt mà không làm gãy từ vựng
                    const tokens = tokenizer.tokenize(currentText);
                    const lastToken = tokens[tokens.length - 1];
                    const pos = lastToken?.pos;
                    const posDetail = lastToken?.pos_detail_1;

                    if (
                        pos === "助詞" && ["接続助詞", "終助詞", "副助詞", "係助詞"].includes(posDetail) || // Cắt sau các trợ từ nối (て, から, けど, は, も...)
                        pos === "助動詞" || // Cắt sau trợ động từ (です, ます, た...)
                        (pos === "記号" && posDetail === "読点")
                    ) {
                        shouldCut = true;
                    }
                }

                // Cắt cưỡng bức bảo vệ UI nếu chạy lố thêm 4 giây mà vẫn chưa tìm được trợ từ
                if (!shouldCut && currentDuration >= MAX_BLOCK_SEC + 4) {
                    shouldCut = true;
                }
            }

            // ==========================================
            // ĐÓNG GÓI BLOCK
            // ==========================================
            if (shouldCut) {
                blocks.push({
                    id: `block-${blocks.length + 1}`,
                    text: currentText.trim(),
                    start: Number(blockStart.toFixed(2)),
                    end: Number(blockEnd.toFixed(2)),
                });

                currentText = "";
                blockStart = -1;
            }
        }

        return NextResponse.json({ success: true, data: blocks });
    } catch (error: any) {
        console.error("Transcript API error:", error?.message);
        return NextResponse.json(
            { success: false, error: error?.message || "Failed to extract transcript." },
            { status: 404 }
        );
    }
}
