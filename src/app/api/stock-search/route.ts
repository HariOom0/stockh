import { NextRequest, NextResponse } from "next/server";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// In-memory cache for search results
const searchCache = new Map<string, { data: SearchResult[]; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

export interface SearchResult {
  name: string;
  ticker: string;
  url: string;
}

/**
 * Search screener.in for companies matching the query.
 * Uses the JSON API endpoint if available, falls back to scraping the search page.
 */
async function searchScreener(query: string): Promise<SearchResult[]> {
  // Method 1: Try the JSON search API endpoint
  // Screener.in returns: [{id, name, url: "/company/TICKER/consolidated/"}, ...]
  try {
    const apiUrl = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(query)}&limit=15`;
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data
            .filter((item: Record<string, string>) => item.url)
            .map((item: Record<string, string>) => {
              // Extract ticker from URL like "/company/RELIANCE/consolidated/" or "/company/TCS/"
              const urlMatch = item.url.match(/\/company\/([A-Z0-9]+)/);
              const ticker = urlMatch ? urlMatch[1] : "";
              return {
                name: item.name || ticker,
                ticker,
                url: item.url,
              };
            })
            .filter((r: SearchResult) => r.ticker.length > 0);
        }
      }
    }
  } catch {
    // Fall through to scraping method
  }

  // Method 2: Scrape the search results page
  try {
    const searchUrl = `https://www.screener.in/company/search/?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];

    const html = await res.text();
    const results: SearchResult[] = [];

    // Parse the HTML to extract company links from search results
    // Screener.in search results typically show links like /company/TICKER/
    const urlRegex = /href="(\/company\/([A-Z0-9]+))\/"/gi;
    const seen = new Set<string>();

    let match;
    while ((match = urlRegex.exec(html)) !== null) {
      const url = match[1];
      const ticker = match[2];
      if (!seen.has(ticker) && ticker.length > 1) {
        seen.add(ticker);
        results.push({ name: ticker, ticker, url });
      }
      if (results.length >= 15) break;
    }

    // Try to extract names from nearby text
    if (results.length > 0) {
      // Look for company names near the links
      const nameRegex = /<a[^>]*href="\/company\/[A-Z0-9]+\/"[^>]*>([^<]+)/gi;
      const nameMap = new Map<string, string>();
      let nameMatch;
      while ((nameMatch = nameRegex.exec(html)) !== null) {
        const fullMatch = nameMatch[0];
        const tickerMatch = fullMatch.match(/href="\/company\/([A-Z0-9]+)\//);
        const name = nameMatch[1].trim();
        if (tickerMatch && name) {
          nameMap.set(tickerMatch[1], name);
        }
      }

      for (const r of results) {
        const mappedName = nameMap.get(r.ticker);
        if (mappedName && mappedName.length > 2) {
          r.name = mappedName;
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");

  if (!query || query.trim().length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters", results: [] },
      { status: 400 }
    );
  }

  const trimmedQuery = query.trim();
  const cacheKey = trimmedQuery.toUpperCase();
  const now = Date.now();

  // Check cache
  const cached = searchCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ results: cached.data, cached: true });
  }

  try {
    const results = await searchScreener(trimmedQuery);

    if (results.length === 0) {
      return NextResponse.json({ results: [], cached: false });
    }

    // Cache the results
    searchCache.set(cacheKey, { data: results, timestamp: now });

    // Limit cache size
    if (searchCache.size > 200) {
      const keys = [...searchCache.keys()];
      for (let i = 0; i < 50; i++) {
        searchCache.delete(keys[i]);
      }
    }

    return NextResponse.json({ results, cached: false });
  } catch (error) {
    console.error("Error searching stocks:", error);
    return NextResponse.json(
      { error: "Failed to search. Please try again.", results: [] },
      { status: 503 }
    );
  }
}