import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type MarketRow = {
  symbol: string;
  price: number | null;
  currency: string;
  changePercent: number | null;
  source: string;
  status: "ok" | "unavailable";
  updatedAt: string;
};

const DEFAULT_CRYPTO = ["BTCUSDT", "SOLUSDT", "ETHUSDT", "ERBUSDT"];
const DEFAULT_VN_STOCKS = ["SSI", "GAS"];

function getNearestWeekday(date = new Date()): Date {
  const d = new Date(date);

  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }

  return d;
}

function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseVnDate(raw: string | null): string {
  if (!raw) {
    return formatDateYYYYMMDD(getNearestWeekday());
  }

  const normalized = raw.replace(/-/g, "");
  if (!/^\d{8}$/.test(normalized)) {
    return formatDateYYYYMMDD(getNearestWeekday());
  }

  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6));
  const day = Number(normalized.slice(6, 8));
  const parsed = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return formatDateYYYYMMDD(getNearestWeekday());
  }

  return formatDateYYYYMMDD(getNearestWeekday(parsed));
}

function parseSymbols(raw: string | null, fallback: string[]): string[] {
  if (!raw) {
    return fallback;
  }

  const items = raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  return items.length > 0 ? [...new Set(items)] : fallback;
}

async function fetchCryptoQuotes(symbols: string[]): Promise<MarketRow[]> {
  const requests = symbols.map(async (symbol) => {
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(
      symbol,
    )}`;

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Binance API returned ${response.status}`);
      }

      const payload: {
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
        closeTime: number;
      } = await response.json();

      return {
        symbol: payload.symbol ?? symbol,
        price: Number(payload.lastPrice),
        currency: "USD",
        changePercent: Number(payload.priceChangePercent),
        source: "Binance",
        status: "ok" as const,
        updatedAt: new Date(payload.closeTime).toISOString(),
      };
    } catch {
      return {
        symbol,
        price: null,
        currency: "USD",
        changePercent: null,
        source: "Binance",
        status: "unavailable" as const,
        updatedAt: new Date().toISOString(),
      };
    }
  });

  return Promise.all(requests);
}

async function fetchVietnamStockQuotes(
  symbols: string[],
  vnDate: string,
): Promise<MarketRow[]> {
  const requests = symbols.map(async (symbol) => {
    const url = `https://msh-appdata.cafef.vn/rest-api/api/v1/MatchPrice?symbol=${encodeURIComponent(
      symbol,
    )}&date=${encodeURIComponent(vnDate)}`;

    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`CafeF API returned ${response.status}`);
      }

      const payload: {
        data?: Array<{
          symbol?: string;
          tradeDate?: string;
          basicPrice?: number;
          price?: number;
        }>;
      } = await response.json();

      const trades = payload.data ?? [];
      const latestTrade = trades
        .filter(
          (item) =>
            typeof item.price === "number" &&
            typeof item.tradeDate === "string" &&
            item.tradeDate.length > 0,
        )
        .sort(
          (a, b) =>
            new Date(b.tradeDate as string).getTime() -
            new Date(a.tradeDate as string).getTime(),
        )[0];

      if (!latestTrade || typeof latestTrade.price !== "number") {
        return {
          symbol,
          price: null,
          currency: "VND",
          changePercent: null,
          source: "CafeF",
          status: "unavailable" as const,
          updatedAt: new Date().toISOString(),
        };
      }

      const basicPrice = latestTrade.basicPrice;
      const changePercent =
        typeof basicPrice === "number" && basicPrice > 0
          ? ((latestTrade.price - basicPrice) / basicPrice) * 100
          : null;

      return {
        symbol: latestTrade.symbol ?? symbol,
        price: latestTrade.price,
        currency: "VND",
        changePercent,
        source: "CafeF",
        status: "ok" as const,
        updatedAt: latestTrade.tradeDate
          ? new Date(latestTrade.tradeDate).toISOString()
          : new Date().toISOString(),
      };
    } catch {
      return {
        symbol,
        price: null,
        currency: "VND",
        changePercent: null,
        source: "CafeF",
        status: "unavailable" as const,
        updatedAt: new Date().toISOString(),
      };
    }
  });

  return Promise.all(requests);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const include = searchParams.get("include");

  const cryptoSymbols = parseSymbols(
    searchParams.get("crypto"),
    DEFAULT_CRYPTO,
  ).slice(0, 20);
  const vnSymbols = parseSymbols(searchParams.get("vn"), DEFAULT_VN_STOCKS).slice(
    0,
    20,
  );
  const vnDate = parseVnDate(searchParams.get("vnDate"));
  const shouldFetchCrypto = include !== "vn";
  const shouldFetchVn = include !== "crypto";

  const [crypto, vnStocks] = await Promise.all([
    shouldFetchCrypto ? fetchCryptoQuotes(cryptoSymbols) : Promise.resolve([]),
    shouldFetchVn ? fetchVietnamStockQuotes(vnSymbols, vnDate) : Promise.resolve([]),
  ]);

  return NextResponse.json(
    {
      updatedAt: new Date().toISOString(),
      vnDate,
      crypto,
      vnStocks,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
