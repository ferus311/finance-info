"use client";

import { useEffect, useState, useRef } from "react";

type Article = {
    id: string;
    title: string;
    link: string;
    pubDate: string;
    summary: string;
    thumbnail: string | null;
};

type ReaderData = {
    title: string;
    byline: string | null;
    siteName: string | null;
    lang?: string | null;
    content: string;
};

type ReaderState =
    | { status: "loading" }
    | { status: "ready"; data: ReaderData }
    | { status: "error"; message: string };

interface FeedCategory {
    id: string;
    label: string;
    url: string;
}

interface NewsSource {
    id: string;
    name: string;
    categories: FeedCategory[];
}

const API = "/api/newsfeed";

// Two-level data structure: news source -> list of categories
const NEWS_SOURCES: NewsSource[] = [
    {
        id: "vnexpress",
        name: "VnExpress",
        categories: [
            { id: "vne-news", label: "News", url: "https://vnexpress.net/rss/thoi-su.rss" },
            { id: "vne-world", label: "World", url: "https://vnexpress.net/rss/the-gioi.rss" },
            { id: "vne-biz", label: "Business", url: "https://vnexpress.net/rss/kinh-doanh.rss" },
            { id: "vne-tech", label: "Science & Tech", url: "https://vnexpress.net/rss/khoa-hoc.rss" },
            { id: "vne-latest", label: "Latest", url: "https://vnexpress.net/rss/tin-moi-nhat.rss" },
        ],
    },
    {
        id: "tuoitre",
        name: "Tuoi Tre",
        categories: [
            { id: "tt-news", label: "News", url: "https://tuoitre.vn/rss/thoi-su.rss" },
            { id: "tt-world", label: "World", url: "https://tuoitre.vn/rss/the-gioi.rss" },
            { id: "tt-biz", label: "Business", url: "https://tuoitre.vn/rss/kinh-doanh.rss" },
            { id: "tt-tech", label: "Digital Life", url: "https://tuoitre.vn/rss/nhip-song-so.rss" },
            { id: "tt-latest", label: "Latest", url: "https://tuoitre.vn/rss/tin-moi-nhat.rss" },
        ],
    },
    {
        id: "yahoo-jp",
        name: "Yahoo! Japan",
        categories: [
            // { id: "yw-tokyo", label: "Weather", url: "https://rss-weather.yahoo.co.jp/rss/days/4410.xml" },
            { id: "yjp-top", label: "Top", url: "https://news.yahoo.co.jp/rss/topics/top-picks.xml" },
            { id: "yjp-biz", label: "Economy", url: "https://news.yahoo.co.jp/rss/categories/business.xml" },
            { id: "yjp-it", label: "IT & Science", url: "https://news.yahoo.co.jp/rss/categories/it.xml" },
            { id: "yjp-world", label: "World", url: "https://news.yahoo.co.jp/rss/categories/world.xml" },
        ],
    },
    {
        id: "nhk",
        name: "NHK News",
        categories: [
            { id: "nhk-top", label: "Top", url: "https://www.nhk.or.jp/rss/news/cat0.xml" },
            { id: "nhk-social", label: "Society", url: "https://www.nhk.or.jp/rss/news/cat1.xml" },
            { id: "nhk-eco", label: "Economy", url: "https://www.nhk.or.jp/rss/news/cat5.xml" },
            { id: "nhk-world", label: "World", url: "https://www.nhk.or.jp/rss/news/cat6.xml" },
            { id: "nhk-sci", label: "Science & Culture", url: "https://www.nhk.or.jp/rss/news/cat3.xml" },
        ],
    },
];

// Styles for the article's HTML body (no @tailwindcss/typography plugin needed)
const ARTICLE_BODY_CLASS = [
    "text-[1.05rem] leading-8 text-gray-800 break-words",
    "[&_p]:my-4",
    "[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold",
    "[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold",
    "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold",
    "[&_a]:text-blue-600 [&_a]:underline",
    "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6",
    "[&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6",
    "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-gray-600",
    "[&_figure]:my-6",
    "[&_img]:mx-auto [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg",
    "[&_figcaption]:mt-2 [&_figcaption]:text-center [&_figcaption]:text-sm [&_figcaption]:text-gray-500",
    "[&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2",
    "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-gray-100 [&_pre]:p-3",
].join(" ");

const formatDate = (value: string | null | undefined) => {
    if (!value) return "Recently updated";
    const d = new Date(value);
    return isNaN(d.getTime()) ? "Recently updated" : d.toLocaleString("en-US");
};

