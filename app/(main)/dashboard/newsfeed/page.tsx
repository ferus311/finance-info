import "./newsfeed.style.css";

type Source = { name: string; handle?: string; description: string; url: string };
type SourceGroup = { number: string; title: string; summary: string; sources: Source[] };

const groups: SourceGroup[] = [
    {
        number: "01", title: "Tài chính & Vĩ mô",
        summary: "Chính sách tiền tệ, thị trường chứng khoán và dữ liệu kinh tế (EN, JP, VN).",
        sources: [
            { name: "Bloomberg", description: "Tốc độ nhanh, trung lập tuyệt đối về thị trường toàn cầu.", url: "https://www.bloomberg.com/markets" },
            { name: "Financial Times", handle: "FT", description: "Phân tích sâu, giải mã chính sách vĩ mô.", url: "https://www.ft.com/markets" },
            { name: "Nikkei", handle: "日本経済新聞", description: "Kim chỉ nam cho kinh tế và chính sách Nhật Bản.", url: "https://www.nikkei.com/" },
            { name: "Yahoo! Finance JP", description: "Tin vắn nhanh và biến động giá nội địa Nhật.", url: "https://finance.yahoo.co.jp/" },
            { name: "VnEconomy", description: "Chuẩn xác về số liệu vĩ mô và kinh tế Việt Nam.", url: "https://vneconomy.vn/" },
        ],
    },
    {
        number: "02", title: "Chiến sự & Địa chính trị",
        summary: "Cập nhật xung đột quốc tế, fact-check tình báo và phân tích chiến lược.",
        sources: [
            { name: "ISW", handle: "@TheStudyofWar", description: "Phân tích chiến thuật quân sự hàng ngày chi tiết và sát thực tế nhất.", url: "https://www.understandingwar.org/" },
            { name: "AP News", description: "Đưa tin chiến sự, fact-check tốt nhất và không cảm xúc.", url: "https://apnews.com/" },
            { name: "NHK News", handle: "NHKニュース", description: "Đưa tin nhanh, khách quan từ góc nhìn Nhật Bản.", url: "https://www3.nhk.or.jp/news/" },
            { name: "Yomiuri Shimbun", handle: "読売新聞", description: "Góc nhìn chính trị quốc tế và ngoại giao sâu sắc.", url: "https://www.yomiuri.co.jp/" },
            { name: "Nghiên cứu Quốc tế", description: "Bài dịch hàn lâm, phân tích chiến lược địa chính trị.", url: "https://nghiencuuquocte.org/" },
        ],
    },
    {
        number: "03", title: "Tiền ảo (Crypto & On-chain)",
        summary: "Dữ liệu dòng tiền, hệ sinh thái và hành lang pháp lý crypto.",
        sources: [
            { name: "The Block", description: "Phân tích on-chain, dữ liệu dòng tiền và tin tức thị trường.", url: "https://www.theblock.co/" },
            { name: "CoinDesk", description: "Tin tức thị trường chung, chỉ số và xu hướng vĩ mô crypto.", url: "https://www.coindesk.com/" },
            { name: "CoinPost", handle: "コインポスト", description: "Trang tin Crypto lớn và uy tín nhất tại Nhật Bản.", url: "https://coinpost.jp/" },
            { name: "Bitbank Blog", description: "Phân tích kỹ thuật chuyên sâu và xu hướng thị trường nội địa Nhật.", url: "https://blog.bitbank.cc/" },
            { name: "Coin68", description: "Cập nhật hệ sinh thái đầy đủ, nhanh nhạy tại Việt Nam.", url: "https://coin68.com/" },
        ],
    },
];

const tradingViewIndicators = [
    { name: "Japan inflation rate YoY", symbol: "ECONOMICS:JPIRYY", url: "https://www.tradingview.com/symbols/ECONOMICS-JPIRYY/" },
    { name: "Japan interest rate", symbol: "ECONOMICS:JPINTR", url: "https://www.tradingview.com/symbols/ECONOMICS-JPINTR/" },
];

export default function NewsfeedPage() {
    // Tính toán tổng số lượng nguồn tin một cách tự động
    const totalSources = groups.reduce((total, group) => total + group.sources.length, 0);

    return (
        <main className="newsfeed-page">
            <header className="newsfeed-header">
                <div>
                    <p className="eyebrow">Market intelligence desk</p>
                    <h1>Newsfeed sources</h1>
                    <p className="newsfeed-intro">Một bảng điều hướng chuẩn hóa cho các nguồn tin tài chính, địa chính trị và crypto.</p>
                </div>
                <div className="source-count">
                    <strong>{totalSources}</strong>
                    <span>curated sources</span>
                </div>
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
                        <div className="group-heading">
                            <span className="group-number">{group.number}</span>
                            <div><h2>{group.title}</h2><p>{group.summary}</p></div>
                        </div>
                        <div className="source-grid">
                            {group.sources.map((source) => (
                                <article className="source-card" key={source.name}>
                                    <div className="source-card-top">
                                        <span className="source-mark">{source.name.slice(0, 1)}</span>
                                        <span className="integration-badge">Mở trực tiếp</span>
                                    </div>
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
