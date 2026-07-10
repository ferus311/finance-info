"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, ConfigProvider, Layout, Space, message } from "antd";
import { DashboardSummary } from "@/components/dashboard-summary";
import { MarketSection } from "@/components/market-section";
import { getNearestWeekday, toApiDate, toDateInputFromApi, toDateInputValue } from "@/lib/date";
import { loadWatchlist, saveWatchlist } from "@/lib/storage";
import type { MarketResponse, MarketRow } from "@/types/market";

const POLL_INTERVAL = 10000;
const DEFAULT_CRYPTO_SYMBOLS = ["BTCUSDT", "SOLUSDT", "ETHUSDT", "ARBUSDT"];
const DEFAULT_STOCK_SYMBOLS = ["SSI", "GAS"];

export default function StocksPage() {
    const [messageApi, contextHolder] = message.useMessage();
    const [persisted] = useState(() => {
        if (typeof window === "undefined") {
            return { cryptoSymbols: [], stockSymbols: [], vnDate: null as string | null };
        }

        return loadWatchlist();
    });
    const [cryptoSymbols, setCryptoSymbols] = useState<string[]>(() =>
        persisted.cryptoSymbols.length > 0 ? persisted.cryptoSymbols : DEFAULT_CRYPTO_SYMBOLS,
    );
    const [stockSymbols, setStockSymbols] = useState<string[]>(() =>
        persisted.stockSymbols.length > 0 ? persisted.stockSymbols : DEFAULT_STOCK_SYMBOLS,
    );
    const [cryptoRows, setCryptoRows] = useState<MarketRow[]>([]);
    const [stockRows, setStockRows] = useState<MarketRow[]>([]);
    const [cryptoLoading, setCryptoLoading] = useState(true);
    const [stockLoading, setStockLoading] = useState(true);
    const [lastCryptoUpdated, setLastCryptoUpdated] = useState<string | null>(null);
    const [lastStockUpdated, setLastStockUpdated] = useState<string | null>(null);
    const [vnDate, setVnDate] = useState<string>(() =>
        persisted.vnDate ?? toDateInputValue(getNearestWeekday()),
    );
    const [cryptoInput, setCryptoInput] = useState("");
    const [stockInput, setStockInput] = useState("");

    const fetchCryptoQuotes = useCallback(async () => {
        const params = new URLSearchParams({
            crypto: cryptoSymbols.join(","),
            include: "crypto",
        });

        const response = await fetch(`/api/market?${params.toString()}`, {
            cache: "no-store",
        });

        if (!response.ok) {
            throw new Error("Could not fetch market data");
        }

        const payload: MarketResponse = await response.json();
        setCryptoRows(payload.crypto);
        setLastCryptoUpdated(payload.updatedAt);
    }, [cryptoSymbols]);

    const fetchStockQuotes = useCallback(async () => {
        const params = new URLSearchParams({
            vn: stockSymbols.join(","),
            vnDate: toApiDate(vnDate),
            include: "vn",
        });

        const response = await fetch(`/api/market?${params.toString()}`, {
            cache: "no-store",
        });

        if (!response.ok) {
            throw new Error("Could not fetch Vietnam stock data");
        }

        const payload: MarketResponse = await response.json();
        setStockRows(payload.vnStocks);
        setLastStockUpdated(payload.updatedAt);
        if (payload.vnDate) {
            setVnDate(toDateInputFromApi(payload.vnDate));
        }
    }, [stockSymbols, vnDate]);

    useEffect(() => {
        saveWatchlist(cryptoSymbols, stockSymbols, vnDate);
    }, [cryptoSymbols, stockSymbols, vnDate]);

    useEffect(() => {
        let isMounted = true;

        const run = async (silent = false) => {
            if (!silent && isMounted) {
                setCryptoLoading(true);
            }

            try {
                await fetchCryptoQuotes();
            } catch {
                if (!silent) {
                    messageApi.error("Unable to fetch crypto data. Please try again.");
                }
            } finally {
                if (isMounted) {
                    setCryptoLoading(false);
                }
            }
        };

        void run();
        const timer = window.setInterval(() => {
            void run(true);
        }, POLL_INTERVAL);

        return () => {
            isMounted = false;
            window.clearInterval(timer);
        };
    }, [fetchCryptoQuotes, messageApi]);

    useEffect(() => {
        let isMounted = true;

        const run = async (silent = false) => {
            if (!silent && isMounted) {
                setStockLoading(true);
            }

            try {
                await fetchStockQuotes();
            } catch {
                if (!silent) {
                    messageApi.error("Unable to fetch Vietnam stock data. Please try again.");
                }
            } finally {
                if (isMounted) {
                    setStockLoading(false);
                }
            }
        };

        void run();
        const timer = window.setInterval(() => {
            void run(true);
        }, POLL_INTERVAL);

        return () => {
            isMounted = false;
            window.clearInterval(timer);
        };
    }, [fetchStockQuotes, messageApi]);

    const totalCrypto = useMemo(
        () => cryptoRows.filter((item) => item.status === "ok").length,
        [cryptoRows],
    );
    const totalStocks = useMemo(
        () => stockRows.filter((item) => item.status === "ok").length,
        [stockRows],
    );

    const addSymbol = (
        value: string,
        current: string[],
        setCurrent: (next: string[]) => void,
        setInput: (next: string) => void,
    ) => {
        const symbol = value.trim().toUpperCase();
        if (!symbol) {
            return;
        }

        if (current.includes(symbol)) {
            messageApi.warning(`${symbol} is already in the watchlist`);
            return;
        }

        setCurrent([...current, symbol]);
        setInput("");
    };

    const removeSymbol = (
        symbol: string,
        current: string[],
        setCurrent: (next: string[]) => void,
    ) => {
        if (current.length <= 1) {
            messageApi.warning("At least one symbol is required in each section");
            return;
        }

        setCurrent(current.filter((item) => item !== symbol));
    };

    return (
        <ConfigProvider
            theme={{
                token: {
                    colorPrimary: "#1677ff",
                    borderRadius: 12,
                },
            }}
        >
            <App>
                {contextHolder}
                <Layout className="dashboard-root">
                    <Layout.Content className="dashboard-content">
                        <Space direction="vertical" size={20} style={{ width: "100%" }}>
                            <DashboardSummary
                                totalCrypto={totalCrypto}
                                totalStocks={totalStocks}
                                lastCryptoUpdated={lastCryptoUpdated}
                                lastStockUpdated={lastStockUpdated}
                                vnDate={vnDate}
                                refreshing={cryptoLoading || stockLoading}
                                onRefresh={() => {
                                    void fetchCryptoQuotes();
                                    void fetchStockQuotes();
                                }}
                            />

                            <MarketSection
                                title="Crypto"
                                loading={cryptoLoading}
                                symbols={cryptoSymbols}
                                rows={cryptoRows}
                                inputValue={cryptoInput}
                                inputPlaceholder="Add symbol (e.g. BTCUSDT, SOLUSDT, ETHUSDT)"
                                onInputChange={setCryptoInput}
                                onAddSymbol={(value) =>
                                    addSymbol(value, cryptoSymbols, setCryptoSymbols, setCryptoInput)
                                }
                                onRemoveSymbol={(symbol) =>
                                    removeSymbol(symbol, cryptoSymbols, setCryptoSymbols)
                                }
                            />

                            <MarketSection
                                title="Vietnam Stocks"
                                loading={stockLoading}
                                symbols={stockSymbols}
                                rows={stockRows}
                                inputValue={stockInput}
                                inputPlaceholder="Add symbol (e.g. SSI, GAS, VCB)"
                                onInputChange={setStockInput}
                                onAddSymbol={(value) =>
                                    addSymbol(value, stockSymbols, setStockSymbols, setStockInput)
                                }
                                onRemoveSymbol={(symbol) =>
                                    removeSymbol(symbol, stockSymbols, setStockSymbols)
                                }
                                dateValue={vnDate}
                                onDateChange={setVnDate}
                            />
                        </Space>
                    </Layout.Content>
                </Layout>
            </App>
        </ConfigProvider>
    );
}
