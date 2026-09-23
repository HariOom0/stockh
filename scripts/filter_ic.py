#!/usr/bin/env python3
"""Filter the existing daily stock list for the IC conditions.

IC conditions (evaluated with TradingView daily scanner values):
- daily close > daily SMA( close, 200 )
- daily percentage change >= 8
- market cap > 1,000 crore

The input is the already-scraped stock list; this script does not scrape a
second stock universe.
"""

import json
import sys
import urllib.request

MARKET_CAP_MIN_RUPEES = 1000 * 10_000_000  # 1,000 crore
BATCH_SIZE = 50
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
}


def scan_batch(tickers):
    payload = {
        "symbols": {"tickers": [f"NSE:{ticker}" for ticker in tickers]},
        "columns": ["description", "close", "change", "market_cap_basic", "SMA200"],
    }
    request = urllib.request.Request(
        "https://scanner.tradingview.com/india/scan",
        data=json.dumps(payload).encode(),
        headers=HEADERS,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.loads(response.read().decode())
    return data.get("data", [])


def main():
    source = json.load(sys.stdin)
    if not isinstance(source, list):
        raise ValueError("Input stock data must be a JSON array")

    by_ticker = {}
    for stock in source:
        ticker = str(stock.get("ticker", "")).strip().upper()
        if ticker and ticker.isalnum():
            by_ticker[ticker] = stock

    results = []
    tickers = list(by_ticker)
    for start in range(0, len(tickers), BATCH_SIZE):
        rows = scan_batch(tickers[start : start + BATCH_SIZE])
        for row in rows:
            values = row.get("d") or []
            symbol = str(row.get("s", "")).split(":")[-1].upper()
            if len(values) < 5 or symbol not in by_ticker:
                continue

            close = float(values[1] or 0)
            change = float(values[2] or 0)
            market_cap = float(values[3] or 0)
            sma200 = float(values[4] or 0)
            if not (close > sma200 and change >= 8 and market_cap > MARKET_CAP_MIN_RUPEES):
                continue

            source_stock = by_ticker[symbol]
            results.append({
                "sr": 0,
                "name": str(values[0] or source_stock.get("name") or symbol),
                "ticker": symbol,
                "close": close,
                "change": change,
                "volGainPct": float(source_stock.get("volGainPct") or 0),
                "isPositive": True,
                "sma200": sma200,
                "marketCapCr": market_cap / 10_000_000,
            })

    results.sort(key=lambda stock: (-stock["change"], stock["ticker"]))
    for index, stock in enumerate(results, start=1):
        stock["sr"] = index
    print(json.dumps(results))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
