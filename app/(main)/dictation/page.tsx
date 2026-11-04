"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    App as AntApp, Button, Card, Col, ConfigProvider, Drawer, Flex, Input, InputNumber, List, Popover,
    Progress, Row, Segmented, Select, Slider, Spin, Switch, Tabs, Typography, theme,
} from "antd";
import {
    DeleteOutlined, MenuOutlined, MoonOutlined, PauseCircleFilled, PlayCircleFilled, ReloadOutlined,
    SettingOutlined, StepBackwardOutlined, StepForwardOutlined, SunOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

type Block = { id: string; text: string; start: number; end: number };
type Video = { id: string; title: string; thumbnail: string };
type Mode = "off" | "loop" | "next" | "shadow";

declare global {
    interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

// ==========================================
// CONSTANTS & HELPERS
// ==========================================
const CUTOFF = 0.1; // dừng sớm một chút để bù độ trễ của lệnh pause
const POLL_MS = 40;
const PASS_PERCENT = 70;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];
const LANGS = [
    ["ja", "日本語"], ["en", "English"], ["vi", "Tiếng Việt"], ["ko", "한국어"],
    ["zh", "中文"], ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"],
].map(([value, label]) => ({ value, label }));
const MODE_HINT: Record<Mode, string> = {
    off: "Phát hết block rồi dừng.",
    loop: "Lặp lại block hiện tại.",
    next: "Tự chuyển sang block kế tiếp.",
    shadow: "Dừng một khoảng bằng độ dài block để bạn đọc theo (shadowing), rồi chuyển block.",
};
const CSS = `.blur-text{filter:blur(8px);user-select:none;transition:filter .2s}`;

const thumb = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
const videoIdOf = (u: string) => u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i)?.[1] ?? null;
const playlistIdOf = (u: string) => u.match(/[?&]list=([\w-]+)/)?.[1] ?? null;

