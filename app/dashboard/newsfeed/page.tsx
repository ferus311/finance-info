import "./newsfeed.style.css";

type Source = { name: string; handle?: string; description: string; url: string };
type SourceGroup = { number: string; title: string; summary: string; sources: Source[] };

const groups: SourceGroup[] = [
    {
        number: "01", title: "Tin nhanh thị trường",
        summary: "Headline về vĩ mô, chứng khoán, crypto và thông cáo mới nhất.",
        sources: [
            { name: "Tree News", handle: "@Tree_News", description: "Newsfeed tự động, tốc độ cao cho tin tài chính và crypto.", url: "https://x.com/Tree_News" },
            { name: "DB", handle: "@tier10k", description: "Tin breaking và thông cáo được tổng hợp nhanh trên X.", url: "https://x.com/tier10k" },
            { name: "Walter Bloomberg", handle: "@DeItaone", description: "Tóm tắt tin vĩ mô, chứng khoán và phát biểu chính sách.", url: "https://x.com/DeItaone" },
        ],
    },
    {
        number: "02", title: "On-chain & sentiment",
        summary: "Theo dõi dòng tiền, phái sinh, thanh lý và tâm lý thị trường crypto.",
        sources: [
            { name: "CoinGlass", description: "Long/Short, liquidation map, ETF flow và funding rate.", url: "https://www.coinglass.com/" },
            { name: "CryptoQuant", description: "Dòng tiền nạp/rút sàn và dữ liệu on-chain chuyên sâu.", url: "https://cryptoquant.com/" },
            { name: "Santiment", description: "Social volume, sentiment và hoạt động của mạng lưới.", url: "https://app.santiment.net/" },
            { name: "The Block Data", description: "Tin crypto kết hợp biểu đồ và dashboard dữ liệu.", url: "https://www.theblock.co/data" },
            { name: "CoinDesk Data", description: "Market data, chỉ số và phân tích trực quan.", url: "https://www.coindesk.com/data/" },
        ],
    },
    {
        number: "03", title: "Macro & fundamental",
        summary: "Nguồn báo chí để hiểu chính sách, dòng tiền toàn cầu và địa chính trị.",
        sources: [
            { name: "Bloomberg", description: "Tin kinh tế, chính trị và thị trường toàn cầu.", url: "https://www.bloomberg.com/markets" },
            { name: "Reuters", description: "Tin tức tài chính và kinh tế quốc tế đáng tin cậy.", url: "https://www.reuters.com/markets/" },
            { name: "Financial Times", handle: "FT", description: "Phân tích chính sách tiền tệ và xu hướng vĩ mô dài hạn.", url: "https://www.ft.com/markets" },
        ],
    },
    {
        number: "04", title: "Nguồn tài chính Nhật Bản",
        summary: "Góc nhìn địa phương về BoJ, USD/JPY, chứng khoán và tài sản số.",
        sources: [
            { name: "Nikkei", handle: "日本経済新聞", description: "Kinh tế Nhật, tỷ giá, chính sách và thị trường châu Á.", url: "https://www.nikkei.com/" },
            { name: "CoinPost", description: "Tin crypto Nhật và hành lang pháp lý của FSA.", url: "https://coinpost.jp/" },
            { name: "Minkabu", handle: "みんかぶ", description: "Dòng tiền, tâm lý nhà đầu tư và thông tin cổ phiếu.", url: "https://minkabu.jp/" },
            { name: "Kabutan", handle: "株探", description: "Tin cổ phiếu, kết quả kinh doanh và biến động thị trường.", url: "https://kabutan.jp/" },
        ],
    },
];

const tradingViewIndicators = [
    { name: "Japan inflation rate YoY", symbol: "ECONOMICS:JPIRYY", url: "https://www.tradingview.com/symbols/ECONOMICS-JPIRYY/" },
    { name: "Japan interest rate", symbol: "ECONOMICS:JPINTR", url: "https://www.tradingview.com/symbols/ECONOMICS-JPINTR/" },
];

export default function NewsfeedPage() {
    return (
        <main className="newsfeed-page">
            <header className="newsfeed-header">
                <div>
                    <p className="eyebrow">Market intelligence desk</p>
                    <h1>Newsfeed sources</h1>
                    <p className="newsfeed-intro">Một bảng điều hướng gọn cho các nguồn tin nhanh, dữ liệu on-chain và phân tích vĩ mô.</p>
                </div>
                <div className="source-count"><strong>15</strong><span>curated sources</span></div>
            </header>

            <section className="tradingview-panel" aria-labelledby="macro-title">
                <div className="panel-heading">
                    <div><p className="eyebrow">TradingView / Japan</p><h2 id="macro-title">Macro pulse</h2></div>
                    <span className="integration-badge direct-badge">Direct link</span>
                </div>
                <p className="panel-note">Hai mã ECONOMICS không hỗ trợ widget nhúng, nên dùng link lịch sử chính thức để mở chart đầy đủ.</p>
                <div className="macro-links">
                    {tradingViewIndicators.map((indicator) => (
                        <a className="macro-link" href={indicator.url} target="_blank" rel="noreferrer" key={indicator.symbol}>
                            <span><small>{indicator.symbol}</small><strong>{indicator.name}</strong></span><span className="arrow" aria-hidden="true">↗</span>
                        </a>
                    ))}
                </div>
            </section>

            <div className="source-groups">
                {groups.map((group) => (
                    <section className="source-group" key={group.number}>
                        <div className="group-heading"><span className="group-number">{group.number}</span><div><h2>{group.title}</h2><p>{group.summary}</p></div></div>
                        <div className="source-grid">
                            {group.sources.map((source) => (
                                <article className="source-card" key={source.name}>
                                    <div className="source-card-top"><span className="source-mark">{source.name.slice(0, 1)}</span><span className="integration-badge">Mở trực tiếp</span></div>
                                    <h3>{source.name}</h3>
                                    {source.handle && <p className="source-handle">{source.handle}</p>}
                                    <p className="source-description">{source.description}</p>
                                    <a href={source.url} target="_blank" rel="noreferrer" className="source-link">Truy cập nguồn <span aria-hidden="true">↗</span></a>
                                </article>
                            ))}
                        </div>
                    </section>
                ))}
            </div>

            <footer className="newsfeed-footer">Nguồn bên ngoài có thể yêu cầu tài khoản hoặc subscription. Link được mở ở tab mới để tiện theo dõi.</footer>
        </main>
    );
}
