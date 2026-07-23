#!/usr/bin/env python3
"""Scrape Chartink EOD Volume Shockers page using curl_cffi (bypasses Cloudflare TLS fingerprinting)."""

import sys
import json
import re

try:
    from curl_cffi import requests as curl_requests
    from bs4 import BeautifulSoup
except ImportError:
    print(json.dumps({"error": "Missing dependencies: pip install curl_cffi beautifulsoup4"}))
    sys.exit(1)

def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://chartink.com/eodscanner/Volume-Shockers.html"
    
    try:
        resp = curl_requests.get(url, impersonate="chrome", timeout=30)
    except Exception as e:
        print(json.dumps({"error": f"Request failed: {str(e)}"}))
        sys.exit(1)
    
    if 'stocklisttable' not in resp.text:
        print(json.dumps({"error": "Table not found (likely Cloudflare challenge)", "status": resp.status_code, "body_length": len(resp.text)}))
        sys.exit(1)
    
    soup = BeautifulSoup(resp.text, 'html.parser')
    rows = soup.select('#stocklisttable tbody tr')
    stocks = []
    
    for row in rows[1:]:  # Skip header row
        cells = row.select('td')
        if len(cells) < 6:
            continue
        
        link = cells[1].find('a', href=True)
        if not link:
            continue
        
        href = link.get('href', '')
        ticker_match = re.search(r'/stocks/([A-Z0-9]+)\.html', href)
        if not ticker_match:
            continue
        
        ticker = ticker_match.group(1)
        name = link.get_text(strip=True)
        name_clean = re.sub(r'\s*(Ltd|Limited)\.?\s*$', '', name, flags=re.IGNORECASE).strip()
        
        close_text = cells[3].get_text(strip=True)
        change_text = cells[4].get_text(strip=True)
        vol_text = cells[5].get_text(strip=True)
        
        change_match = re.search(r'([+-]?[\d.]+)%', change_text)
        vol_match = re.search(r'([\d.]+)%', vol_text)
        
        try:
            close = float(close_text)
        except (ValueError, TypeError):
            close = 0
        change = float(change_match.group(1)) if change_match else 0
        vol_gain = float(vol_match.group(1)) if vol_match else 0
        
        if ticker and name_clean and close > 0:
            stocks.append({
                "ticker": ticker,
                "name": name_clean,
                "close": close,
                "change": change,
                "volGainPct": vol_gain,
                "isPositive": change > 0,
            })
    
    print(json.dumps(stocks))

if __name__ == "__main__":
    main()