const store = {
    get<T>(key: string, fallback: T): T {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
};

async function fetchTitle(url: string) {
    try {
        return (await (await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`)).json()).title || "Untitled";
    } catch { return "Untitled"; }
}

function fallbackBlocks(duration: number, sec: number): Block[] {
    const count = Math.max(1, Math.ceil(duration / sec));
    return Array.from({ length: count }, (_, i) => ({
        id: `auto-${i}`,
        text: `[Không có phụ đề] Nghe đoạn ${i + 1}`,
        start: Number(((duration / count) * i).toFixed(2)),
        end: Number(((duration / count) * (i + 1)).toFixed(2)),
    }));
}

function loadYouTubeApi(): Promise<void> {
    return new Promise((resolve) => {
        if (window.YT?.Player) return resolve();
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
        if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
            const tag = document.createElement("script");
            tag.src = "https://www.youtube.com/iframe_api";
            document.body.appendChild(tag);
        }
    });
}

const norm = (s: string) => s.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
function similarity(typed: string, expected: string): number {
    const x = [...norm(typed)], y = [...norm(expected)];
    if (!x.length && !y.length) return 100;
    let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
    for (let i = 1; i <= x.length; i++) {
        const cur = [i];
        for (let j = 1; j <= y.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return Math.max(0, Math.round((1 - prev[y.length] / Math.max(x.length, y.length)) * 100));
}

// ==========================================
// DICTATION BOX
// ==========================================
const Dictation = memo(function Dictation({ id, expected, onPass }: { id: string; expected: string; onPass: (id: string) => void }) {
    const [draft, setDraft] = useState("");
    const sim = useMemo(() => (draft.trim() ? similarity(draft, expected) : 0), [draft, expected]);
    const ok = sim >= PASS_PERCENT;
    useEffect(() => { if (ok) onPass(id); }, [ok, id, onPass]);

    return (
        <Flex vertical gap={8}>
            <Input.TextArea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="Gõ những gì bạn nghe được..."
                spellCheck={false}
                style={{ fontSize: 16 }}
            />
            {draft.trim() && (
                <Flex align="center" gap={12}>
                    <Progress percent={sim} size="small" status={ok ? "success" : "active"} style={{ flex: 1, margin: 0 }} />
                    <Text type={ok ? "success" : "warning"}>{ok ? "Chuẩn!" : `Cần ${PASS_PERCENT}%`}</Text>
                </Flex>
            )}
        </Flex>
    );
});

// ==========================================
// ROOT: theme provider
// ==========================================
export default function Page() {
    const [dark, setDark] = useState(true);
    useEffect(() => setDark(store.get("sh_dark", true)), []);
    const switchTheme = (v: boolean) => { setDark(v); store.set("sh_dark", v); };

    return (
        <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { borderRadius: 10 } }}>
            <AntApp>
                <Shadowing dark={dark} onTheme={switchTheme} />
            </AntApp>
        </ConfigProvider>
    );
}

// ==========================================
// MAIN APP
// ==========================================
function Shadowing({ dark, onTheme }: { dark: boolean; onTheme: (v: boolean) => void }) {
    const { message } = AntApp.useApp();
    const { token } = theme.useToken();

    const [url, setUrl] = useState("");
    const [lang, setLang] = useState("ja");
    const [minD, setMinD] = useState(7);
    const [maxD, setMaxD] = useState(20);

    const [vid, setVid] = useState<string | null>(null);
    const [blocks, setBlocks] = useState<Block[]>([]);
    const [idx, setIdx] = useState(0);
    const [done, setDone] = useState<Record<string, true>>({});
    const [status, setStatus] = useState<"idle" | "loading" | "ready">("idle");
    const [playing, setPlaying] = useState(false);

    const [mode, setMode] = useState<Mode>("off");
    const [rate, setRate] = useState(1);
    const [scriptMode, setScriptMode] = useState<"show" | "blur" | "hide">("blur");
    const [revealed, setRevealed] = useState(false);
    const [cover, setCover] = useState<"off" | "bottom" | "top">("off");
    const [coverH, setCoverH] = useState(25);

    const [drawer, setDrawer] = useState(false);
    const [library, setLibrary] = useState<Video[]>([]);
    const [addTab, setAddTab] = useState("video");
    const [addInput, setAddInput] = useState("");
    const [adding, setAdding] = useState(false);

    const playerRef = useRef<any>(null);
    const nextTimer = useRef<number>(0);
    const listRef = useRef<HTMLDivElement>(null);
    const live = useRef<any>({});

    const cur = blocks[idx] ?? null;

    useEffect(() => {
        setLibrary(store.get("sh_library", []));
        setUrl(store.get("sh_url", ""));
        return () => { clearTimeout(nextTimer.current); playerRef.current?.destroy?.(); };
    }, []);

    // lưu tiến độ theo video
    useEffect(() => {
        if (vid && blocks.length) store.set(`sh_p_${vid}`, { idx, done });
    }, [vid, blocks, idx, done]);

    // cuộn danh sách tới block hiện tại (chỉ trong khung danh sách, không kéo cả trang)
    useEffect(() => {
        const el = document.getElementById(`blk-${idx}`), box = listRef.current;
        if (el && box) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
    }, [idx, blocks]);

    // ---------- Player ----------
    const ensurePlayer = async (id: string) => {
        await loadYouTubeApi();
        const p = playerRef.current;
        if (p?.cueVideoById) { p.pauseVideo?.(); p.cueVideoById(id); return; } // cue = nạp video nhưng KHÔNG tự phát
        await new Promise<void>((resolve) => {
            playerRef.current = new window.YT.Player("yt-player", {
                videoId: id, width: "100%", height: "100%",
                playerVars: { autoplay: 0, controls: 0, disablekb: 1, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, cc_load_policy: 0 },
                events: {
                    onReady: (e: any) => { e.target.unloadModule?.("captions"); resolve(); },
                    onStateChange: (e: any) => {
                        const S = window.YT.PlayerState;
                        if (e.data === S.PLAYING) {
                            setPlaying(true);
                            if (e.target.getPlaybackRate() !== live.current.rate) e.target.setPlaybackRate(live.current.rate);
                        } else if (e.data === S.PAUSED || e.data === S.ENDED) setPlaying(false);
                    },
                },
            });
        });
    };

    const playBlock = (i: number) => {
        const b = live.current.blocks[i], p = playerRef.current;
        if (!b || !p?.seekTo) return;
        clearTimeout(nextTimer.current);
        setIdx(i); setRevealed(false); setPlaying(true);
        p.seekTo(b.start, true);
        p.playVideo();
    };
    const toggle = () => (live.current.playing ? playerRef.current?.pauseVideo() : playBlock(live.current.idx));
    const changeRate = (r: number) => { setRate(r); playerRef.current?.setPlaybackRate?.(r); };

    live.current = { blocks, idx, mode, rate, playing };

    // ---------- Dừng đúng cuối block ----------
    useEffect(() => {
        if (!playing) return;
        const timer = window.setInterval(() => {
            const p = playerRef.current, { blocks, idx, mode, rate } = live.current, b: Block | undefined = blocks[idx];
            if (!p || !b || p.getPlayerState?.() !== 1 || p.getCurrentTime() < b.end - CUTOFF) return;
            if (mode === "loop") return void p.seekTo(b.start, true);

            p.pauseVideo();
            setPlaying(false);
            if ((mode === "next" || mode === "shadow") && idx < blocks.length - 1) {
                const wait = mode === "shadow" ? ((b.end - b.start) / rate) * 1000 + 300 : 400;
                clearTimeout(nextTimer.current);
                nextTimer.current = window.setTimeout(() => playBlock(idx + 1), wait);
            }
        }, POLL_MS);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing]);

    // ---------- Phím tắt ----------
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) return;
            const { blocks, idx } = live.current;
            if (!blocks.length) return;
            const k = e.key.toLowerCase();
            if (e.code === "Space") { e.preventDefault(); toggle(); }
            else if (e.code === "ArrowRight" && idx < blocks.length - 1) playBlock(idx + 1);
            else if (e.code === "ArrowLeft" && idx > 0) playBlock(idx - 1);
            else if (k === "r") playBlock(idx);
            else if (k === "l") setMode((m) => (m === "loop" ? "off" : "loop"));
            else if (k === "b") setRevealed((v) => !v);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---------- Load ----------
    const load = async (u = url) => {
        const id = videoIdOf(u);
        if (!id) return message.error("URL YouTube không hợp lệ");
        store.set("sh_url", u);
        setUrl(u); setVid(id); setStatus("loading"); setBlocks([]); setIdx(0); setDone({}); setPlaying(false); setRevealed(false);
        clearTimeout(nextTimer.current);

        await ensurePlayer(id);
        let list: Block[];
        try {
            const q = new URLSearchParams({ videoId: id, lang, minDuration: String(minD), maxDuration: String(maxD) });
            const res = await (await fetch(`/api/transcript?${q}`)).json();
            if (!res.success || !res.data.length) throw new Error(res.error);
            list = res.data;
            message.success(`Đã tách ${list.length} block`);
        } catch {
            await new Promise((r) => setTimeout(r, 800)); // đợi player có duration
            list = fallbackBlocks(playerRef.current?.getDuration?.() || 180, (minD + maxD) / 2);
            message.warning("Không có phụ đề — chia theo thời lượng");
        }
        const saved = store.get<{ idx: number; done: Record<string, true> }>(`sh_p_${id}`, { idx: 0, done: {} });
        const ids = new Set(list.map((b) => b.id));
        setBlocks(list);
        setIdx(Math.min(saved.idx, list.length - 1));
        setDone(Object.fromEntries(Object.keys(saved.done).filter((k) => ids.has(k)).map((k) => [k, true as const])));
        setStatus("ready");
    };

    // ---------- Library ----------
    const updateLibrary = (next: Video[]) => { setLibrary(next); store.set("sh_library", next); };
    const addToLibrary = (items: Video[]) => {
        const fresh = items.filter((v) => !library.some((l) => l.id === v.id));
        if (fresh.length) updateLibrary([...fresh, ...library]);
        return fresh.length;
    };
    const submitAdd = async (value: string) => {
        setAdding(true);
        try {
            if (addTab === "video") {
                const id = videoIdOf(value);
                if (!id) return message.error("URL video không hợp lệ");
                const added = addToLibrary([{ id, title: await fetchTitle(value), thumbnail: thumb(id) }]);
                added ? message.success("Đã thêm video") : message.info("Video đã có trong thư viện");
            } else {
                const pl = playlistIdOf(value);
                if (!pl) return message.error("URL playlist không hợp lệ");
                const res = await (await fetch(`/api/transcript?playlist=${pl}`)).json();
                if (!res.success) throw new Error(res.error);
                message.success(`Đã thêm ${addToLibrary(res.data)} video`);
            }
            setAddInput("");
        } catch (e: any) {
            message.error(e?.message || "Có lỗi xảy ra");
        } finally {
            setAdding(false);
        }
    };

    const onPass = useCallback((id: string) => setDone((d) => (d[id] ? d : { ...d, [id]: true })), []);
    const doneCount = Object.keys(done).length;
    const scriptHidden = scriptMode !== "show" && !revealed;

    return (
        <div style={{ minHeight: "100vh", background: token.colorBgLayout, color: token.colorText }}>
            <style>{CSS}</style>
            <div style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 12px 32px" }}>
                {/* ---------- Header ---------- */}
                <Flex gap={8} wrap align="center" style={{ marginBottom: 12 }}>
                    <Button icon={<MenuOutlined />} onClick={() => setDrawer(true)} />
                    <Input
                        allowClear value={url} onChange={(e) => setUrl(e.target.value)} onPressEnter={() => load()}
                        placeholder="Dán link YouTube..." style={{ flex: "1 1 220px", minWidth: 0 }}
                    />
                    <Select value={lang} onChange={setLang} options={LANGS} style={{ width: 130 }} />
                    <Popover
                        trigger="click" title="Độ dài block (giây)"
                        content={
                            <Flex vertical gap={8} style={{ width: 200 }}>
                                <Flex justify="space-between" align="center">Tối thiểu
                                    <InputNumber size="small" min={2} max={maxD - 1} value={minD} onChange={(v) => setMinD(v ?? 7)} />
                                </Flex>
                                <Flex justify="space-between" align="center">Tối đa
                                    <InputNumber size="small" min={minD + 1} max={120} value={maxD} onChange={(v) => setMaxD(v ?? 20)} />
                                </Flex>
                                <Text type="secondary" style={{ fontSize: 12 }}>Là độ dài mục tiêu, thuật toán vẫn ưu tiên ngắt ở chỗ tự nhiên. Bấm Load để áp dụng.</Text>
                            </Flex>
                        }
                    >
                        <Button icon={<SettingOutlined />} />
                    </Popover>
                    <Switch checked={dark} onChange={onTheme} checkedChildren={<MoonOutlined />} unCheckedChildren={<SunOutlined />} />
                    <Button type="primary" loading={status === "loading"} onClick={() => load()}>Load</Button>
                </Flex>

                <Row gutter={[16, 16]}>
                    {/* ---------- Left: video + controls ---------- */}
                    <Col xs={24} lg={12}>
                        <Flex vertical gap={12}>
                            <div style={{ position: "relative", aspectRatio: "16/9", background: "#000", borderRadius: 12, overflow: "hidden" }}>
                                <div style={{ position: "absolute", inset: 0 }}><div id="yt-player" /></div>
                                {cover !== "off" && (
                                    <div
                                        style={{
                                            position: "absolute", left: 0, right: 0, [cover]: 0, height: `${coverH}%`,
                                            background: dark ? "#141414" : "#f0f0f0", color: token.colorTextTertiary,
                                            display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
                                        }}
                                    >
                                        Phụ đề đang được che
                                    </div>
                                )}
                            </div>

                            {blocks.length > 0 && (
                                <Flex align="center" gap={12}>
                                    <Progress percent={Math.round(((idx + 1) / blocks.length) * 100)} showInfo={false} size="small" style={{ flex: 1, margin: 0 }} />
                                    <Text type="secondary" style={{ whiteSpace: "nowrap" }}>Đã chuẩn {doneCount}/{blocks.length}</Text>
                                </Flex>
                            )}

                            <Flex gap={8}>
                                <Button size="large" icon={<StepBackwardOutlined />} disabled={!cur || idx === 0} onClick={() => playBlock(idx - 1)} />
                                <Button size="large" type="primary" style={{ flex: 2 }} disabled={!cur} onClick={toggle}
                                    icon={playing ? <PauseCircleFilled /> : <PlayCircleFilled />}>
                                    {playing ? "Pause" : "Play"}
                                </Button>
                                <Button size="large" style={{ flex: 1 }} icon={<ReloadOutlined />} disabled={!cur} onClick={() => playBlock(idx)}>Replay</Button>
                                <Button size="large" icon={<StepForwardOutlined />} disabled={!cur || idx >= blocks.length - 1} onClick={() => playBlock(idx + 1)} />
                            </Flex>

                            <Card size="small">
                                <Flex vertical gap={12}>
                                    <Flex align="center" gap={8} wrap>
                                        <Text type="secondary" style={{ width: 72 }}>Tốc độ</Text>
                                        <Segmented size="small" value={rate} onChange={changeRate} options={SPEEDS.map((s) => ({ label: `${s}x`, value: s }))} />
                                    </Flex>
                                    <div>
                                        <Flex align="center" gap={8} wrap>
                                            <Text type="secondary" style={{ width: 72 }}>Chế độ</Text>
                                            <Segmented size="small" value={mode} onChange={(v) => setMode(v as Mode)}
                                                options={[{ label: "Tắt", value: "off" }, { label: "Lặp", value: "loop" }, { label: "Tự chuyển", value: "next" }, { label: "Shadow", value: "shadow" }]} />
                                        </Flex>
                                        <Text type="secondary" style={{ fontSize: 12 }}>{MODE_HINT[mode]}</Text>
                                    </div>
                                    <Flex align="center" gap={8} wrap>
                                        <Text type="secondary" style={{ width: 72 }}>Che phụ đề</Text>
                                        <Segmented size="small" value={cover} onChange={(v) => setCover(v as typeof cover)}
                                            options={[{ label: "Tắt", value: "off" }, { label: "Dưới", value: "bottom" }, { label: "Trên", value: "top" }]} />
                                        {cover !== "off" && <Slider min={10} max={50} value={coverH} onChange={setCoverH} style={{ flex: 1, minWidth: 100, margin: "0 8px" }} />}
                                    </Flex>
                                </Flex>
                            </Card>
                            <Text type="secondary" style={{ fontSize: 12 }}>Phím tắt: Space phát/dừng · ←/→ block · R nghe lại · L lặp · B hiện/ẩn script</Text>
                        </Flex>
                    </Col>

                    {/* ---------- Right: script + dictation + list ---------- */}
                    <Col xs={24} lg={12}>
                        <Spin spinning={status === "loading"} tip="Đang tải phụ đề...">
                            <Flex vertical gap={12}>
                                <Card
                                    size="small"
                                    title={`Block ${blocks.length ? idx + 1 : 0} / ${blocks.length}`}
                                    extra={
                                        <Segmented size="small" value={scriptMode} onChange={(v) => { setScriptMode(v as typeof scriptMode); setRevealed(false); }}
                                            options={[{ label: "Hiện", value: "show" }, { label: "Mờ", value: "blur" }, { label: "Ẩn", value: "hide" }]} />
                                    }
                                >
                                    <div
                                        onClick={() => scriptMode !== "show" && setRevealed((r) => !r)}
                                        className={scriptMode === "blur" && scriptHidden ? "blur-text" : ""}
                                        style={{ fontSize: 20, lineHeight: 1.6, minHeight: 64, cursor: scriptMode === "show" ? "default" : "pointer" }}
                                    >
                                        {scriptMode === "hide" && scriptHidden
                                            ? <Text type="secondary">Script đang ẩn — bấm để xem</Text>
                                            : cur?.text ?? <Text type="secondary">Load video để bắt đầu.</Text>}
                                    </div>
                                </Card>

                                <Dictation key={cur?.id ?? "empty"} id={cur?.id ?? ""} expected={cur?.text ?? ""} onPass={onPass} />

                                <div ref={listRef} style={{ position: "relative", maxHeight: 340, overflowY: "auto" }}>
                                    <Flex vertical gap={6}>
                                        {blocks.map((b, i) => {
                                            const hide = scriptMode !== "show" && !done[b.id];
                                            return (
                                                <div
                                                    key={b.id} id={`blk-${i}`} onClick={() => playBlock(i)}
                                                    style={{
                                                        padding: "8px 12px", borderRadius: 10, cursor: "pointer",
                                                        border: `1px solid ${i === idx ? token.colorPrimary : token.colorBorderSecondary}`,
                                                        background: i === idx ? token.colorPrimaryBg : token.colorBgContainer,
                                                    }}
                                                >
                                                    <Flex justify="space-between">
                                                        <Text strong type={i === idx ? undefined : "secondary"}>{done[b.id] ? "✓ " : ""}Block {i + 1}</Text>
                                                        <Text type="secondary" style={{ fontSize: 12 }}>{b.start.toFixed(1)}s – {b.end.toFixed(1)}s</Text>
                                                    </Flex>
                                                    <div className={hide && scriptMode === "blur" ? "blur-text" : ""}
                                                        style={{ fontSize: 13, color: token.colorTextSecondary, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                                        {hide && scriptMode === "hide" ? "•••" : b.text}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </Flex>
                                </div>
                            </Flex>
                        </Spin>
                    </Col>
                </Row>
            </div>

            {/* ---------- Library drawer ---------- */}
            <Drawer title="Thư viện" placement="left" width={360} open={drawer} onClose={() => setDrawer(false)} styles={{ body: { padding: 12 } }}>
                <Tabs size="small" activeKey={addTab} onChange={setAddTab} items={[{ key: "video", label: "Video" }, { key: "playlist", label: "Playlist" }]} />
                <Input.Search
                    value={addInput} onChange={(e) => setAddInput(e.target.value)} loading={adding} onSearch={submitAdd}
                    enterButton={addTab === "video" ? "Thêm" : "Import"}
                    placeholder={addTab === "video" ? "Dán link video..." : "Dán link playlist..."}
                />
                <List
                    style={{ marginTop: 12 }} dataSource={library} locale={{ emptyText: "Thư viện trống" }}
                    renderItem={(v) => (
                        <List.Item
                            style={{ cursor: "pointer", padding: 8, borderRadius: 8, background: v.id === vid ? token.colorPrimaryBg : undefined }}
                            onClick={() => { setDrawer(false); load(`https://www.youtube.com/watch?v=${v.id}`); }}
                            actions={[<Button key="del" type="text" danger size="small" icon={<DeleteOutlined />}
                                onClick={(e) => { e.stopPropagation(); updateLibrary(library.filter((x) => x.id !== v.id)); }} />]}
                        >
                            <List.Item.Meta
                                avatar={<img src={v.thumbnail} alt="" style={{ width: 72, height: 48, objectFit: "cover", borderRadius: 6 }} />}
                                title={<Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0, fontSize: 13 }}>{v.title}</Typography.Paragraph>}
                            />
                        </List.Item>
                    )}
                />
            </Drawer>
        </div>
    );
}
