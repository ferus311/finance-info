import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  JPY: 157.5,
  VND: 25000,
};

function normalizeSymbols(raw: string | null): string[] {
  if (!raw) return ["USD", "JPY", "VND", "EUR"];

  const values = raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  return values.length > 0 ? [...new Set(values)] : ["USD", "JPY", "VND", "EUR"];
}

async function fetchLiveRates(base: string, symbols: string[]) {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Exchange rate API returned ${response.status}`);
  }

  const payload: {
    base?: string;
    rates?: Record<string, number>;
    time_last_update_utc?: string;
  } = await response.json();

  const nextRates = {
    ...FALLBACK_RATES,
    ...(payload.rates ?? {}),
  };

  const selected = Object.fromEntries(
    symbols.map((symbol) => {
      const normalized = symbol.toUpperCase();
      return [normalized, Number(nextRates[normalized] ?? fallbackRate(normalized, base, nextRates))];
    }),
  );

  return {
    base: payload.base ?? base,
    rates: selected,
    updatedAt: payload.time_last_update_utc ?? new Date().toISOString(),
  };
}

function fallbackRate(symbol: string, base: string, rates: Record<string, number>) {
  if (symbol === base) return 1;
  if (symbol === "USD" && base !== "USD") return 1 / (rates[base] ?? 1);
  if (symbol !== "USD" && base === "USD") return FALLBACK_RATES[symbol] ?? 1;
  const baseToUsd = base === "USD" ? 1 : rates[base] ?? 1;
  return ((rates[symbol] ?? FALLBACK_RATES[symbol] ?? 1) / baseToUsd) || 1;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const base = (searchParams.get("base") ?? "USD").toUpperCase();
  const symbols = normalizeSymbols(searchParams.get("symbols"));

  try {
    const payload = await fetchLiveRates(base, symbols);
    return NextResponse.json({ ...payload }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    const baseValue = base === "USD" ? 1 : FALLBACK_RATES[base] ?? 1;
    const rates = Object.fromEntries(
      symbols.map((symbol) => {
        const normalized = symbol.toUpperCase();
        const value = normalized === base ? 1 : normalized === "USD" ? 1 / baseValue : (FALLBACK_RATES[normalized] ?? 1) / baseValue;
        return [normalized, Number(value)];
      }),
    );

    return NextResponse.json(
      {
        base,
        rates,
        updatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
