import { NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript-plus";
import kuromoji from "kuromoji";
import path from "node:path";
import fs from "node:fs";

// Prevent Next.js from caching this API route
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RawCaption = { text: string; offset: number; duration: number; actualEnd?: number };
type Block = { id: string; text: string; start: number; end: number };
type Token = kuromoji.IpadicFeatures;

const DEFAULT_MIN_BLOCK_SEC = 7;
const DEFAULT_MAX_BLOCK_SEC = 20;

// ==========================================
// LANGUAGE CONFIG
// Segmentation behaves differently depending on whether the language is
// written without spaces between words (Japanese, Chinese) or with spaces
// (English, Vietnamese, Korean, French, ...). Everything below is driven
// by this config instead of hardcoded Japanese punctuation/logic.
// ==========================================
type LangConfig = {
    strongEnders: string; // characters that end a sentence outright (e.g. "。！？" or ".!?")
    softEnders: string; // strongEnders plus "soft" pause characters (e.g. "、" or ",")
    useTokenizer: boolean; // whether the Kuromoji (Japanese-only) morphological analyzer applies
    joinWithSpace: boolean; // whether captions should be joined with a space (word-based langs) or concatenated directly (char-based langs)
    trailingSpan: number; // how many trailing units (chars or ~chars of a few words) can be carried over to the next block
    leadingSpan: number; // how many leading units can be borrowed from the next caption
};

const LANG_CONFIGS: Record<string, LangConfig> = {
    ja: { strongEnders: "。！？", softEnders: "。！？、", useTokenizer: true, joinWithSpace: false, trailingSpan: 3, leadingSpan: 3 },
    zh: { strongEnders: "。！？", softEnders: "。！？，", useTokenizer: false, joinWithSpace: false, trailingSpan: 3, leadingSpan: 3 },
};

// Reasonable default for any language not explicitly listed above: assumes
// space-separated words and Latin-style punctuation (covers en, vi, ko, fr, es, de, pt, etc.)
const DEFAULT_LANG_CONFIG: LangConfig = {
    strongEnders: ".!?",
    softEnders: ".!?,;",
    useTokenizer: false,
    joinWithSpace: true,
    trailingSpan: 20,
    leadingSpan: 20,
};

function getLangConfig(lang: string): LangConfig {
    return LANG_CONFIGS[lang] ?? DEFAULT_LANG_CONFIG;
}

function escapeRegexChars(chars: string) {
    return chars.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ==========================================
// HELPERS: timing estimation
// ==========================================
function unitLength(text: string, config: LangConfig) {
    return config.joinWithSpace ? text.trim().split(/\s+/).filter(Boolean).length : text.length;
}

// Estimates how much time a snippet of text takes to speak, used to shift
// timestamps when text is borrowed/carried between blocks.
function calculateShiftTime(unitCount: number, joinWithSpace: boolean, maxCap: number = 1.5) {
    const baseTime = 0.2; // breathing/pause allowance
    const timePerUnit = joinWithSpace ? 0.3 : 0.35; // ~0.3s per word, ~0.35s per character
    return Math.min(maxCap, baseTime + unitCount * timePerUnit);
}

function appendText(base: string, addition: string, joinWithSpace: boolean) {
    if (!base) return addition;
    if (!addition) return base;
    return joinWithSpace ? `${base} ${addition}` : base + addition;
}

function cleanText(text: string, joinWithSpace: boolean) {
    const collapsed = text.replace(/\s+/g, " ").trim();
    return joinWithSpace ? collapsed : collapsed.replace(/\s+/g, "");
}

// ==========================================
// Kuromoji tokenizer (Japanese only) — loaded lazily and only when needed
// ==========================================
let tokenizerPromise: Promise<kuromoji.Tokenizer<Token>> | null = null;
function getTokenizer() {
    if (!tokenizerPromise) {
        tokenizerPromise = new Promise((resolve) => {
            let dicPath = path.join(process.cwd(), "node_modules", "kuromoji", "dict");
            if (!fs.existsSync(dicPath)) {
                dicPath = path.join(process.cwd(), "public", "dict");
            }
            kuromoji.builder({ dicPath }).build((err, tokenizer) => {
                if (err) {
                    console.warn("Kuromoji failed to load. Falling back to length-based cuts.", err);
                    resolve(null as any);
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

        let transcript;
        try {
            transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang });
        } catch {
            throw new Error(`No captions available for language "${lang}".`);
        }
        if (!transcript || transcript.length === 0) throw new Error(`No captions available for language "${lang}".`);

        const captions: RawCaption[] = transcript.map((t) => ({ ...t, text: cleanText(t.text, config.joinWithSpace) }));
        for (let i = 0; i < captions.length; i++) {
            const current = captions[i];
            const next = captions[i + 1];
            current.actualEnd = next ? Math.min(current.offset + current.duration, next.offset) : current.offset + current.duration;
        }

        // Only load the (Japanese-specific) morphological tokenizer when actually needed
        const tokenizer = config.useTokenizer ? await getTokenizer() : null;

        const strongEndRegex = new RegExp(`[${escapeRegexChars(config.strongEnders)}]$`);
        const carryOverRegex = new RegExp(
            `(.*[${escapeRegexChars(config.strongEnders)}])([^${escapeRegexChars(config.strongEnders)}]{1,${config.trailingSpan}})$`
        );
        const lookaheadRegex = new RegExp(
            `^([^${escapeRegexChars(config.softEnders)}]{0,${config.leadingSpan}}[${escapeRegexChars(config.softEnders)}])(.*)`
        );

        const blocks: Block[] = [];

        let currentBlockText = "";
        let blockStartTime = captions[0].offset;

        for (let i = 0; i < captions.length; i++) {
            const cap = captions[i];
            currentBlockText = appendText(currentBlockText, cap.text, config.joinWithSpace);

            const currentDuration = cap.actualEnd! - blockStartTime;
            const isLastCaption = i === captions.length - 1;

            let shouldCut = false;
            let cutText = currentBlockText;
            let carryOverText = "";
            let borrowedTime = 0;

            // ==========================================
            // WATERFALL EVALUATION
            // ==========================================
            if (currentDuration >= MIN_BLOCK_SEC) {
                // PRIORITY 1: Perfect end (already ends on a strong sentence-ender)
                if (strongEndRegex.test(currentBlockText)) {
                    shouldCut = true;
                    cutText = currentBlockText;
                }
                // PRIORITY 2: Carry-over (a few trailing units leak past the sentence end)
                else if (carryOverRegex.exec(currentBlockText)) {
                    const match = carryOverRegex.exec(currentBlockText);
                    shouldCut = true;
                    cutText = match![1];
                    carryOverText = match![2];
                }
                // PRIORITY 3: Lookahead borrowing (steal the sentence-ender from the next caption)
                else {
                    const nextCap = captions[i + 1];
                    if (nextCap && nextCap.text) {
                        const match = lookaheadRegex.exec(nextCap.text);
                        if (match) {
                            const borrowedText = match[1];
                            shouldCut = true;
                            cutText = appendText(currentBlockText, borrowedText, config.joinWithSpace);

                            nextCap.text = match[2];
                            borrowedTime = Math.min(
                                nextCap.duration * 0.4,
                                calculateShiftTime(unitLength(borrowedText, config), config.joinWithSpace)
                            );
                            nextCap.offset += borrowedTime;
                            nextCap.duration -= borrowedTime;
                        }
                    }
                }
            }

            // ==========================================
            // PRIORITY 4: Soft cut when a block is running too long
            // ==========================================
            if (!shouldCut && currentDuration >= MAX_BLOCK_SEC) {
                if (config.useTokenizer && tokenizer) {
                    const tokens = tokenizer.tokenize(currentBlockText);
                    const lastToken = tokens[tokens.length - 1];
                    const pos = lastToken?.pos;
                    const posDetail = lastToken?.pos_detail_1;

                    if (
                        pos === "動詞" ||
                        pos === "形容詞" ||
                        (pos === "助詞" && ["終助詞", "接続助詞", "副助詞"].includes(posDetail)) ||
                        (pos === "記号" && posDetail === "読点")
                    ) {
                        shouldCut = true;
                        cutText = currentBlockText;
                    }
                } else {
                    shouldCut = true;
                    cutText = currentBlockText;
                }
            }

            // ==========================================
            // FINALIZE BLOCK & RESYNC TIMESTAMPS
            // ==========================================
            if (shouldCut || isLastCaption) {
                let blockEndTime = cap.actualEnd! + borrowedTime;
                let dynamicShiftTime = 0;

                if (carryOverText) {
                    dynamicShiftTime = calculateShiftTime(unitLength(carryOverText, config), config.joinWithSpace, 1.5);
                    blockEndTime = Math.max(blockStartTime + 1, blockEndTime - dynamicShiftTime);
                }

                blocks.push({
                    id: `block-${blocks.length + 1}`,
                    text: cutText.trim(),
                    start: Number(blockStartTime.toFixed(2)),
                    end: Number(blockEndTime.toFixed(2)),
                });

                currentBlockText = carryOverText;

                if (!isLastCaption) {
                    blockStartTime = captions[i + 1].offset;
                    if (carryOverText) {
                        blockStartTime = Math.max(0, blockStartTime - dynamicShiftTime);
                    }
                }
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
