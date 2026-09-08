"use client";

import { useEffect, useMemo, useRef, useState, memo } from "react";

// ==========================================
// TYPES & GLOBALS
// ==========================================
type Block = { id: string; text: string; start: number; end: number };
type SavedVideo = { id: string; url: string; title: string; thumbnail: string; addedAt: number };

declare global {
    interface Window {
        YT?: any;
        onYouTubeIframeAPIReady?: () => void;
    }
}

// ==========================================
// CONSTANTS & CONFIG
// ==========================================
const CUTOFF_COMPENSATION_SEC = 0.15;
const POLL_INTERVAL_MS = 50;
const MATCH_THRESHOLD_PERCENT = 70;
const DEFAULT_MIN_DURATION = 7;
const DEFAULT_MAX_DURATION = 20;

const SUPPORTED_LANGUAGES = [
    { code: "ja", label: "Japanese (日本語)" },
    { code: "en", label: "English" },
    { code: "vi", label: "Vietnamese (Tiếng Việt)" },
    { code: "ko", label: "Korean (한국어)" },
    { code: "zh", label: "Chinese (中文)" },
    { code: "de", label: "German (Deutsch)" },
    { code: "fr", label: "French (Français)" },
    { code: "es", label: "Spanish (Español)" },
];

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

// ==========================================
// HELPERS
// ==========================================
function getYouTubeVideoId(url: string) {
    return url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/i)?.[1] ?? null;
}

