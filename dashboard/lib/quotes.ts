export async function fetchQuotes(tickers: string[], limit = 16): Promise<Record<string, number>> {
  const selected = [...new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))].slice(0, limit);
  const rows = await Promise.all(selected.map(async (ticker) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
      const res = await fetch(url, { headers: { "User-Agent": "TradeMind/1.0" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice ?? meta?.previousClose);
      return Number.isFinite(price) && price > 0 ? [ticker, price] as const : null;
    } catch {
      return null;
    }
  }));
  return Object.fromEntries(rows.filter((row): row is readonly [string, number] => row != null));
}
