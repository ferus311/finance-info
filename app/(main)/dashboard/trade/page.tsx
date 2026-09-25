"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    App,
    Button,
    Card,
    Col,
    ConfigProvider,
    Divider,
    Empty,
    Form,
    Input,
    InputNumber,
    Layout,
    Modal,
    message,
    Row,
    Select,
    Space,
    Statistic,
    Table,
    Tabs,
    Tag,
    Typography,
    Popconfirm,
} from "antd";
import { ClearOutlined, DeleteOutlined, FileTextOutlined, PlusOutlined, ReloadOutlined, SwapOutlined, UndoOutlined } from "@ant-design/icons";
import type { MarketResponse, MarketRow } from "@/types/market";
import { StrategyNotePanel, createDefaultStrategyNote, mergeStrategyNote, type StrategyNote } from "./note/strategy-note-panel";
import "./trade.style.css";

type OrderSide = "buy" | "sell";
type AssetType = "crypto" | "stock";
type InputMode = "quantity" | "amount";
type CurrencyCode = "USD" | "JPY" | "VND" | "EUR";
type TradeOrder = { id: string; side: OrderSide; assetType: AssetType; symbol: string; quantity: number; price: number; currency: string; createdAt: string };
type Scenario = { id: string; name: string; capital: number; orders: TradeOrder[]; note?: StrategyNote };
type Position = { symbol: string; assetType: AssetType; quantity: number; averageCost: number; costBasis: number; currentPrice: number | null; currency: string; marketValue: number; pnl: number | null };

const POLL_INTERVAL = 10000;
const DEFAULT_CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const DEFAULT_STOCKS = ["SSI", "GAS", "VCB"];
const CURRENCY_OPTIONS: CurrencyCode[] = ["USD", "JPY", "VND", "EUR"];
const DEFAULT_RATES: Record<string, number> = { USD: 1, JPY: 157.5, VND: 25000, EUR: 0.92 };
const ACCOUNT_CURRENCY: CurrencyCode = "USD";
const defaultScenario: Scenario = { id: "growth", name: "Growth Strategy", capital: 100000, orders: [], note: createDefaultStrategyNote() };

function convertCurrency(value: number, fromCurrency: string, toCurrency: string, rates: Record<string, number>) {
    if (!Number.isFinite(value)) return 0;
    if (fromCurrency === toCurrency) return value;

    const fromRate = rates[fromCurrency] ?? 1;
    const toRate = rates[toCurrency] ?? 1;

    if (fromCurrency === "USD") return value * toRate;
    if (toCurrency === "USD") return value / fromRate;

    return (value / fromRate) * toRate;
}

function formatNumber(value: number, maximumFractionDigits = 2) {
    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits,
        minimumFractionDigits: 0,
    }).format(value);
}

function formatMoney(value: number, currency = "USD", targetCurrency: CurrencyCode = "USD", rates: Record<string, number> = DEFAULT_RATES) {
    const converted = convertCurrency(value, currency, targetCurrency, rates);
    const digits = targetCurrency === "JPY" ? 0 : 2;
    return `${formatNumber(converted, digits)} ${targetCurrency}`;
}

function formatCompactMoney(value: number, currency = "USD", targetCurrency: CurrencyCode = "USD", rates: Record<string, number> = DEFAULT_RATES) {
    const converted = convertCurrency(value, currency, targetCurrency, rates);
    const digits = targetCurrency === "JPY" ? 0 : 2;
    return `${new Intl.NumberFormat("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: 0,
    }).format(converted)} ${targetCurrency}`;
}