export default function MarketIntelligenceDesk() {
    const [activeSourceId, setActiveSourceId] = useState<string>(NEWS_SOURCES[0].id);
    const [activeCategoryId, setActiveCategoryId] = useState<string>(NEWS_SOURCES[0].categories[0].id);

    const [articles, setArticles] = useState<Article[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Reader (in-page article view)
    const [selected, setSelected] = useState<Article | null>(null);
    const [reader, setReader] = useState<ReaderState>({ status: "loading" });

    // Cache article lists by RSS URL and article bodies by article URL
    const cacheRef = useRef<Record<string, Article[]>>({});
    const readerCacheRef = useRef<Record<string, ReaderData>>({});

    const activeSource = NEWS_SOURCES.find((s) => s.id === activeSourceId)!;
    const activeCategory = activeSource.categories.find((c) => c.id === activeCategoryId) || activeSource.categories[0];

    // When the source changes, automatically select its first category
    const handleSourceChange = (sourceId: string) => {
        const newSource = NEWS_SOURCES.find((s) => s.id === sourceId)!;
        setActiveSourceId(sourceId);
        setActiveCategoryId(newSource.categories[0].id);
    };

    const fetchRssData = async (url: string, forceRefresh = false, signal?: AbortSignal) => {
        if (!forceRefresh && cacheRef.current[url]) {
            setArticles(cacheRef.current[url]);
            setError(null);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`${API}?type=feed&url=${encodeURIComponent(url)}`, { signal });
            if (!response.ok) throw new Error("Proxy response error");

            const responseData = await response.json();
            const fetchedArticles: Article[] = responseData.articles || [];

            cacheRef.current[url] = fetchedArticles;
            setArticles(fetchedArticles);
        } catch (err: any) {
            if (err.name === "AbortError") return;
            setError("Could not load the RSS feed. Please try again.");
        } finally {
            if (!signal?.aborted) setIsLoading(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        fetchRssData(activeCategory.url, false, controller.signal);
        return () => controller.abort();
    }, [activeCategory.url]);

    // Load the article body when the reader opens
    useEffect(() => {
        if (!selected) return;

        const url = selected.link;
        const cached = readerCacheRef.current[url];
        if (cached) {
            setReader({ status: "ready", data: cached });
            return;
        }

        setReader({ status: "loading" });
        const controller = new AbortController();

        (async () => {
            try {
                const res = await fetch(`${API}?type=article&url=${encodeURIComponent(url)}`, {
                    signal: controller.signal,
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || "Could not load the article.");

                readerCacheRef.current[url] = json;
                setReader({ status: "ready", data: json });
            } catch (err: any) {
                if (err.name === "AbortError") return;
                setReader({ status: "error", message: err.message || "Could not load the article." });
            }
        })();

        return () => controller.abort();
    }, [selected]);

    // Lock background scroll and close on Esc while the reader is open
    useEffect(() => {
        if (!selected) return;

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSelected(null);
        };
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKey);

        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener("keydown", onKey);
        };
    }, [selected]);

    const renderSkeletons = () => (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6">
            {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="flex h-[250px] flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6">
                    <div className="h-6 w-[90%] animate-pulse rounded bg-gray-200" />
                    <div className="h-4 w-[40%] animate-pulse rounded bg-gray-200" />
                    <div className="h-16 w-full animate-pulse rounded bg-gray-200" />
                </div>
            ))}
        </div>
    );

    const renderReaderBody = () => {
        if (!selected) return null;

        if (reader.status === "loading") {
            return (
                <div className="space-y-4">
                    <div className="h-8 w-[85%] animate-pulse rounded bg-gray-200" />
                    <div className="h-4 w-[35%] animate-pulse rounded bg-gray-200" />
                    <div className="h-56 w-full animate-pulse rounded-lg bg-gray-200" />
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-4 w-full animate-pulse rounded bg-gray-200" />
                    ))}
                </div>
            );
        }

        if (reader.status === "error") {
            return (
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold leading-snug text-gray-900">{selected.title}</h2>
                    {selected.thumbnail && (
                        <img
                            src={selected.thumbnail}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="max-h-80 w-full rounded-lg object-cover"
                        />
                    )}
                    {selected.summary && <p className="text-gray-600">{selected.summary}</p>}
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        {reader.message} You can read it directly on the original site.
                    </div>
                    <a
                        href={selected.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
                    >
                        Read article ↗
                    </a>
                </div>
            );
        }

        const { data } = reader;
        return (
            <article lang={data.lang || undefined}>
                <h2 className="text-2xl font-extrabold leading-snug text-gray-900 sm:text-3xl">
                    {data.title || selected.title}
                </h2>
                <p className="mt-3 text-sm font-medium text-gray-500">
                    {[data.siteName, data.byline, formatDate(selected.pubDate)].filter(Boolean).join(" · ")}
                </p>
                <div
                    className={`mt-6 ${ARTICLE_BODY_CLASS} ${data.lang === "ja" ? "leading-[1.95]" : ""}`}
                    dangerouslySetInnerHTML={{ __html: data.content }}
                />
            </article>
        );
    };

    return (
        <main className="mx-auto min-h-screen max-w-[1200px] bg-gray-50 p-8 font-sans text-gray-800">
            <header>
                <div className="flex items-center justify-between">
                    <h1 className="mb-6 text-3xl font-extrabold text-gray-900">Intelligence Workspace</h1>
                    <button
                        onClick={() => fetchRssData(activeCategory.url, true)}
                        disabled={isLoading}
                        title="Refresh this category"
                        className="mb-6 cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        ↻ Refresh
                    </button>
                </div>

                {/* Level 1: choose news source */}
                <nav className="flex flex-wrap gap-3 border-b-2 border-gray-200 pb-4">
                    {NEWS_SOURCES.map((source) => (
                        <button
                            key={source.id}
                            onClick={() => handleSourceChange(source.id)}
                            className={`cursor-pointer rounded-lg border px-5 py-2.5 text-[0.95rem] font-semibold transition ${activeSourceId === source.id
                                ? "border-gray-900 bg-gray-900 text-white"
                                : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                                }`}
                        >
                            {source.name}
                        </button>
                    ))}
                </nav>

                {/* Level 2: choose category */}
                <div className="my-3 flex flex-wrap gap-2 py-3">
                    {activeSource.categories.map((cat) => (
                        <button
                            key={cat.id}
                            onClick={() => setActiveCategoryId(cat.id)}
                            className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${activeCategory.id === cat.id
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                                }`}
                        >
                            {cat.label}
                        </button>
                    ))}
                </div>
            </header>

            <section className="w-full">
                {isLoading ? (
                    renderSkeletons()
                ) : error ? (
                    <p className="text-red-800">{error}</p>
                ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6">
                        {articles.map((article) => (
                            <article
                                key={article.id}
                                onClick={() => setSelected(article)}
                                className="flex cursor-pointer flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                            >
                                {article.thumbnail && (
                                    <div className="h-[180px] w-full border-b border-gray-200">
                                        <img
                                            src={article.thumbnail}
                                            alt=""
                                            loading="lazy"
                                            className="h-full w-full object-cover"
                                        />
                                    </div>
                                )}

                                <div className="flex flex-grow flex-col p-6">
                                    <h2 className="mb-3 text-[1.1rem] font-bold leading-snug text-gray-900">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelected(article);
                                            }}
                                            className="cursor-pointer text-left hover:text-blue-600"
                                        >
                                            {article.title}
                                        </button>
                                    </h2>
                                    <p className="mb-3 text-xs font-medium text-gray-500">{formatDate(article.pubDate)}</p>
                                    {article.summary && (
                                        <p className="mb-5 line-clamp-3 text-[0.95rem] leading-normal text-gray-600">
                                            {article.summary}
                                        </p>
                                    )}
                                    {/* Keep the link to the original site in case the reader fails */}
                                    <a
                                        href={article.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="mt-auto text-sm font-semibold text-blue-600 hover:underline"
                                    >
                                        Read article ↗
                                    </a>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </section>

            {/* Reader overlay */}
            {selected && (
                <div
                    className="fixed inset-0 z-[100] flex items-stretch justify-center overflow-hidden bg-black/60 sm:items-center sm:p-6"
                    onClick={() => setSelected(null)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Article reader"
                >
                    <div
                        className="relative flex h-dvh min-h-0 w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-5 py-3 sm:rounded-t-2xl">
                            <button
                                type="button"
                                onClick={() => setSelected(null)}
                                className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                            >
                                ← Close
                            </button>
                            <a
                                href={selected.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700"
                            >
                                Read article ↗
                            </a>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-5 py-6 sm:px-10 sm:py-8">
                            {renderReaderBody()}
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
