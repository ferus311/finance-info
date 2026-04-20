export const LS_CRYPTO_SYMBOLS = "finance.watchlist.crypto";
export const LS_STOCK_SYMBOLS = "finance.watchlist.vn";
export const LS_VN_DATE = "finance.watchlist.vnDate";

type PersistedWatchlist = {
    cryptoSymbols: string[];
    stockSymbols: string[];
    vnDate: string | null;
};

function parseStringArray(raw: string | null): string[] {
    if (!raw) {
        return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.toUpperCase());
}

export function loadWatchlist(): PersistedWatchlist {
    try {
        const savedCrypto = localStorage.getItem(LS_CRYPTO_SYMBOLS);
        const savedStocks = localStorage.getItem(LS_STOCK_SYMBOLS);
        const savedVnDate = localStorage.getItem(LS_VN_DATE);

        const cryptoSymbols = parseStringArray(savedCrypto);
        const stockSymbols = parseStringArray(savedStocks);

        const vnDate =
            savedVnDate && /^\d{4}-\d{2}-\d{2}$/.test(savedVnDate)
                ? savedVnDate
                : null;

        return { cryptoSymbols, stockSymbols, vnDate };
    } catch {
        return { cryptoSymbols: [], stockSymbols: [], vnDate: null };
    }
}

export function saveWatchlist(cryptoSymbols: string[], stockSymbols: string[], vnDate: string): void {
    localStorage.setItem(LS_CRYPTO_SYMBOLS, JSON.stringify(cryptoSymbols));
    localStorage.setItem(LS_STOCK_SYMBOLS, JSON.stringify(stockSymbols));
    localStorage.setItem(LS_VN_DATE, vnDate);
}