function formatPercent(value: number | null) {
    if (value === null || !Number.isFinite(value)) return "--";
    return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%`;
}

function toAccountCurrency(value: number, currency: string, rates: Record<string, number>) {
    return convertCurrency(value, currency, ACCOUNT_CURRENCY, rates);
}

function loadScenarios(): Scenario[] {
    return [{ ...defaultScenario, note: createDefaultStrategyNote() }];
}

function calculateScenario(scenario: Scenario, quotes: Map<string, MarketRow>, rates: Record<string, number>) {
    const lots = new Map<string, { quantity: number; cost: number; currency: string }[]>();
    let cash = scenario.capital;
    let realizedPnl = 0;
    let invested = 0;

    for (const order of scenario.orders) {
        const key = `${order.assetType}:${order.symbol}`;
        const orderValue = order.quantity * order.price;
        const orderValueInAccountCurrency = toAccountCurrency(orderValue, order.currency, rates);
        const symbolLots = lots.get(key) ?? [];

        if (order.side === "buy") {
            cash -= orderValueInAccountCurrency;
            invested += orderValueInAccountCurrency;
            symbolLots.push({ quantity: order.quantity, cost: order.price, currency: order.currency });
        } else {
            let remaining = order.quantity;
            let soldCost = 0;
            let soldQuantity = 0;

            while (remaining > 0 && symbolLots.length > 0) {
                const lot = symbolLots[0];
                const taken = Math.min(remaining, lot.quantity);
                soldCost += toAccountCurrency(taken * lot.cost, lot.currency, rates);
                soldQuantity += taken;
                lot.quantity -= taken;
                remaining -= taken;

                if (lot.quantity <= 0) symbolLots.shift();
            }

            const actualSaleValue = toAccountCurrency(soldQuantity * order.price, order.currency, rates);
            cash += actualSaleValue;
            realizedPnl += actualSaleValue - soldCost;
        }

        lots.set(key, symbolLots);
    }

    const positions: Position[] = Array.from(lots.entries())
        .map(([key, symbolLots]) => {
            const [assetType, symbol] = key.split(":") as [AssetType, string];
            const quantity = symbolLots.reduce((sum, lot) => sum + lot.quantity, 0);
            const costBasis = symbolLots.reduce((sum, lot) => sum + lot.quantity * lot.cost, 0);
            const quote = quotes.get(key);
            const currentPrice = quote?.price ?? null;
            const positionCurrency = quote?.currency ?? symbolLots[0]?.currency ?? ACCOUNT_CURRENCY;
            const marketValue = currentPrice === null ? costBasis : quantity * currentPrice;

            return {
                symbol,
                assetType,
                quantity,
                averageCost: costBasis / quantity,
                costBasis,
                currentPrice,
                currency: positionCurrency,
                marketValue,
                pnl: currentPrice === null ? null : marketValue - costBasis,
            };
        })
        .filter((position) => position.quantity > 0.00000001);

    const marketValue = positions.reduce((sum, position) => sum + toAccountCurrency(position.marketValue, position.currency, rates), 0);
    const totalPnl = realizedPnl + positions.reduce((sum, position) => sum + toAccountCurrency(position.pnl ?? 0, position.currency, rates), 0);

    return { cash, invested, realizedPnl, marketValue, totalPnl, totalValue: cash + marketValue, positions };
}

export default function TradePage() {
    const [messageApi, contextHolder] = message.useMessage();
    const [scenarios, setScenarios] = useState<Scenario[]>(() => loadScenarios());
    const [dataLoaded, setDataLoaded] = useState(false);
    const [activeId, setActiveId] = useState(() => scenarios[0]?.id ?? defaultScenario.id);
    const [quotes, setQuotes] = useState<Map<string, MarketRow>>(new Map());
    const [watchlist, setWatchlist] = useState<{ cryptoSymbols: string[]; stockSymbols: string[] }>({ cryptoSymbols: [], stockSymbols: [] });
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>(DEFAULT_RATES);
    const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode>("USD");
    const [refreshing, setRefreshing] = useState(true);
    const [newScenarioOpen, setNewScenarioOpen] = useState(false);
    const [newScenarioName, setNewScenarioName] = useState("");
    const [newScenarioCapital, setNewScenarioCapital] = useState(100000);
    const [noteDrawerOpen, setNoteDrawerOpen] = useState(false);
    const [form] = Form.useForm<{ side: OrderSide; assetType: AssetType; symbol: string; inputMode: InputMode; quantity?: number; amount?: number; price?: number }>();

    const activeScenario = scenarios.find((scenario) => scenario.id === activeId) ?? scenarios[0];
    const summary = useMemo(() => (activeScenario ? calculateScenario(activeScenario, quotes, exchangeRates) : null), [activeScenario, quotes, exchangeRates]);
    const activeScenarioNote = activeScenario ? mergeStrategyNote(activeScenario.note) : createDefaultStrategyNote();

    const refreshQuotes = useCallback(async () => {
        const cryptoSymbols = new Set([...DEFAULT_CRYPTO, ...watchlist.cryptoSymbols]);
        const stockSymbols = new Set([...DEFAULT_STOCKS, ...watchlist.stockSymbols]);

        scenarios.forEach((scenario) =>
            scenario.orders.forEach((order) => (order.assetType === "crypto" ? cryptoSymbols : stockSymbols).add(order.symbol)),
        );

        try {
            const marketParams = new URLSearchParams({
                crypto: [...cryptoSymbols].join(","),
                vn: [...stockSymbols].join(","),
            });

            const exchangeParams = new URLSearchParams({
                base: "USD",
                symbols: CURRENCY_OPTIONS.join(","),
            });

            const [marketResponse, exchangeResponse] = await Promise.all([
                fetch(`/api/market?${marketParams.toString()}`, { cache: "no-store" }),
                fetch(`/api/exchange?${exchangeParams.toString()}`, { cache: "no-store" }),
            ]);

            if (!marketResponse.ok) throw new Error("Market quote request failed");
            const payload: MarketResponse = await marketResponse.json();
            const next = new Map<string, MarketRow>();

            payload.crypto.forEach((row) => next.set(`crypto:${row.symbol}`, row));
            payload.vnStocks.forEach((row) => next.set(`stock:${row.symbol}`, row));
            setQuotes(next);

            if (exchangeResponse.ok) {
                const exchangePayload: { rates?: Record<string, number> } = await exchangeResponse.json();
                setExchangeRates({ ...DEFAULT_RATES, ...(exchangePayload.rates ?? {}) });
            }
        } catch {
            messageApi.warning("Unable to refresh market data at this moment.");
        } finally {
            setRefreshing(false);
        }
    }, [messageApi, scenarios, watchlist]);

    useEffect(() => {
        const initialRefresh = window.setTimeout(() => void refreshQuotes(), 0);
        const timer = window.setInterval(() => void refreshQuotes(), POLL_INTERVAL);

        return () => {
            window.clearTimeout(initialRefresh);
            window.clearInterval(timer);
        };
    }, [refreshQuotes]);

    useEffect(() => {
        fetch("/api/user/data", { cache: "no-store" })
            .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load account data")))
            .then((data: { scenarios?: Scenario[]; watchlist?: { cryptoSymbols?: string[]; stockSymbols?: string[] } }) => {
                if (data.watchlist) {
                    setWatchlist({
                        cryptoSymbols: data.watchlist.cryptoSymbols ?? [],
                        stockSymbols: data.watchlist.stockSymbols ?? [],
                    });
                }
                if (Array.isArray(data.scenarios) && data.scenarios.length > 0) {
                    const normalizedScenarios = data.scenarios.map((scenario) => ({
                        ...scenario,
                        note: mergeStrategyNote(scenario.note),
                    })) as Scenario[];
                    setScenarios(normalizedScenarios);
                    setActiveId(normalizedScenarios[0].id);
                }
            })
            .finally(() => setDataLoaded(true));
    }, []);

    useEffect(() => {
        if (!dataLoaded) return;
        void fetch("/api/user/data", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scenarios }),
        });
    }, [scenarios, dataLoaded]);

    const updateActive = (updater: (scenario: Scenario) => Scenario) =>
        setScenarios((current) => current.map((scenario) => (scenario.id === activeId ? updater(scenario) : scenario)));

    const submitOrder = (values: { side: OrderSide; assetType: AssetType; symbol: string; inputMode: InputMode; quantity?: number; amount?: number; price?: number }) => {
        if (!activeScenario || !summary) return;

        const symbol = values.symbol.trim().toUpperCase();
        const quote = quotes.get(`${values.assetType}:${symbol}`);
        const price = values.price ?? quote?.price;
        const tradeCurrency = quote?.currency ?? ACCOUNT_CURRENCY;

        if (!price || price <= 0) {
            messageApi.error("No valid price available for this symbol.");
            return;
        }

        const requestedAmount = values.amount ?? 0;
        const requestedQuantity = values.quantity ?? 0;
        const calculatedQuantity = values.inputMode === "amount"
            ? requestedAmount / toAccountCurrency(price, tradeCurrency, exchangeRates)
            : requestedQuantity;
        let quantity = calculatedQuantity;

        if (values.assetType === "stock") {
            quantity = Math.floor(quantity / 100) * 100;
        }

        if (!Number.isFinite(quantity) || quantity <= 0) {
            messageApi.error(values.assetType === "stock" ? "The amount must buy at least 100 shares." : "Enter a valid amount or quantity.");
            return;
        }

        const value = quantity * price;
        const valueInAccountCurrency = toAccountCurrency(value, tradeCurrency, exchangeRates);
        const held = summary.positions.find((position) => position.symbol === symbol && position.assetType === values.assetType)?.quantity ?? 0;

        if (values.side === "buy" && valueInAccountCurrency > summary.cash) {
            messageApi.error("Virtual account balance is insufficient for this order.");
            return;
        }

        if (values.side === "sell" && quantity > held + 0.00000001) {
            messageApi.error(`You can only sell up to ${formatNumber(held)} ${symbol}.`);
            return;
        }

        updateActive((scenario) => ({
            ...scenario,
            orders: [
                ...scenario.orders,
                {
                    id: crypto.randomUUID(),
                    side: values.side,
                    assetType: values.assetType,
                    symbol,
                    quantity,
                    price,
                    currency: quote?.currency ?? "USD",
                    createdAt: new Date().toISOString(),
                },
            ],
        }));

        form.resetFields(["quantity", "amount", "price"]);
        const roundingNote = values.assetType === "stock" && quantity !== calculatedQuantity
            ? ` (${formatNumber(quantity)} shares actually recorded; stocks trade in lots of 100)`
            : "";
        messageApi.success(`${values.side === "buy" ? "Buy" : "Sell"} order for ${symbol} recorded successfully${roundingNote}.`);
    };

    const createScenario = () => {
        const name = newScenarioName.trim();
        if (!name || newScenarioCapital <= 0) return;

        const scenario = { id: crypto.randomUUID(), name, capital: newScenarioCapital, orders: [], note: createDefaultStrategyNote() };
        setScenarios((current) => [...current, scenario]);
        setActiveId(scenario.id);
        setNewScenarioName("");
        setNewScenarioOpen(false);
    };

    const deleteScenario = () => {
        if (!activeScenario || scenarios.length === 1) {
            messageApi.warning("At least one scenario must remain.");
            return;
        }

        Modal.confirm({
            title: `Delete scenario “${activeScenario.name}”?`,
            content: "All trade history in this tab will be removed.",
            okText: "Delete",
            cancelText: "Cancel",
            okButtonProps: { danger: true },
            onOk: () => {
                const remaining = scenarios.filter((scenario) => scenario.id !== activeId);
                setScenarios(remaining);
                setActiveId(remaining[0].id);
            },
        });
    };

    const undoLastOrder = () => {
        if (!activeScenario || activeScenario.orders.length === 0) {
            messageApi.info("There is no order to undo.");
            return;
        }

        updateActive((scenario) => ({ ...scenario, orders: scenario.orders.slice(0, -1) }));
        messageApi.success("The last order was undone and the account balance was recalculated.");
    };

    const resetScenario = () => {
        if (!activeScenario || activeScenario.orders.length === 0) {
            messageApi.info("This scenario is already reset.");
            return;
        }

        Modal.confirm({
            title: `Reset “${activeScenario.name}”?`,
            content: "All orders will be removed and the balance will return to the initial capital.",
            okText: "Reset",
            cancelText: "Cancel",
            okButtonProps: { danger: true },
            onOk: () => {
                updateActive((scenario) => ({ ...scenario, orders: [] }));
                messageApi.success("Scenario reset. The account balance is back to its initial capital.");
            },
        });
    };

    const resetOrder = (orderId: string) => {
        updateActive((scenario) => ({
            ...scenario,
            orders: scenario.orders.filter((order) => order.id !== orderId),
        }));
        messageApi.success("Order reset. The balance and positions were recalculated.");
    };

    const quoteOptions = [...quotes.entries()].filter(([, row]) => row.status === "ok");
    const pnlColor = (value: number | null) => (value === null ? "#8c8c8c" : value >= 0 ? "#16805b" : "#d94f45");

    const positionColumns = [
        {
            title: "Ticker",
            dataIndex: "symbol",
            render: (value: string, row: Position) => (
                <Space>
                    <Tag color={row.assetType === "crypto" ? "blue" : "gold"}>{row.assetType === "crypto" ? "Crypto" : "VN"}</Tag>
                    <strong>{value}</strong>
                </Space>
            ),
        },
        { title: "Quantity", dataIndex: "quantity", render: (value: number) => formatNumber(value, 4) },
        { title: "Average cost", dataIndex: "averageCost", render: (value: number, row: Position) => formatMoney(value, row.currency, displayCurrency, exchangeRates) },
        { title: "Current price", dataIndex: "currentPrice", render: (value: number | null, row: Position) => (value === null ? <Tag>Waiting for price</Tag> : formatMoney(value, row.currency, displayCurrency, exchangeRates)) },
        { title: "Market value", dataIndex: "marketValue", render: (value: number, row: Position) => formatMoney(value, row.currency, displayCurrency, exchangeRates) },
        {
            title: "P/L",
            dataIndex: "pnl",
            render: (value: number | null, row: Position) => (
                <strong style={{ color: pnlColor(value) }}>
                    {value === null ? "--" : `${value >= 0 ? "+" : "-"}${formatMoney(Math.abs(value), row.currency, displayCurrency, exchangeRates)}`}
                </strong>
            ),
        },
    ];

    const orderColumns = [
        { title: "Time", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString("en-US") },
        { title: "Side", dataIndex: "side", render: (value: OrderSide) => <Tag color={value === "buy" ? "green" : "red"}>{value === "buy" ? "BUY" : "SELL"}</Tag> },
        { title: "Ticker", dataIndex: "symbol" },
        { title: "Quantity", dataIndex: "quantity", render: (value: number) => formatNumber(value, 4) },
        { title: "Execution price", dataIndex: "price", render: (value: number, row: TradeOrder) => formatMoney(value, row.currency, displayCurrency, exchangeRates) },
        { title: "Total", render: (_: unknown, row: TradeOrder) => formatMoney(row.quantity * row.price, row.currency, displayCurrency, exchangeRates) },
        {
            title: "Reset",
            fixed: "right" as const,
            render: (_: unknown, row: TradeOrder) => (
                <Popconfirm
                    title="Reset this order?"
                    description="The balance and positions will be recalculated without it."
                    okText="Reset"
                    cancelText="Cancel"
                    onConfirm={() => resetOrder(row.id)}
                >
                    <Button type="text" danger icon={<ClearOutlined />} aria-label={`Reset ${row.symbol} order`} />
                </Popconfirm>
            ),
        },
    ];

    const handleNoteChange = (nextNote: StrategyNote) => {
        setScenarios((current) => current.map((scenario) => scenario.id === activeId ? { ...scenario, note: nextNote } : scenario));
    };

    return (
        <ConfigProvider theme={{ token: { colorPrimary: "#0f766e", borderRadius: 10 } }}>
            <App>
                {contextHolder}
                <Layout className="trade-page">
                    <Layout.Content className="trade-content">
                        <div className="trade-heading">
                            <div>
                                <Typography.Text className="eyebrow">PAPER TRADING LAB</Typography.Text>
                                <Typography.Title level={1}>Strategy workspace</Typography.Title>
                                <Typography.Paragraph>Try orders, track positions, and compare portfolio performance with live market data.</Typography.Paragraph>
                            </div>

                            <Space className="header-actions">
                                <Button type="default" icon={<FileTextOutlined />} onClick={() => setNoteDrawerOpen(true)}>
                                    Strategy notes
                                </Button>
                                <Select
                                    value={displayCurrency}
                                    onChange={(value) => setDisplayCurrency(value as CurrencyCode)}
                                    options={CURRENCY_OPTIONS.map((currency) => ({ value: currency, label: currency }))}
                                    style={{ width: 110 }}
                                />
                                <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void refreshQuotes()}>
                                    Refresh
                                </Button>
                            </Space>
                        </div>

                        <Tabs
                            activeKey={activeId}
                            onChange={setActiveId}
                            type="card"
                            className="scenario-tabs"
                            items={scenarios.map((scenario) => ({ key: scenario.id, label: scenario.name }))}
                            tabBarExtraContent={
                                <Space>
                                    <Button type="text" icon={<PlusOutlined />} onClick={() => setNewScenarioOpen(true)}>
                                        New scenario
                                    </Button>
                                    <Button type="text" danger icon={<DeleteOutlined />} onClick={deleteScenario}>
                                        Delete tab
                                    </Button>
                                </Space>
                            }
                        />

                        {activeScenario && summary ? (
                            <>
                                <Row gutter={[14, 14]} className="metrics-row" style={{ marginBottom: 12 }}>
                                    <Col xs={24} sm={12} lg={12}>
                                        <Card>
                                            <Statistic title="Initial capital (account)" value={activeScenario.capital} formatter={(value) => formatCompactMoney(Number(value), ACCOUNT_CURRENCY, displayCurrency, exchangeRates)} />
                                        </Card>
                                    </Col>
                                    <Col xs={24} sm={12} lg={12}>
                                        <Card>
                                            <Statistic title="Cash (account)" value={summary.cash} formatter={(value) => formatCompactMoney(Number(value), ACCOUNT_CURRENCY, displayCurrency, exchangeRates)} />
                                        </Card>
                                    </Col>
                                </Row>
                                <Row gutter={[14, 14]} className="metrics-row">
                                    <Col xs={24} sm={12} lg={8}>
                                        <Card>
                                            <Statistic title="Portfolio value (account)" value={summary.totalValue} formatter={(value) => formatCompactMoney(Number(value), ACCOUNT_CURRENCY, displayCurrency, exchangeRates)} />
                                        </Card>
                                    </Col>
                                    <Col xs={24} sm={12} lg={8}>
                                        <Card>
                                            <Statistic title="Net P/L (account)" value={summary.totalPnl} styles={{ content: { color: pnlColor(summary.totalPnl) } }} prefix={summary.totalPnl >= 0 ? "+" : ""} formatter={(value) => formatCompactMoney(Number(value), ACCOUNT_CURRENCY, displayCurrency, exchangeRates)} />
                                        </Card>
                                    </Col>
                                    <Col xs={24} sm={12} lg={8}>
                                        <Card>
                                            <Statistic title="Return" value={(summary.totalPnl / (activeScenario.capital || 1)) * 100} styles={{ content: { color: pnlColor(summary.totalPnl) } }} suffix="%" formatter={(value) => `${Number(value).toFixed(2)}`} />
                                        </Card>
                                    </Col>
                                </Row>

                                <Row gutter={[18, 18]} align="top" style={{ marginTop: 18 }}>
                                    <Col xs={24} lg={9}>
                                        <Card title={<Space><SwapOutlined />Place simulated order</Space>} className="trade-card">
                                            <Form form={form} layout="vertical" initialValues={{ side: "buy", assetType: "stock", inputMode: "quantity" }} onFinish={submitOrder}>
                                                <Form.Item name="side" label="Action">
                                                    <Select options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]} />
                                                </Form.Item>

                                                <Form.Item name="assetType" label="Market">
                                                    <Select
                                                        options={[
                                                            { value: "stock", label: "Vietnam stock" },
                                                            { value: "crypto", label: "Crypto" },
                                                        ]}
                                                        onChange={() => form.setFieldValue("symbol", undefined)}
                                                    />
                                                </Form.Item>

                                                <Form.Item name="inputMode" label="Order by">
                                                    <Select options={[{ value: "quantity", label: "Quantity" }, { value: "amount", label: "Budget (USD)" }]} />
                                                </Form.Item>

                                                <Form.Item noStyle shouldUpdate={(prev, next) => prev.assetType !== next.assetType}>
                                                    {({ getFieldValue }) => (
                                                        <Form.Item name="symbol" label="Asset" rules={[{ required: true, message: "Select an asset" }]}>
                                                            <Select
                                                                showSearch
                                                                placeholder="Select symbol from live data"
                                                                options={quoteOptions
                                                                    .filter(([key]) => key.startsWith(`${getFieldValue("assetType")}:`))
                                                                    .map(([, row]) => ({
                                                                        value: row.symbol,
                                                                        label: (
                                                                            <Space>
                                                                                <strong>{row.symbol}</strong>
                                                                                <Typography.Text type="secondary">{formatMoney(row.price ?? 0, row.currency, displayCurrency, exchangeRates)}</Typography.Text>
                                                                            </Space>
                                                                        ),
                                                                    }))}
                                                            />
                                                        </Form.Item>
                                                    )}
                                                </Form.Item>

                                                <Row gutter={10}>
                                                    <Form.Item noStyle shouldUpdate={(prev, next) => prev.inputMode !== next.inputMode}>
                                                        {({ getFieldValue }) => getFieldValue("inputMode") === "amount" ? (
                                                            <Col span={12}>
                                                                <Form.Item name="amount" label="Budget (USD)" rules={[{ required: true, message: "Enter a budget" }, { type: "number", min: 0.01, message: "Budget must be greater than zero" }]}>
                                                                    <InputNumber min={0.01} style={{ width: "100%" }} addonAfter={ACCOUNT_CURRENCY} />
                                                                </Form.Item>
                                                            </Col>
                                                        ) : (
                                                            <Col span={12}>
                                                                <Form.Item name="quantity" label="Quantity" rules={[{ required: true, message: "Enter quantity" }, { type: "number", min: 0.00000001, message: "Quantity must be greater than zero" }]}>
                                                                    <InputNumber min={0.00000001} style={{ width: "100%" }} />
                                                                </Form.Item>
                                                            </Col>
                                                        )}
                                                    </Form.Item>
                                                    <Col span={12}>
                                                        <Form.Item name="price" label="Execution price (optional)">
                                                            <InputNumber min={0} style={{ width: "100%" }} />
                                                        </Form.Item>
                                                    </Col>
                                                </Row>

                                                <Button type="primary" htmlType="submit" block icon={<SwapOutlined />}>
                                                    Record order
                                                </Button>
                                            </Form>

                                            <Divider />
                                            <Typography.Text type="secondary">
                                                Initial capital: {formatMoney(activeScenario.capital, ACCOUNT_CURRENCY, displayCurrency, exchangeRates)} · Account balance is tracked in USD; each order is converted from its trading currency. FIFO is used to calculate cost basis on sell orders.
                                            </Typography.Text>
                                        </Card>
                                    </Col>

                                    <Col xs={24} lg={15} >
                                        <Card title="Open positions" className="trade-card">
                                            <Table
                                                rowKey={(row) => `${row.assetType}:${row.symbol}`}
                                                columns={positionColumns}
                                                dataSource={summary.positions}
                                                pagination={false}
                                                locale={{
                                                    emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No open positions yet. Add your first trade." />,
                                                }}
                                                scroll={{ x: 780 }}
                                            />
                                        </Card>
                                    </Col>
                                </Row>

                                <Card
                                    title={<Space><span>Order history</span><Tag>{activeScenario.orders.length} orders</Tag></Space>}
                                    extra={<Space>
                                        <Button type="text" icon={<UndoOutlined />} disabled={activeScenario.orders.length === 0} onClick={undoLastOrder}>Undo last</Button>
                                        <Button type="text" danger icon={<ReloadOutlined />} disabled={activeScenario.orders.length === 0} onClick={resetScenario}>Reset all</Button>
                                    </Space>}
                                    className="trade-card order-history"
                                    style={{ marginTop: 18 }}
                                >
                                    <Table rowKey="id" columns={orderColumns} dataSource={[...activeScenario.orders].reverse()} pagination={{ pageSize: 8, hideOnSinglePage: true }} scroll={{ x: 700 }} />
                                </Card>
                            </>
                        ) : null}

                        <Modal
                            title="Create trading scenario"
                            open={newScenarioOpen}
                            onCancel={() => setNewScenarioOpen(false)}
                            onOk={createScenario}
                            okText="Create scenario"
                            cancelText="Cancel"
                        >
                            <Space orientation="vertical" style={{ width: "100%" }}>
                                <Input autoFocus value={newScenarioName} onChange={(event) => setNewScenarioName(event.target.value)} placeholder="Example: BTC DCA 2026" />
                                <InputNumber min={1} value={newScenarioCapital} onChange={(value) => setNewScenarioCapital(value ?? 0)} style={{ width: "100%" }} addonAfter={ACCOUNT_CURRENCY} />
                            </Space>
                        </Modal>

                        <Modal
                            title={activeScenario ? `${activeScenario.name} · Strategy notes` : "Strategy notes"}
                            open={noteDrawerOpen}
                            onCancel={() => setNoteDrawerOpen(false)}
                            footer={null}
                            width={760}
                            centered
                            className="strategy-note-modal"
                        >
                            {activeScenario && (
                                <StrategyNotePanel
                                    title={activeScenario.name}
                                    note={activeScenarioNote}
                                    onChange={(nextNote) => {
                                        handleNoteChange(nextNote);
                                        setNoteDrawerOpen(true);
                                    }}
                                />
                            )}
                        </Modal>
                    </Layout.Content>
                </Layout>
            </App>
        </ConfigProvider>
    );
}
