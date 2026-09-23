#!/usr/bin/env python3
"""Run the IC condition scan across Chartink's full stock universe.

The existing volume-shocker scrape is not used to define the IC universe.
The clause mirrors the user's Chartink conditions exactly:
- daily close > daily SMA(close, 200)
- daily percentage change >= 8
- market cap > 1000 crore
"""

import json
import re
import sys

import requests

SCAN_CLAUSE = (
    '{cash} ( daily close > daily sma ( close,200 ) '
    'and daily "close - 1 candle ago close / 1 candle ago close * 100" >= 8 '
    'and market cap > 1000 )'
)


def main():
    source = json.load(sys.stdin)
    source_by_ticker = {
        str(stock.get("ticker", "")).strip().upper(): stock
        for stock in source
        if isinstance(stock, dict)
    } if isinstance(source, list) else {}

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    page = session.get("https://chartink.com/screener/", timeout=30)
    page.raise_for_status()
    token_match = re.search(
        r'<meta[^>]+name=["\']csrf-token["\'][^>]+content=["\']([^"\']+)',
        page.text,
        re.IGNORECASE,
    )
    if not token_match:
        raise RuntimeError("Chartink CSRF token not found")

    session.headers.update({
        "x-csrf-token": token_match.group(1),
        "Content-Type": "application/x-www-form-urlencoded",
    })
    response = session.post(
        "https://chartink.com/screener/process",
        data={"scan_clause": SCAN_CLAUSE},
        timeout=60,
    )
    response.raise_for_status()
    rows = response.json().get("data", [])

    results = []
    for row in rows:
        ticker = str(row.get("nsecode") or "").strip().upper()
        if not ticker:
            continue
        source_stock = source_by_ticker.get(ticker, {})
        results.append({
            "sr": 0,
            "name": str(row.get("name") or source_stock.get("name") or ticker),
            "ticker": ticker,
            "close": float(row.get("close") or source_stock.get("close") or 0),
            "change": float(row.get("per_chg") or 0),
            "volGainPct": float(source_stock.get("volGainPct") or 0),
            "isPositive": float(row.get("per_chg") or 0) > 0,
            "volume": int(row.get("volume") or 0),
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