function getYouTubePlaylistId(url: string) {
    return url.match(/[?&]list=([^#\&\?]+)/)?.[1] ?? null;
}

async function fetchYouTubeMetadata(url: string) {
    try {
        const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        return {
            title: data.title || "Unknown Title",
            thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${getYouTubeVideoId(url)}/hqdefault.jpg`,
        };
    } catch {
        return {
            title: "Unknown Title",
            thumbnail: `https://img.youtube.com/vi/${getYouTubeVideoId(url)}/hqdefault.jpg`,
        };
    }
}

function buildFallbackBlocks(duration: number, blockSeconds: number): Block[] {
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 180;
    const count = Math.max(1, Math.ceil(safeDuration / blockSeconds));
    return Array.from({ length: count }, (_, i) => {
        const start = (safeDuration / count) * i;
        const end = Math.min(safeDuration, (safeDuration / count) * (i + 1));
        return {
            id: `auto-${i}`,
            text: `[No captions available] Listen to block ${i + 1}`,
            start: Number(start.toFixed(2)),
            end: Number(end.toFixed(2)),
        };
    });
}

function loadYouTubeApi(): Promise<void> {
    return new Promise((resolve) => {
        if (window.YT && window.YT.Player) return resolve();
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
        if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
            const tag = document.createElement("script");
            tag.src = "https://www.youtube.com/iframe_api";
            document.body.appendChild(tag);
        }
    });
}

function normalizeForCompare(text: string) {
    return text.replace(/[\s。、！？.,!?"'“”‘’（）()]/g, "").toLowerCase();
}

function levenshteinDistance(a: string, b: string): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
    }
    return dp[a.length][b.length];
}

function similarityPercent(typed: string, expected: string): number {
    const a = normalizeForCompare(typed);
    const b = normalizeForCompare(expected);
    if (!a.length && !b.length) return 100;
    const maxLen = Math.max(a.length, b.length) || 1;
    return Math.max(0, Math.round((1 - levenshteinDistance(a, b) / maxLen) * 100));
}

function decodeHTMLEntities(text: string) {
    if (typeof document === "undefined") return text;
    const textArea = document.createElement("textarea");
    textArea.innerHTML = text;
    return textArea.value;
}

// ==========================================
// COMPONENT: DictationBox
// ==========================================
const DictationBox = memo(function DictationBox({ expectedText }: { expectedText: string }) {
    const [draft, setDraft] = useState("");
    const similarity = useMemo(() => draft.trim() ? similarityPercent(draft, expectedText) : 0, [draft, expectedText]);
    const isMatch = similarity >= MATCH_THRESHOLD_PERCENT;

    return (
        <div className="flex flex-col gap-2 relative z-0">
            <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-28 sm:h-32 bg-slate-900 border border-slate-700 rounded-xl p-4 text-base outline-none focus:border-cyan-400 w-full resize-none text-slate-100 shadow-inner"
                placeholder="Type what you hear here... (Listen carefully!)"
            />
            {draft.trim() && (
                <div className={`flex items-center justify-between text-sm px-1 font-medium ${isMatch ? "text-emerald-400" : "text-amber-400"}`}>
                    <span>Match: {similarity}%</span>
                    <span>{isMatch ? "✓ Excellent!" : `Keep trying (Need ${MATCH_THRESHOLD_PERCENT}%)`}</span>
                </div>
            )}
        </div>
    );
});

// ==========================================
// MAIN APP COMPONENT
// ==========================================
export default function Home() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [addMode, setAddMode] = useState<"video" | "playlist">("video");

    const [sourceUrl, setSourceUrl] = useState("https://www.youtube.com/watch?v=2g5uQ_JaCYE");
    const [language, setLanguage] = useState("ja");
    const [minDuration, setMinDuration] = useState(DEFAULT_MIN_DURATION);
    const [maxDuration, setMaxDuration] = useState(DEFAULT_MAX_DURATION);

    const [library, setLibrary] = useState<SavedVideo[]>([]);
    const [newInputUrl, setNewInputUrl] = useState("");
    const [isAddingPlaylist, setIsAddingPlaylist] = useState(false);

    const [blocks, setBlocks] = useState<Block[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isBlind, setIsBlind] = useState(false);

    const [autoNext, setAutoNext] = useState(false);
    const [loopCurrent, setLoopCurrent] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);

    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [message, setMessage] = useState("");
    const [isPlayingBlock, setIsPlayingBlock] = useState(false);

    const playerRef = useRef<any>(null);
    const currentBlock = blocks[currentIndex] ?? null;

    useEffect(() => {
        const saved = localStorage.getItem("shadowing_library");
        if (saved) setLibrary(JSON.parse(saved));
        const lastUrl = localStorage.getItem("shadowing_last_url");
        if (lastUrl) setSourceUrl(lastUrl);
    }, []);

    const updateLibrary = (newLib: SavedVideo[]) => {
        setLibrary(newLib);
        localStorage.setItem("shadowing_library", JSON.stringify(newLib));
    };

    // --- HANDLE ADDING VIDEO OR PLAYLIST ---
    const handleAddSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (addMode === "video") {
            const vidId = getYouTubeVideoId(newInputUrl);
            if (!vidId) return alert("Invalid YouTube Video URL");
            if (library.some(v => v.id === vidId)) return alert("Video already in library");

            const meta = await fetchYouTubeMetadata(newInputUrl);
            updateLibrary([{ id: vidId, url: newInputUrl, title: meta.title, thumbnail: meta.thumbnail, addedAt: Date.now() }, ...library]);
            setNewInputUrl("");

        } else {
            // PLAYLIST LOGIC
            const playlistId = getYouTubePlaylistId(newInputUrl);
            if (!playlistId) return alert("Invalid YouTube Playlist URL");

            setIsAddingPlaylist(true);
            try {
                // Kiến trúc chuẩn: Gọi backend API route của Next.js (bạn cần tự tạo file app/api/playlist/route.ts)
                // const res = await fetch(`/api/playlist?id=${playlistId}`);
                // const videos = await res.json();

                // VÌ HIỆN TẠI CHƯA CÓ BACKEND, TÔI DÙNG MOCK LOGIC: Add 1 video nếu nó nằm trong link playlist.
                console.warn("Backend /api/playlist chưa khả dụng. Bóc tách fallback video id từ URL...");
                const vidId = getYouTubeVideoId(newInputUrl);

                if (vidId) {
                    const meta = await fetchYouTubeMetadata(newInputUrl);
                    if (!library.some(v => v.id === vidId)) {
                        updateLibrary([{ id: vidId, url: `https://youtube.com/watch?v=${vidId}`, title: meta.title, thumbnail: meta.thumbnail, addedAt: Date.now() }, ...library]);
                        alert(`Vì chưa có Backend gọi YouTube API, tôi tạm lấy Video đang phát: ${meta.title}`);
                    }
                } else {
                    alert("Cần Backend để fetch toàn bộ Playlist. Vui lòng tạo endpoint /api/playlist.");
                }
            } catch (err) {
                alert("Lỗi khi lấy dữ liệu Playlist.");
            } finally {
                setIsAddingPlaylist(false);
                setNewInputUrl("");
            }
        }
    };

    const removeVideo = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        updateLibrary(library.filter(v => v.id !== id));
    };

    // Auto-load feature: Khi bấm vào list là fetch luôn
    const loadFromLibrary = (url: string) => {
        setSourceUrl(url);
        handleFetch(url); // Truyền trực tiếp URL vào thay vì đợi state update
    };

    // ==========================================
    // Core Logic (Đã refactor để nhận targetUrl)
    // ==========================================
    const handleFetch = async (targetUrl?: string) => {
        // Fix event type if called directly from onClick
        const urlToProcess = typeof targetUrl === 'string' ? targetUrl : sourceUrl;

        const videoId = getYouTubeVideoId(urlToProcess);
        if (!videoId) return setMessage("Invalid YouTube URL.");

        localStorage.setItem("shadowing_last_url", urlToProcess);
        setStatus("loading");
        setMessage("Analyzing sentence structure and timestamps...");

        await loadYouTubeApi();
        if (!playerRef.current) {
            playerRef.current = new window.YT.Player("youtube-player", {
                videoId,
                width: "100%",
                height: "100%",
                playerVars: { autoplay: 1, controls: 1, rel: 0, playsinline: 1 },
                events: {
                    onStateChange: (e: any) => {
                        if (!window.YT) return;
                        if (e.data === window.YT.PlayerState.PLAYING) setIsPlayingBlock(true);
                        else if (e.data === window.YT.PlayerState.PAUSED || e.data === window.YT.PlayerState.ENDED) setIsPlayingBlock(false);
                    },
                    onReady: (e: any) => e.target.setPlaybackRate(playbackRate)
                },
            });
        } else {
            playerRef.current.loadVideoById(videoId);
            setTimeout(() => playerRef.current.setPlaybackRate(playbackRate), 500);
        }

        try {
            const params = new URLSearchParams({
                videoId,
                lang: language,
                minDuration: String(minDuration),
                maxDuration: String(maxDuration),
            });
            const res = await fetch(`/api/transcript?${params.toString()}`);
            const data = await res.json();
            if (!data.success || data.data.length === 0) throw new Error(data.error || "No_Data");

            const cleanedBlocks = data.data.map((b: Block) => ({
                ...b,
                text: decodeHTMLEntities(b.text)
            }));

            setBlocks(cleanedBlocks);
            setStatus("success");
            setMessage(`Extracted ${cleanedBlocks.length} blocks. Ready to study.`);
        } catch (error: any) {
            setStatus("error");
            setMessage("No captions found. Creating duration-based auto-blocks.");
            setTimeout(() => {
                const duration = playerRef.current?.getDuration?.() || 180;
                setBlocks(buildFallbackBlocks(duration, Math.round((minDuration + maxDuration) / 2)));
            }, 1000);
        }
        setCurrentIndex(0);
    };

    // Player controls
    const changeSpeed = (rate: number) => {
        setPlaybackRate(rate);
        if (playerRef.current?.setPlaybackRate) playerRef.current.setPlaybackRate(rate);
    };

    useEffect(() => {
        if (!currentBlock || !isPlayingBlock || !playerRef.current) return;
        const timer = window.setInterval(() => {
            const player = playerRef.current;
            if (player.getPlayerState?.() !== 1) return;

            const currentTime = player.getCurrentTime?.() || 0;
            if (currentTime >= currentBlock.end - CUTOFF_COMPENSATION_SEC) {
                if (loopCurrent) {
                    player.seekTo(currentBlock.start, true);
                    return;
                }
                player.pauseVideo();
                setIsPlayingBlock(false);
                player.seekTo(currentBlock.end, true);

                if (autoNext && currentIndex < blocks.length - 1) {
                    const nextIndex = currentIndex + 1;
                    window.setTimeout(() => {
                        const nextBlock = blocks[nextIndex];
                        if (!nextBlock || !playerRef.current?.seekTo) return;
                        setCurrentIndex(nextIndex);
                        setIsPlayingBlock(true);
                        playerRef.current.seekTo(nextBlock.start, true);
                        playerRef.current.playVideo();
                    }, 400);
                }
            }
        }, POLL_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [currentBlock, isPlayingBlock, autoNext, loopCurrent, currentIndex, blocks]);

    const playBlock = (index: number) => {
        const block = blocks[index];
        if (!block || !playerRef.current?.seekTo) return;
        setCurrentIndex(index);
        setIsPlayingBlock(true);
        playerRef.current.seekTo(block.start, true);
        playerRef.current.playVideo();
    };

    const togglePlayBlock = () => {
        if (!playerRef.current || !currentBlock) return;
        isPlayingBlock ? playerRef.current.pauseVideo() : playBlock(currentIndex);
    };

    // Keyboard Shortcuts
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            const target = e.target as HTMLElement;
            if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
            if (!blocks.length) return;
            if (e.code === "Space") { e.preventDefault(); togglePlayBlock(); }
            else if (e.code === "ArrowRight") currentIndex < blocks.length - 1 && playBlock(currentIndex + 1);
            else if (e.code === "ArrowLeft") currentIndex > 0 && playBlock(currentIndex - 1);
            else if (e.key.toLowerCase() === "r") currentBlock && playBlock(currentIndex);
            else if (e.key.toLowerCase() === "l") { setLoopCurrent(p => !p); setAutoNext(false); }
        }
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [blocks, currentIndex, isPlayingBlock]);

    return (
        <main className="min-h-screen bg-[#0b1020] text-slate-50 relative overflow-hidden flex">

            {/* ==========================================
                FLOATING SIDEBAR (No blocking backdrop)
            ========================================== */}
            <aside
                className={`fixed inset-y-0 left-0 w-80 bg-slate-900 border-r border-slate-700 z-50 shadow-[10px_0_30px_rgba(0,0,0,0.5)] transform transition-transform duration-300 ease-in-out flex flex-col ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
            >
                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
                    <h2 className="font-bold text-cyan-400">My Library</h2>
                    <button onClick={() => setIsSidebarOpen(false)} className="text-slate-400 hover:text-white p-2 text-xl">&times;</button>
                </div>

                {/* Tabs for Add Video vs Playlist */}
                <div className="flex border-b border-slate-800 bg-slate-900">
                    <button
                        onClick={() => setAddMode("video")}
                        className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wide transition ${addMode === "video" ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-800" : "text-slate-500 hover:text-slate-300"}`}
                    >
                        Video
                    </button>
                    <button
                        onClick={() => setAddMode("playlist")}
                        className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wide transition ${addMode === "playlist" ? "text-purple-400 border-b-2 border-purple-400 bg-slate-800" : "text-slate-500 hover:text-slate-300"}`}
                    >
                        Playlist
                    </button>
                </div>

                <form onSubmit={handleAddSubmit} className="p-4 border-b border-slate-800 bg-slate-900/50">
                    <input
                        type="url"
                        required
                        value={newInputUrl}
                        onChange={(e) => setNewInputUrl(e.target.value)}
                        placeholder={addMode === "video" ? "Paste YouTube Video URL..." : "Paste YouTube Playlist URL..."}
                        className={`w-full bg-slate-800 border rounded-lg p-2 text-sm outline-none mb-2 ${addMode === "video" ? "border-slate-700 focus:border-cyan-400" : "border-slate-700 focus:border-purple-400"}`}
                    />
                    <button
                        type="submit"
                        disabled={isAddingPlaylist}
                        className={`w-full text-sm font-semibold rounded-lg py-2 transition disabled:opacity-50 ${addMode === "video" ? "bg-cyan-600 hover:bg-cyan-500" : "bg-purple-600 hover:bg-purple-500"}`}
                    >
                        {isAddingPlaylist ? "Processing..." : (addMode === "video" ? "+ Add Video" : "+ Import Playlist")}
                    </button>
                </form>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                    {library.length === 0 ? (
                        <p className="text-sm text-slate-500 text-center mt-10">Library is empty.</p>
                    ) : (
                        library.map((vid) => (
                            <div
                                key={vid.id}
                                onClick={() => loadFromLibrary(vid.url)}
                                className={`flex gap-3 p-2 rounded-xl mb-2 cursor-pointer transition group border ${sourceUrl === vid.url ? 'bg-slate-800 border-cyan-500/50' : 'bg-transparent border-transparent hover:bg-slate-800 hover:border-slate-700'}`}
                            >
                                <img src={vid.thumbnail} alt={vid.title} className="w-20 h-14 object-cover rounded-md bg-black shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-200 line-clamp-2 leading-tight mb-1">{vid.title}</p>
                                    <button onClick={(e) => removeVideo(vid.id, e)} className="text-xs text-rose-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition">Delete</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </aside>

            {/* ==========================================
                MAIN CONTENT (Not shrinked, fully interactive)
            ========================================== */}
            <div className="flex-1 p-4 sm:p-6 w-full max-w-6xl mx-auto flex flex-col min-h-screen relative z-10">
                <header className="flex flex-col gap-3 mb-6 relative">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <button
                            onClick={() => setIsSidebarOpen(prev => !prev)}
                            className="bg-slate-800 hover:bg-slate-700 p-3 rounded-xl border border-slate-700 transition flex items-center justify-center shrink-0 w-12"
                            title="Toggle Library"
                        >
                            ☰
                        </button>

                        <div className="flex-1">
                            <input
                                value={sourceUrl}
                                onChange={(e) => setSourceUrl(e.target.value)}
                                className="w-full rounded-xl bg-slate-900 p-3 border border-slate-700 outline-none focus:border-cyan-400"
                                placeholder="Paste a YouTube link..."
                            />
                        </div>

                        <div className="flex gap-3 shrink-0">
                            <select
                                value={language}
                                onChange={(e) => setLanguage(e.target.value)}
                                className="bg-slate-900 border border-slate-700 rounded-xl p-3 outline-none focus:border-cyan-400 cursor-pointer"
                            >
                                {SUPPORTED_LANGUAGES.map(lang => (
                                    <option key={lang.code} value={lang.code}>{lang.label}</option>
                                ))}
                            </select>

                            <button onClick={() => setShowSettings((s) => !s)} className="px-4 bg-slate-800 hover:bg-slate-700 rounded-xl font-medium transition border border-slate-700">⚙</button>
                            <button
                                onClick={() => handleFetch()}
                                disabled={status === "loading"}
                                className="bg-cyan-600 text-slate-100 px-8 rounded-xl font-bold hover:bg-cyan-500 transition disabled:opacity-50"
                            >
                                {status === "loading" ? "Analyzing..." : "Load Data"}
                            </button>
                        </div>
                    </div>

                    {showSettings && (
                        <div className="flex flex-wrap gap-6 p-5 rounded-xl bg-slate-900/80 border border-slate-800 mt-2">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs uppercase tracking-wider text-slate-400">Min block (s)</label>
                                <input type="number" min={2} max={maxDuration - 1} value={minDuration} onChange={(e) => setMinDuration(Number(e.target.value) || DEFAULT_MIN_DURATION)} className="w-24 rounded-lg bg-slate-950 p-2 border border-slate-700 outline-none focus:border-cyan-400 text-sm" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs uppercase tracking-wider text-slate-400">Max block (s)</label>
                                <input type="number" min={minDuration + 1} max={120} value={maxDuration} onChange={(e) => setMaxDuration(Number(e.target.value) || DEFAULT_MAX_DURATION)} className="w-24 rounded-lg bg-slate-950 p-2 border border-slate-700 outline-none focus:border-cyan-400 text-sm" />
                            </div>
                        </div>
                    )}
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
                    <section className="flex flex-col gap-4">
                        <div className="aspect-video bg-black rounded-xl overflow-hidden border border-slate-800 shadow-2xl relative">
                            <div id="youtube-player" className="w-full h-full" />
                        </div>

                        <div className="flex justify-between items-center mt-1">
                            <p className={`text-sm font-medium ${status === "error" ? "text-amber-400" : "text-cyan-400"}`}>
                                {message}
                            </p>
                            <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
                                {PLAYBACK_SPEEDS.map(speed => (
                                    <button
                                        key={speed} onClick={() => changeSpeed(speed)}
                                        className={`px-2 py-1 text-xs font-bold rounded ${playbackRate === speed ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                                    >
                                        {speed}x
                                    </button>
                                ))}
                            </div>
                        </div>

                        {blocks.length > 0 && (
                            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${((currentIndex + 1) / blocks.length) * 100}%` }} />
                            </div>
                        )}

                        <div className="grid grid-cols-4 gap-2">
                            <button onClick={() => currentIndex > 0 && playBlock(currentIndex - 1)} disabled={currentIndex === 0} className="bg-slate-800 hover:bg-slate-700 py-3 rounded-xl font-bold transition border border-slate-700 disabled:opacity-40">⏮ Prev</button>
                            <button onClick={togglePlayBlock} disabled={!currentBlock} className="bg-violet-600 hover:bg-violet-500 py-3 rounded-xl font-bold transition disabled:opacity-40 text-white">
                                {isPlayingBlock ? "⏸ Pause" : "▶ Play"}
                            </button>
                            <button onClick={() => currentBlock && playBlock(currentIndex)} disabled={!currentBlock} className="bg-slate-800 hover:bg-slate-700 py-3 rounded-xl font-bold transition border border-slate-700 disabled:opacity-40">↺ Replay</button>
                            <button onClick={() => currentIndex < blocks.length - 1 && playBlock(currentIndex + 1)} disabled={currentIndex >= blocks.length - 1} className="bg-slate-800 hover:bg-slate-700 py-3 rounded-xl font-bold transition border border-slate-700 disabled:opacity-40">Next ⏭</button>
                        </div>

                        <div className="flex gap-2">
                            <button onClick={() => setIsBlind(!isBlind)} className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 rounded-xl font-medium transition border flex gap-2 justify-center items-center">
                                {isBlind ? "👁️ Show Script" : "🙈 Blind Mode"}
                            </button>
                            <button onClick={() => { setLoopCurrent(!loopCurrent); setAutoNext(false); }} className={`flex-1 py-3 rounded-xl font-medium transition border flex justify-center items-center gap-2 ${loopCurrent ? 'bg-amber-900/50 border-amber-500 text-amber-400' : 'bg-slate-900 border-slate-700 hover:bg-slate-800'}`}>
                                🔁 Auto-Loop
                            </button>
                            <button onClick={() => { setAutoNext(!autoNext); setLoopCurrent(false); }} className={`flex-1 py-3 rounded-xl font-medium transition border flex justify-center items-center gap-2 ${autoNext ? 'bg-emerald-900/50 border-emerald-500 text-emerald-400' : 'bg-slate-900 border-slate-700 hover:bg-slate-800'}`}>
                                ⏭️ Auto-Next
                            </button>
                        </div>
                    </section>

                    <section className="flex flex-col gap-4 lg:h-[calc(100vh-140px)]">
                        <div className="p-5 border border-slate-700 rounded-xl bg-slate-800/40 min-h-[140px] flex flex-col justify-center shadow-inner relative">
                            <span className="absolute top-3 right-4 text-xs font-bold text-slate-500 bg-slate-900 px-2 py-1 rounded">
                                {blocks.length > 0 ? `${currentIndex + 1} / ${blocks.length}` : "0 / 0"}
                            </span>
                            {!isBlind ? (
                                <p className="text-xl text-slate-100 leading-relaxed font-medium">
                                    {currentBlock?.text || "Load a video to see transcripts here."}
                                </p>
                            ) : (
                                <div className="flex items-center gap-2 text-slate-500">
                                    <span className="text-2xl">🙈</span>
                                    <span>Script is hidden. Focus on listening.</span>
                                </div>
                            )}
                        </div>

                        <DictationBox key={currentBlock?.id ?? "empty"} expectedText={currentBlock?.text ?? ""} />

                        <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-2 custom-scrollbar max-h-80 lg:max-h-none mt-2">
                            {blocks.map((b, i) => (
                                <button
                                    key={b.id} onClick={() => playBlock(i)}
                                    className={`p-3 text-left border rounded-xl transition ${i === currentIndex ? "border-cyan-500 bg-cyan-900/30" : "border-slate-800 hover:bg-slate-800/80 bg-slate-900/40"}`}
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <span className={`font-bold ${i === currentIndex ? 'text-cyan-400' : 'text-slate-400'}`}>Block {i + 1}</span>
                                        <span className="text-xs text-slate-500 font-mono">{b.start.toFixed(1)}s - {b.end.toFixed(1)}s</span>
                                    </div>
                                    <p className={`text-sm line-clamp-2 ${i === currentIndex ? 'text-slate-200' : 'text-slate-500'}`}>{b.text}</p>
                                </button>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </main>
    );
}
