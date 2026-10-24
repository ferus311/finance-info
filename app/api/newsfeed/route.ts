import { NextResponse } from "next/server";
import Parser from "rss-parser";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import sanitizeHtml from "sanitize-html";

// jsdom requires the Node runtime (it does not run on Edge)
export const runtime = "nodejs";

/**
 * GET /api/newsfeed?type=feed&url=<rss-url>      -> list of articles
 * GET /api/newsfeed?type=article&url=<article>   -> sanitized article content
 */

// Only allow the declared news domains -> prevents abuse as an open proxy (SSRF)
const ALLOWED_HOSTS = ["vnexpress.net", "tuoitre.vn", "nhk.or.jp", "news.web.nhk", "yahoo.co.jp"];

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const rssParser = new Parser({
    timeout: 8000,
    customFields: {
        item: ["image", "media:content", "enclosure"],
    },
});

function isAllowedUrl(rawUrl: string): boolean {
    try {
        const u = new URL(rawUrl);
        if (u.protocol !== "http:" && u.protocol !== "https:") return false;
        return ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    } catch {
        return false;
    }
}

// ---------- FEED ----------
async function handleFeed(feedUrl: string) {
    const parsedFeed = await rssParser.parseURL(feedUrl);

    const articles = parsedFeed.items.slice(0, 15).map((item, idx) => {
        let thumbnail: string | null = null;
        if (typeof item.image === "string") thumbnail = item.image; // Yahoo JP
        else if (item.image?.url) thumbnail = item.image.url;
        else if (item.enclosure?.url) thumbnail = item.enclosure.url;
        else if (item["media:content"]?.$?.url) thumbnail = item["media:content"].$.url;

        return {
            id: item.guid || item.link || `item-${idx}`,
            title: item.title || "Untitled Article",
            link: item.link || "#",
            pubDate: item.isoDate || item.pubDate || null,
            summary: item.contentSnippet || "",
            thumbnail,
        };
    });

    return NextResponse.json({ articles });
}

// ---------- ARTICLE (reader mode) ----------
async function handleArticle(articleUrl: string) {
    const res = await fetch(articleUrl, {
        headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "vi,ja;q=0.8,en;q=0.5",
        },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
        next: { revalidate: 300 }, // server-side cache for 5 minutes
    });

    if (!res.ok) {
        return NextResponse.json({ error: `The original site returned error ${res.status}.` }, { status: 502 });
    }

    // Re-check after redirects to avoid being sent to an unknown domain
    if (!isAllowedUrl(res.url)) {
        return NextResponse.json({ error: "The article redirected to an unsupported domain." }, { status: 400 });
    }

    const html = await res.text();
    const dom = new JSDOM(html, { url: res.url, virtualConsole: new VirtualConsole() });
    const doc = dom.window.document;

    // Many sites lazy-load images via data-src
    doc.querySelectorAll("img").forEach((img) => {
        const lazy = img.getAttribute("data-src") || img.getAttribute("data-original");
        if (lazy) img.setAttribute("src", lazy);
    });

    let articleContent = "";
    let articleText = "";
    let hasNhkArticleBody = false;

    const hostname = new URL(res.url).hostname;
    if (hostname === "news.web.nhk" || hostname.endsWith(".nhk.or.jp")) {
        const heading = doc.querySelector("main h1") || doc.querySelector("h1");

        for (let container = heading?.parentElement; container && container !== doc.body; container = container.parentElement) {
            const bodySection = Array.from(container.children).find((child) => {
                if (child.contains(heading)) return false;
                return Array.from(child.querySelectorAll("p")).some((paragraph) => (paragraph.textContent || "").trim().length >= 40);
            });
            const bodyText = bodySection?.textContent?.trim() || "";

            if (bodySection && bodyText.length >= 80) {
                articleContent = bodySection.innerHTML;
                articleText = bodyText;
                hasNhkArticleBody = true;
                break;
            }

            if (container.tagName === "MAIN") break;
        }
    }

    const parsed = new Readability(doc).parse();

    if (!parsed) {
        return NextResponse.json({ error: "Could not extract the content of this article." }, { status: 422 });
    }

    if (!articleContent) {
        articleContent = parsed.content || "";
        articleText = parsed.textContent || "";
    }

    if (!articleContent || articleText.trim().length < (hasNhkArticleBody ? 80 : 200)) {
        return NextResponse.json({ error: "Could not extract the content of this article." }, { status: 422 });
    }

    const content = sanitizeHtml(articleContent, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "figure", "figcaption", "h1", "h2"]),
        allowedAttributes: {
            a: ["href", "title", "target", "rel"],
            img: ["src", "alt", "title", "loading", "referrerpolicy"],
        },
        allowedSchemes: ["http", "https"],
        transformTags: {
            a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
            // no-referrer: avoids image hotlink blocking
            img: sanitizeHtml.simpleTransform("img", { loading: "lazy", referrerpolicy: "no-referrer" }),
        },
    });

    return NextResponse.json({
        title: parsed.title || "",
        byline: parsed.byline || null,
        siteName: parsed.siteName || null,
        lang: parsed.lang || null,
        content,
    });
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "feed";
    const url = searchParams.get("url");

    if (!url) {
        return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
    }
    if (!isAllowedUrl(url)) {
        return NextResponse.json({ error: "URL is not in the list of allowed sources." }, { status: 400 });
    }

    try {
        if (type === "article") return await handleArticle(url);
        if (type === "feed") return await handleFeed(url);
        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    } catch (error) {
        console.error(`[api/newsfeed:${type}] Failed for ${url}:`, error);
        return NextResponse.json({ error: "The server could not retrieve data from the source." }, { status: 500 });
    }
}
