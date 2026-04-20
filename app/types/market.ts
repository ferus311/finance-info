export type MarketRow = {
    symbol: string;
    price: number | null;
    currency: string;
    changePercent: number | null;
    source: string;
    status: "ok" | "unavailable";
    updatedAt: string;
};

export type MarketResponse = {
    updatedAt: string;
    vnDate: string;
    crypto: MarketRow[];
    vnStocks: MarketRow[];
};
