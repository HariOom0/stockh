"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  ArrowUpRight,
  RefreshCw,
  Search,
  X,
  ExternalLink,
  BarChart3,
  Activity,
  Filter,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Zap,
  ArrowUpDown,
  Eye,
  Clock,
  Info,
  ArrowLeft,
  LineChart,
  Sparkles,
  Star,
  Loader2,
  Globe,
  CheckCircle,
  XCircle,
  Users,
  DollarSign,
  History,
  TrendingDown,
  Sun,
  Moon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Types ────────────────────────────────────────────────────────────
interface Stock {
  sr: number;
  name: string;
  ticker: string;
  close: number;
  change: number;
  volGainPct: number;
  isPositive: boolean;
}

interface SectorInsight {
  sector: string;
  trend: string;
  description: string;
  confidence: string;
}

interface StockDetail {
  name: string;
  ticker: string;
  bseCode?: string;
  nseCode?: string;
  sector?: string;
  industry?: string;
  about?: string;
  indices?: string[];
  metrics: Record<string, string>;
  quarters: {
    label: string;
    sales: string;
    netProfit: string;
    opm: string;
  }[];
  peers: { name: string; ticker: string }[];
  cached?: boolean;
  pros?: string[];
  cons?: string[];
  balanceSheet?: {
    label: string;
    reserves: string;
    borrowing: string;
    otherLiab: string;
    totalLiab: string;
    fixedAssets: string;
    cwip: string;
    totalAssets: string;
  }[];
  shareholding?: {
    category: string;
    values: { label: string; value: string }[];
  }[];
  annualResults?: {
    label: string;
    sales: string;
    netProfit: string;
    opm: string;
  }[];
  cashFlow?: {
    label: string;
    operatingCF: string;
    investingCF: string;
    financingCF: string;
  }[];
}

interface StockSectorMap {
  ticker: string;
  sector?: string;
  industry?: string;
  name?: string;
}

interface SearchResult {
  name: string;
  ticker: string;
}

type ViewMode = "list" | "suggestions" | "search" | "history";

// ─── Trend Colors ─────────────────────────────────────────────────────
function trendColor(trend: string) {
  switch (trend) {
    case "Bullish":
    case "Rotating In":
      return { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" };
    case "Bearish":
    case "Rotating Out":
      return { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30" };
    default:
      return { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30" };
  }
}

function confidenceDot(confidence: string) {
  switch (confidence) {
    case "High":
      return "bg-emerald-400";
    case "Medium":
      return "bg-amber-400";
    default:
      return "bg-zinc-500";
  }
}

// ─── TradingView URL helper ──────────────────────────────────────────
function tradingViewUrl(ticker: string): string {
  return `https://www.tradingview.com/chart/?symbol=NSE:${ticker}`;
}

// ─── Sector rotation rank (lower = stronger) ─────────────────────────
function trendRank(trend: string): number {
  const ranks: Record<string, number> = {
    "Bullish": 0,
    "Rotating In": 1,
    "Neutral": 2,
    "Bearish": 3,
    "Rotating Out": 4,
  };
  return ranks[trend] ?? 2;
}

// ─── Match a stock's sector to the nearest sector insight ─────────────
function matchSectorInsight(
  stockSector: string | undefined,
  insights: SectorInsight[]
): SectorInsight | null {
  if (!stockSector || insights.length === 0) return null;
  // Try exact match first, then partial match on first keyword
  const lower = stockSector.toLowerCase();
  const exact = insights.find(
    (s) => s.sector.toLowerCase() === lower
  );
  if (exact) return exact;
  const partial = insights.find((s) => {
    const keywords = s.sector.toLowerCase().split(/[\s&]+/).filter((w) => w.length > 2);
    return keywords.some((kw) => lower.includes(kw));
  });
  return partial || null;
}

// ─── Suggestion Group type ────────────────────────────────────────────
interface SuggestionGroup {
  trendLabel: string;
  trendKey: string;
  insight?: SectorInsight;
  stocks: (Stock & { matchedSector?: string })[];
}

// ─── Screener-style Table Components ─────────────────────────────────
function ScreenerTable({
  headers,
  fiscalYearEnds = [],
  children,
}: {
  headers: string[];
  fiscalYearEnds?: number[];
  children: React.ReactNode;
}) {
  return (
    <table className="w-full text-[11px] border-collapse">
      <thead>
        <tr className="border-b border-border">
          {headers.map((h, i) => (
            <th
              key={i}
              className={`px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap ${
                i === 0 ? "text-left" : "text-right"
              } ${fiscalYearEnds.includes(i - 1) ? "bg-primary/8" : ""}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function ScreenerRow({
  label,
  values,
  highlight = false,
}: {
  label: string;
  values: string[];
  highlight?: boolean;
}) {
  return (
    <tr className={`border-t border-border/60 ${highlight ? "bg-primary/5" : ""}`}>
      <td className="px-2 py-1.5 text-muted-foreground font-medium whitespace-nowrap">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-2 py-1.5 text-right font-mono whitespace-nowrap">
          {v}
        </td>
      ))}
    </tr>
  );
}

// ─── Main Component ──────────────────────────────────────────────────
const ACCESS_PASSWORD = "stockh2025";

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [filteredStocks, setFilteredStocks] = useState<Stock[]>([]);
  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"volGainPct" | "change" | "close" | "name">("volGainPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);

  // Lock body scroll when detail panel is open
  useEffect(() => {
    if (selectedStock) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [selectedStock]);
  const [stockDetail, setStockDetail] = useState<StockDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [sectorInsights, setSectorInsights] = useState<SectorInsight[]>([]);
  const [sectorLoading, setSectorLoading] = useState(true);
  const [showSectors, setShowSectors] = useState(false);
  const [selectedSectorInsight, setSelectedSectorInsight] = useState<SectorInsight | null>(null);

  // ─── Index Performance state ─────────────────────────────────────
  interface IndexData {
    name: string;
    symbol: string;
    lastPrice: number;
    changePct: number;
    changeAbs: number;
    recommendation: string;
  }
  const [showIndices, setShowIndices] = useState(false);
  const [indexData, setIndexData] = useState<IndexData[]>([]);
  const [indexLoading, setIndexLoading] = useState(false);

  const fetchIndices = async () => {
    setIndexLoading(true);
    try {
      const res = await fetch("/api/index-performance");
      const data = await res.json();
      if (data.indices) setIndexData(data.indices);
    } catch (err) {
      console.error("Failed to fetch indices:", err);
    } finally {
      setIndexLoading(false);
    }
  };

  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [stats, setStats] = useState({ total: 0, filtered: 0 });

  // ─── Suggestions state ───────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [historyDates, setHistoryDates] = useState<{ date: string; stockCount: number }[]>([]);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string | null>(null);
  const [historyStocks, setHistoryStocks] = useState<Stock[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sectorMap, setSectorMap] = useState<Map<string, StockSectorMap>>(new Map());
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const suggestionsFetchedRef = useRef(false);

  // ─── Universal Stock Search state ───────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [isSearchedStock, setIsSearchedStock] = useState(false);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Fetch Volume Shockers ───────────────────────────────────────
  const fetchStocks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/volume-shockers");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch");
      setStocks(data.stocks);
      setLastUpdated(data.lastUpdated);
      setStats({ total: data.totalOnChartink, filtered: data.filteredCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stocks");
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Fetch Sector Insights ───────────────────────────────────────
  const fetchSectors = useCallback(async () => {
    setSectorLoading(true);
    try {
      const res = await fetch("/api/sector-insights");
      const data = await res.json();
      setSectorInsights(data.insights);
    } catch {
      // silently fail
    } finally {
      setSectorLoading(false);
    }
  }, []);

  // ─── Fetch Sectors for all stocks (batch) ────────────────────────
  const fetchSuggestions = useCallback(async () => {
    if (suggestionsFetchedRef.current) return;
    suggestionsFetchedRef.current = true;
    setSuggestionsLoading(true);
    try {
      const tickers = stocks.map((s) => s.ticker).join(",");
      const res = await fetch(`/api/stock-sectors?tickers=${tickers}`);
      const data = await res.json();
      if (data.stocks) {
        const map = new Map<string, StockSectorMap>();
        for (const s of data.stocks) {
          map.set(s.ticker, s);
        }
        setSectorMap(map);
        setSuggestionsLoaded(true);
      }
    } catch {
      // silently fail
    } finally {
      setSuggestionsLoading(false);
    }
  }, [stocks]);

  useEffect(() => {
    fetchStocks();
    fetchSectors();
  }, [fetchStocks, fetchSectors]);

  // ─── Filter & Sort ───────────────────────────────────────────────
  useEffect(() => {
    let result = [...stocks];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.ticker.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") {
        cmp = a.name.localeCompare(b.name);
      } else {
        cmp = (a[sortBy] as number) - (b[sortBy] as number);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    setFilteredStocks(result);
  }, [stocks, search, sortBy, sortDir]);

  // ─── Fetch Stock Detail ──────────────────────────────────────────
  useEffect(() => {
    if (!selectedStock) {
      setStockDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError("");
    fetch(`/api/stock-detail?ticker=${selectedStock.ticker}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStockDetail(data);
        // Also update sectorMap if we have sector info
        if (data.sector) {
          setSectorMap((prev) => {
            const next = new Map(prev);
            next.set(selectedStock.ticker, {
              ticker: selectedStock.ticker,
              sector: data.sector,
              industry: data.industry,
              name: data.name,
            });
            return next;
          });
        }
      })
      .catch((err) => {
        setDetailError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setDetailLoading(false));
  }, [selectedStock]);

  // Reset isSearchedStock when closing detail panel
  useEffect(() => {
    if (!selectedStock) setIsSearchedStock(false);
  }, [selectedStock]);

  // ─── Universal Stock Search ─────────────────────────────────────
  const performSearch = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      setSearchError("");
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    try {
      const res = await fetch(`/api/stock-search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (data.error) {
        setSearchError(data.error);
        setSearchResults([]);
      } else {
        setSearchResults(data.results || []);
        if (!data.results || data.results.length === 0) {
          setSearchError(`No results found for "${query.trim()}"`);
        }
      }
    } catch {
      setSearchError("Search failed. Please try again.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        performSearch(value);
      }, 400);
    },
    [performSearch]
  );

  const handleSearchSelect = useCallback((result: SearchResult) => {
    // Create a minimal Stock object for the detail panel
    setSelectedStock({
      sr: 0,
      name: result.name,
      ticker: result.ticker,
      close: 0,
      change: 0,
      volGainPct: 0,
      isPositive: true,
    });
    setIsSearchedStock(true);
  }, []);

  // ─── Handle Peer Click (direct navigation with ticker) ──────────
  const [peerLoading, setPeerLoading] = useState(false);
  const handlePeerClick = useCallback((peerName: string, peerTicker: string) => {
    setPeerLoading(true);
    setStockDetail(null);
    // Directly select the peer using its ticker — no search needed
    setSelectedStock({
      sr: 0,
      name: peerName,
      ticker: peerTicker,
      close: 0,
      change: 0,
      volGainPct: 0,
      isPositive: true,
    });
    setIsSearchedStock(true);
    // Small delay to show the loading state briefly
    setTimeout(() => setPeerLoading(false), 300);
  }, []);

  // ─── Toggle Sort ─────────────────────────────────────────────────
  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ field }: { field: typeof sortBy }) => {
    if (sortBy !== field) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "desc" ? (
      <ChevronDown className="w-3 h-3" />
    ) : (
      <ChevronUp className="w-3 h-3" />
    );
  };

  // ─── Sector suggestion for selected stock ────────────────────────
  const selectedSectorSuggestion = useMemo(() => {
    if (!selectedStock || !stockDetail) return null;
    return matchSectorInsight(stockDetail.sector, sectorInsights);
  }, [selectedStock, stockDetail, sectorInsights]);

  // ─── Sorted sectors for sector panel ─────────────────────────────
  const sortedSectors = useMemo(() => {
    return [...sectorInsights].sort(
      (a, b) => trendRank(a.trend) - trendRank(b.trend)
    );
  }, [sectorInsights]);

  // ─── Suggestions: group filtered stocks by sector rotation ───────
  const suggestionGroups = useMemo<SuggestionGroup[]>(() => {
    if (sectorInsights.length === 0 || sectorMap.size === 0) return [];

    const groups: SuggestionGroup[] = [
      { trendLabel: "Bullish Sectors", trendKey: "Bullish", stocks: [] },
      { trendLabel: "Rotating In", trendKey: "Rotating In", stocks: [] },
      { trendLabel: "Neutral Sectors", trendKey: "Neutral", stocks: [] },
      { trendLabel: "Bearish / Rotating Out", trendKey: "other", stocks: [] },
    ];

    // Map each filtered stock to its sector trend
    for (const stock of filteredStocks) {
      const info = sectorMap.get(stock.ticker);
      const insight = matchSectorInsight(info?.sector, sectorInsights);

      let groupIdx: number;
      if (!insight) {
        groupIdx = 2; // Neutral (unknown sector)
      } else if (insight.trend === "Bullish") {
        groupIdx = 0;
      } else if (insight.trend === "Rotating In") {
        groupIdx = 1;
      } else if (insight.trend === "Neutral") {
        groupIdx = 2;
      } else {
        groupIdx = 3; // Bearish or Rotating Out
      }

      groups[groupIdx].stocks.push({
        ...stock,
        matchedSector: info?.sector,
      });
    }

    // Sort stocks within each group by volGainPct descending
    for (const group of groups) {
      group.stocks.sort((a, b) => b.volGainPct - a.volGainPct);
    }

    // Attach the first matching insight to each group for display
    for (const group of groups) {
      if (group.stocks.length > 0) {
        const firstSector = group.stocks[0].matchedSector;
        group.insight = matchSectorInsight(firstSector, sectorInsights) || undefined;
      }
    }

    // Only return groups that have stocks
    return groups.filter((g) => g.stocks.length > 0);
  }, [filteredStocks, sectorMap, sectorInsights]);

  // ─── Handle switching to suggestions view ────────────────────────
  const handleViewSwitch = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === "suggestions" && !suggestionsLoaded && !suggestionsLoading) {
      fetchSuggestions();
    }
    if (mode === "history") {
      fetchHistoryDates();
    }
  };

  // ─── History functions ───────────────────────────────────────────
  const fetchHistoryDates = async () => {
    try {
      const res = await fetch("/api/stock-history");
      const data = await res.json();
      if (data.snapshots) setHistoryDates(data.snapshots);
    } catch (err) {
      console.error("Failed to fetch history dates:", err);
    }
  };

  const fetchHistoryStocks = async (date: string) => {
    setSelectedHistoryDate(date);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/stock-history?date=${date}`);
      const data = await res.json();
      if (data.stocks) {
        const stocks: Stock[] = data.stocks.map((s: Record<string, unknown>, i: number) => ({
          sr: i + 1,
          name: s.name as string,
          ticker: s.ticker as string,
          close: s.close as number,
          change: s.change as number,
          volGainPct: s.volGainPct as number,
          isPositive: s.isPositive as boolean,
        }));
        setHistoryStocks(stocks);
      }
    } catch (err) {
      console.error("Failed to fetch history stocks:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };

  // Check session storage for existing auth
  useEffect(() => {
    const session = sessionStorage.getItem("stockh_auth");
    if (session === "true") setIsAuthenticated(true);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === ACCESS_PASSWORD) {
      setIsAuthenticated(true);
      sessionStorage.setItem("stockh_auth", "true");
      setPasswordError("");
    } else {
      setPasswordError("Wrong password");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center mb-4">
              <BarChart3 className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">StockH</h1>
            <p className="text-sm text-muted-foreground mt-1">Private access only</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Input
                type="password"
                placeholder="Enter password"
                value={passwordInput}
                onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }}
                className="h-11 text-center text-lg tracking-widest"
                autoFocus
              />
              {passwordError && (
                <p className="text-xs text-destructive mt-2 text-center">{passwordError}</p>
              )}
            </div>
            <Button type="submit" className="w-full h-11" size="lg">
              Enter
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-background">
        {/* ─── HEADER ─────────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">StockH</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Volume Shockers &middot; Indian Market
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {lastUpdated && (
                <span className="text-xs text-muted-foreground hidden md:flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(lastUpdated).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowSectors(!showSectors); setShowIndices(false); if (!showSectors) fetchSectors(); }}
              >
                <Activity className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Sectors</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowIndices(!showIndices); setShowSectors(false); if (!showIndices) fetchIndices(); }}
              >
                <TrendingDown className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Indices</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchStocks}
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="w-9 h-9"
                    onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  >
                    <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                    <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                    <span className="sr-only">Toggle theme</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{theme === "dark" ? "Light mode" : "Dark mode"}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          {/* ─── VIEW TABS (sticky sub-header) ──────────────── */}
          {(stocks.length > 0 || viewMode === "search" || viewMode === "history") && (
            <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pb-2">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-secondary w-fit">
                <button
                  onClick={() => handleViewSwitch("list")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    viewMode === "list"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5" />
                    All Stocks
                  </span>
                </button>
                <button
                  onClick={() => handleViewSwitch("suggestions")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    viewMode === "suggestions"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Suggestions
                  </span>
                </button>
                <button
                  onClick={() => handleViewSwitch("search")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    viewMode === "search"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5" />
                    Search
                  </span>
                </button>
                <button
                  onClick={() => handleViewSwitch("history")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    viewMode === "history"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    History
                  </span>
                </button>
              </div>
            </div>
          )}
        </header>

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
          {/* ─── SECTOR INSIGHTS PANEL ────────────────────────────── */}
          <AnimatePresence>
            {showSectors && sectorInsights.length > 0 && (
              <motion.section
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden mb-6"
              >
                <Card className="border-border">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Activity className="w-4 h-4 text-primary" />
                        Sector Rotation Analysis
                        {sectorLoading && (
                          <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
                        )}
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setShowSectors(false)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      AI-powered sector rotation insights for the Indian stock market. Use this to assess
                      whether the sector of a volume shocker stock is in favour.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                      {sortedSectors.map((s) => {
                        const tc = trendColor(s.trend);
                        return (
                          <div key={s.sector} className={`rounded-lg border p-3 ${tc.bg} ${tc.border} cursor-pointer hover:scale-[1.03] transition-transform`} onClick={() => setSelectedSectorInsight(s)}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-foreground truncate mr-1">
                                {s.sector}
                              </span>
                              <span className={`text-[10px] font-semibold ${tc.text} shrink-0`}>
                                {s.trend}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                              {s.description}
                            </p>
                            <div className="flex items-center gap-1 mt-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${confidenceDot(s.confidence)}`} />
                              <span className="text-[10px] text-muted-foreground">{s.confidence}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </motion.section>
            )}
          </AnimatePresence>

          {/* ─── INDEX PERFORMANCE PANEL ────────────────────────────── */}
          <AnimatePresence>
            {showIndices && (
              <motion.section
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden mb-6"
              >
                <Card className="border-border">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <TrendingDown className="w-4 h-4 text-blue-400" />
                        Index Performance
                        {indexLoading && (
                          <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
                        )}
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setShowIndices(false)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Live Indian market index data from TradingView. 15-minute cache.
                    </p>
                  </CardHeader>
                  <CardContent>
                    {indexLoading && indexData.length === 0 ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {indexData.map((idx) => {
                          const isUp = idx.changePct >= 0;
                          return (
                            <div
                              key={idx.symbol}
                              className="rounded-lg border border-border p-3 hover:bg-secondary/30 transition-colors"
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs font-medium text-foreground truncate mr-2">
                                  {idx.name}
                                </span>
                                <Badge
                                  variant="secondary"
                                  className={`text-[10px] shrink-0 border-0 font-mono ${
                                    isUp
                                      ? "bg-emerald-500/15 text-emerald-400"
                                      : "bg-red-500/15 text-red-400"
                                  }`}
                                >
                                  {isUp ? "+" : ""}{idx.changePct.toFixed(2)}%
                                </Badge>
                              </div>
                              <div className="flex items-baseline gap-2">
                                <span className="text-sm font-bold font-mono text-foreground">
                                  {idx.lastPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                                </span>
                                <span className={`text-[11px] font-mono ${isUp ? "text-emerald-400" : "text-red-400"}`}>
                                  {isUp ? "+" : ""}{idx.changeAbs.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                                </span>
                              </div>
                              <p className="text-[10px] text-muted-foreground/60 mt-1">
                                {idx.recommendation}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.section>
            )}
          </AnimatePresence>

          {/* ─── SEARCH ───────────────────────────────────────────── */}
          {viewMode !== "search" && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search stocks by name or ticker..."
              className="pl-9 bg-secondary border-border"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          )}

          {/* ─── LOADING ──────────────────────────────────────────── */}
          {loading && viewMode !== "search" && (
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-lg bg-secondary">
                  <Skeleton className="h-4 w-6" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          )}

          {/* ─── ERROR ────────────────────────────────────────────── */}
          {error && !loading && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                <AlertTriangle className="w-8 h-8 text-destructive" />
                <p className="text-sm text-destructive font-medium">{error}</p>
                <Button variant="outline" size="sm" onClick={fetchStocks}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Try Again
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ═══════════════════════════════════════════════════════════
              LIST VIEW (original)
             ═══════════════════════════════════════════════════════════ */}
          {!loading && !error && viewMode === "list" && (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-secondary/80">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-12">#</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("name")}>
                        <span className="flex items-center gap-1">Stock <SortIcon field="name" /></span>
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("close")}>
                        <span className="flex items-center justify-end gap-1">Close <SortIcon field="close" /></span>
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("change")}>
                        <span className="flex items-center justify-end gap-1">Change <SortIcon field="change" /></span>
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("volGainPct")}>
                        <span className="flex items-center justify-end gap-1">Vol Gain <SortIcon field="volGainPct" /></span>
                      </th>
                      <th className="text-center px-4 py-3 font-medium text-muted-foreground w-20">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStocks.map((stock, idx) => (
                      <motion.tr
                        key={stock.ticker}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.02, duration: 0.2 }}
                        className="border-t border-border hover:bg-secondary/50 cursor-pointer transition-colors group"
                        onClick={() => setSelectedStock(stock)}
                      >
                        <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground group-hover:text-primary transition-colors">{stock.name}</div>
                          <div className="text-xs text-muted-foreground">{stock.ticker}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{stock.close.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center gap-0.5 text-emerald-400 font-medium">
                            <ArrowUpRight className="w-3 h-3" />+{stock.change.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/30 font-mono">
                            {stock.volGainPct.toFixed(0)}%
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedStock(stock); }}>
                            <Eye className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                          </Button>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
                {filteredStocks.length === 0 && (
                  <div className="p-12 text-center text-muted-foreground">
                    {stocks.length === 0 ? "No volume shockers found today." : "No stocks match your search."}
                  </div>
                )}
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-2">
                {filteredStocks.map((stock, idx) => (
                  <motion.div key={stock.ticker} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03, duration: 0.2 }}>
                    <Card className="border-border hover:border-primary/30 transition-colors cursor-pointer" onClick={() => setSelectedStock(stock)}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{stock.name}</p>
                            <p className="text-xs text-muted-foreground">{stock.ticker}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono font-medium">{stock.close.toFixed(2)}</p>
                            <span className="inline-flex items-center gap-0.5 text-emerald-400 text-xs font-medium">
                              <ArrowUpRight className="w-3 h-3" />+{stock.change.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">
                            Vol: {stock.volGainPct.toFixed(0)}%
                          </Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Eye className="w-3 h-3" /> View Details
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
                {filteredStocks.length === 0 && (
                  <div className="p-12 text-center text-muted-foreground">
                    {stocks.length === 0 ? "No volume shockers found today." : "No stocks match your search."}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              SUGGESTIONS VIEW (sector-rotation grouped)
             ═══════════════════════════════════════════════════════════ */}
          {!loading && !error && viewMode === "suggestions" && (
            <div className="space-y-6">
              {/* Loading state */}
              {suggestionsLoading && (
                <div className="flex flex-col items-center py-16 gap-4">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Loading sector data for all stocks...</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Fetching sector info from Screener.in for {stocks.length} stocks
                    </p>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!suggestionsLoading && sectorInsights.length === 0 && (
                <Card className="border-border">
                  <CardContent className="p-8 text-center">
                    <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm font-medium mb-1">Sector insights not available</p>
                    <p className="text-xs text-muted-foreground">
                      Click the <strong>Sectors</strong> button above to load sector rotation data first, then switch back here.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Suggestion groups */}
              {!suggestionsLoading && suggestionGroups.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Stocks rearranged by sector rotation strength. Bullish sectors appear first.
                    </p>
                  </div>

                  {suggestionGroups.map((group) => {
                    const tc = group.insight ? trendColor(group.insight.trend) : trendColor("Neutral");
                    const isTop = group.trendKey === "Bullish" || group.trendKey === "Rotating In";
                    const isBottom = group.trendKey === "other";

                    return (
                      <motion.div
                        key={group.trendKey}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <Card className={`border ${isTop ? "border-emerald-500/20" : isBottom ? "border-red-500/20" : "border-border"}`}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                {isTop && <Star className="w-4 h-4 text-emerald-400" />}
                                {isBottom && <AlertTriangle className="w-4 h-4 text-red-400" />}
                                {group.trendLabel}
                                <Badge variant="secondary" className={`text-[10px] ${tc.bg} ${tc.text}`}>
                                  {group.stocks.length} stock{group.stocks.length !== 1 ? "s" : ""}
                                </Badge>
                              </CardTitle>
                              {group.insight && (
                                <Badge variant="secondary" className={`text-[10px] ${tc.bg} ${tc.text} ${tc.border} border`}>
                                  {group.insight.trend}
                                </Badge>
                              )}
                            </div>
                            {group.insight && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {group.insight.description}
                              </p>
                            )}
                          </CardHeader>
                          <CardContent className="pt-0">
                            <div className="space-y-1.5">
                              {group.stocks.map((stock, idx) => (
                                <div
                                  key={stock.ticker}
                                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors group"
                                  onClick={() => setSelectedStock(stock)}
                                >
                                  <span className="text-xs text-muted-foreground w-5 text-center shrink-0">
                                    {idx + 1}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                                      {stock.name}
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground">{stock.ticker}</span>
                                      {stock.matchedSector && (
                                        <>
                                          <span className="text-muted-foreground/40">&middot;</span>
                                          <span className="text-[10px] text-muted-foreground">{stock.matchedSector}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-sm font-mono font-medium">{stock.close.toFixed(2)}</p>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-emerald-400 font-medium">+{stock.change.toFixed(2)}%</span>
                                      <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px] font-mono px-1.5">
                                        {stock.volGainPct.toFixed(0)}%
                                      </Badge>
                                    </div>
                                  </div>
                                  <Eye className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}

                  {filteredStocks.length === 0 && (
                    <div className="p-12 text-center text-muted-foreground">
                      {stocks.length === 0
                        ? "No volume shockers found today."
                        : "No stocks match your search."}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              SEARCH VIEW (universal stock search from Screener.in)
             ═══════════════════════════════════════════════════════════ */}
          {viewMode === "search" && (
            <div>
              {/* Search Input */}
              <Card className="border-border mb-4">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold">Search Any Stock on Screener.in</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Type a company name or stock ticker (e.g., Reliance, TCS, HDFCBANK) to look up
                    complete financial data from Screener.in. Covers all NSE &amp; BSE listed companies.
                  </p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by company name or ticker..."
                      className="pl-9 pr-20 bg-secondary border-border text-base"
                      value={searchQuery}
                      onChange={(e) => handleSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && searchQuery.trim().length >= 2) {
                          performSearch(searchQuery);
                        }
                      }}
                      autoFocus
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      {searchLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                      {searchQuery && (
                        <button
                          onClick={() => { setSearchQuery(""); setSearchResults([]); setSearchError(""); }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Search Loading */}
              {searchLoading && (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
                      <Skeleton className="h-10 w-10 rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/5" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                      <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              )}

              {/* Search Error */}
              {searchError && !searchLoading && (
                <Card className="border-border">
                  <CardContent className="p-8 flex flex-col items-center text-center gap-2">
                    <Search className="w-8 h-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{searchError}</p>
                    <p className="text-xs text-muted-foreground/60">
                      Try different keywords, the full company name, or the NSE/BSE ticker code.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Search Results */}
              {!searchLoading && searchResults.length > 0 && (
                <Card className="border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Search className="w-3.5 h-3.5" />
                      {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found
                      {searchQuery && <span className="text-foreground font-semibold">for "{searchQuery}"</span>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1">
                      {searchResults.map((result, idx) => (
                        <motion.div
                          key={result.ticker}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.15, delay: idx * 0.03 }}
                          className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/80 cursor-pointer transition-colors group"
                          onClick={() => handleSearchSelect(result)}
                        >
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-primary">
                              {result.ticker.slice(0, 2)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                              {result.name}
                            </p>
                            <span className="text-xs text-muted-foreground font-mono">{result.ticker}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={`https://www.screener.in/company/${result.ticker}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                                  </Button>
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>Open on Screener.in</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={tradingViewUrl(result.ticker)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <LineChart className="w-3.5 h-3.5 text-muted-foreground" />
                                  </Button>
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>Open on TradingView</TooltipContent>
                            </Tooltip>
                            <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Empty State */}
              {!searchLoading && !searchError && searchQuery.length < 2 && (
                <Card className="border-border">
                  <CardContent className="p-12 flex flex-col items-center text-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                      <Globe className="w-7 h-7 text-primary" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">Search Any Indian Stock</h3>
                    <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                      Look up complete financial data for any company listed on NSE or BSE.
                      Search by company name (e.g., &quot;Reliance Industries&quot;) or ticker
                      (e.g., &quot;TCS&quot;, &quot;HDFCBANK&quot;).
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {["RELIANCE", "TCS", "HDFCBANK", "INFY", "ITC", "SBIN"].map((t) => (
                        <button
                          key={t}
                          onClick={() => handleSearchInput(t)}
                          className="px-3 py-1 rounded-full bg-secondary text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* ─── HISTORY VIEW ─────────────────────────────────────── */}
          {viewMode === "history" && (
            <div>
              {/* Date list */}
              {!selectedHistoryDate && (
                <div>
                  {historyDates.length === 0 ? (
                    <Card className="border-border">
                      <CardContent className="p-12 flex flex-col items-center text-center gap-3">
                        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                          <History className="w-7 h-7 text-primary" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">Daily History</h3>
                        <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                          Every day&apos;s volume shocker stocks are automatically saved here.
                          Browse past days to see which stocks had volume spikes.
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          Today&apos;s data will appear after the first refresh.
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                      {historyDates.map((h) => (
                        <button
                          key={h.date}
                          onClick={() => fetchHistoryStocks(h.date)}
                          className="rounded-lg border border-border p-3 text-left hover:bg-secondary/50 hover:border-primary/20 transition-colors group"
                        >
                          <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                            {formatDate(h.date)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {h.stockCount} stock{h.stockCount !== 1 ? "s" : ""}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Stocks for selected date */}
              {selectedHistoryDate && (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedHistoryDate(null); setHistoryStocks([]); }}>
                      <ArrowLeft className="w-4 h-4 mr-1" />
                      Back
                    </Button>
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">{formatDate(selectedHistoryDate)}</h2>
                      <p className="text-xs text-muted-foreground">{historyStocks.length} volume shockers</p>
                    </div>
                  </div>

                  {historyLoading ? (
                    <div className="flex flex-col items-center py-16 gap-4">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Loading historical data...</p>
                    </div>
                  ) : historyStocks.length > 0 ? (
                    <>
                      {/* Desktop Table */}
                      <div className="hidden md:block rounded-xl border border-border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-secondary/80">
                              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-12">#</th>
                              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stock</th>
                              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Close</th>
                              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Change</th>
                              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Vol Gain</th>
                              <th className="text-center px-4 py-3 font-medium text-muted-foreground w-20">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyStocks.map((stock, idx) => (
                              <tr
                                key={stock.ticker}
                                className="border-t border-border hover:bg-secondary/50 cursor-pointer transition-colors group"
                                onClick={() => setSelectedStock(stock)}
                              >
                                <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                                <td className="px-4 py-3">
                                  <div className="font-medium text-foreground group-hover:text-primary transition-colors">{stock.name}</div>
                                  <div className="text-xs text-muted-foreground">{stock.ticker}</div>
                                </td>
                                <td className="px-4 py-3 text-right font-mono">{stock.close.toFixed(2)}</td>
                                <td className="px-4 py-3 text-right">
                                  <span className="inline-flex items-center gap-0.5 text-emerald-400 font-medium">
                                    <ArrowUpRight className="w-3 h-3" />+{stock.change.toFixed(2)}%
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/30 font-mono">
                                    {stock.volGainPct.toFixed(0)}%
                                  </Badge>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedStock(stock); }}>
                                    <Eye className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Cards */}
                      <div className="md:hidden space-y-2">
                        {historyStocks.map((stock) => (
                          <Card key={stock.ticker} className="border-border hover:border-primary/30 transition-colors cursor-pointer" onClick={() => setSelectedStock(stock)}>
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground truncate">{stock.name}</p>
                                  <p className="text-xs text-muted-foreground">{stock.ticker}</p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="font-mono font-medium">{stock.close.toFixed(2)}</p>
                                  <span className="inline-flex items-center gap-0.5 text-emerald-400 text-xs font-medium">
                                    <ArrowUpRight className="w-3 h-3" />+{stock.change.toFixed(2)}%
                                  </span>
                                </div>
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px] font-mono">
                                  Vol {stock.volGainPct.toFixed(0)}%
                                </Badge>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Card className="border-border">
                      <CardContent className="p-12 text-center text-muted-foreground text-sm">
                        No stocks found for this date.
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </div>
          )}

        </main>

        {/* ─── STOCK DETAIL PANEL ────────────────────────────────── */}
        <AnimatePresence>
          {selectedStock && (
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
              className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-background border-l border-border shadow-2xl flex flex-col"
            >
              {/* Panel Header */}
              <div className="shrink-0 bg-background/90 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setSelectedStock(null)}>
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  {/* TradingView Chart Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href={tradingViewUrl(selectedStock.ticker)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline" size="sm">
                          <LineChart className="w-4 h-4 mr-1" />
                          <span className="hidden sm:inline">Chart</span>
                        </Button>
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>Open chart on TradingView</TooltipContent>
                  </Tooltip>
                  <a href={`https://www.screener.in/company/${selectedStock.ticker}/`} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm">
                      <ExternalLink className="w-4 h-4 mr-1" />
                      <span className="hidden sm:inline">Screener.in</span>
                    </Button>
                  </a>
                </div>
              </div>

              {detailLoading && (
                <div className="p-4 space-y-4">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              )}

              {detailError && !detailLoading && (
                <div className="p-6 text-center">
                  <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-2" />
                  <p className="text-sm text-destructive mb-3">{detailError}</p>
                  <a href={`https://www.screener.in/company/${selectedStock.ticker}/`} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                    View directly on Screener.in &rarr;
                  </a>
                </div>
              )}

              {stockDetail && !detailLoading && !detailError && (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  {/* ═══ SCROLLABLE CONTENT ═══ */}
                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 scrollbar-none">

                    {/* ──── SCREENER-STYLE HEADER ──── */}
                    <div className="pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="text-lg font-bold leading-tight">{stockDetail.name}</h2>
                          {/* Sector / Industry breadcrumbs like screener */}
                          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
                            {stockDetail.sector && (
                              <>
                                <Activity className="w-3 h-3 shrink-0" />
                                <span className="hover:text-foreground cursor-default">{stockDetail.sector}</span>
                              </>
                            )}
                            {stockDetail.sector && stockDetail.industry && (
                              <span className="opacity-40">&rsaquo;</span>
                            )}
                            {stockDetail.industry && (
                              <span className="hover:text-foreground cursor-default">{stockDetail.industry}</span>
                            )}
                          </div>
                          {/* BSE / NSE links */}
                          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px]">
                            {stockDetail.bseCode && (
                              <a
                                href={`https://www.bseindia.com/stock-share-price/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                              >
                                <ExternalLink className="w-2.5 h-2.5" />
                                BSE: {stockDetail.bseCode}
                              </a>
                            )}
                            <span className="text-muted-foreground/60 font-medium uppercase tracking-wide">
                              NSE: {selectedStock.ticker}
                            </span>
                          </div>
                        </div>
                        {/* Price badge (for Volume Shockers) */}
                        {!isSearchedStock && selectedStock.close > 0 && (
                          <div className="text-right shrink-0">
                            <p className="text-xl font-bold font-mono leading-none">
                              <span className="text-xs font-normal text-muted-foreground mr-0.5">&#8377;</span>
                              {selectedStock.close.toFixed(2)}
                            </p>
                            <p className="text-xs text-emerald-400 font-medium mt-0.5">
                              +{selectedStock.change.toFixed(2)}%
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Sector Outlook strip */}
                      {selectedSectorSuggestion && (
                        <div className={`mt-3 rounded-lg border px-3 py-2 ${trendColor(selectedSectorSuggestion.trend).bg} ${trendColor(selectedSectorSuggestion.trend).border}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${confidenceDot(selectedSectorSuggestion.confidence)}`} />
                              <span className="text-[11px] font-medium text-foreground truncate">
                                {selectedSectorSuggestion.sector}
                              </span>
                              <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                                &mdash; {selectedSectorSuggestion.description}
                              </span>
                            </div>
                            <Badge variant="secondary" className={`text-[10px] shrink-0 ml-2 ${trendColor(selectedSectorSuggestion.trend).bg} ${trendColor(selectedSectorSuggestion.trend).text} border-0`}>
                              {selectedSectorSuggestion.trend}
                            </Badge>
                          </div>
                        </div>
                      )}

                      {/* Volume shocker badges */}
                      {!isSearchedStock && selectedStock.volGainPct > 0 && (
                        <div className="flex items-center gap-2 mt-2">
                          <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">
                            <Zap className="w-3 h-3 mr-1" />
                            Vol {selectedStock.volGainPct.toFixed(0)}%
                          </Badge>
                          {isSearchedStock && (
                            <Badge variant="secondary" className="bg-primary/15 text-primary border-primary/30 text-[10px]">
                              <Globe className="w-3 h-3 mr-1" />
                              Screener.in
                            </Badge>
                          )}
                        </div>
                      )}

                      {/* Index memberships */}
                      {stockDetail.indices && stockDetail.indices.length > 0 && (
                        <div className="mt-2.5">
                          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Part of</span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {stockDetail.indices.map((idx) => (
                              <Badge key={idx} variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] font-medium">
                                {idx}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ──── TOP RATIOS (screener-style flex list) ──── */}
                    {Object.keys(stockDetail.metrics).length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Key Ratios
                        </h3>
                        <div className="rounded-lg border border-border overflow-hidden">
                          {Object.entries(stockDetail.metrics).map(([key, val], idx) => (
                            <div
                              key={key}
                              className={`flex items-center justify-between px-3 py-2 ${
                                idx % 2 === 0 ? "bg-secondary/40" : "bg-transparent"
                              }`}
                            >
                              <span className="text-xs text-muted-foreground">{key}</span>
                              <span className="text-xs font-semibold font-mono text-foreground">{val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ──── ABOUT (screener-style) ──── */}
                    {stockDetail.about && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                          About
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">{stockDetail.about}</p>
                      </div>
                    )}

                    {/* ──── PROS & CONS (side by side like screener) ──── */}
                    {((stockDetail.pros && stockDetail.pros.length > 0) || (stockDetail.cons && stockDetail.cons.length > 0)) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {stockDetail.pros && stockDetail.pros.length > 0 && (
                          <div>
                            <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">
                              <CheckCircle className="w-3 h-3 inline mr-1 -mt-0.5" />Pros
                            </h3>
                            <ul className="space-y-1">
                              {stockDetail.pros.map((pro, i) => (
                                <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                                  <span className="text-emerald-500 mt-0.5 shrink-0">&bull;</span>
                                  <span>{pro}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {stockDetail.cons && stockDetail.cons.length > 0 && (
                          <div>
                            <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1.5">
                              <XCircle className="w-3 h-3 inline mr-1 -mt-0.5" />Cons
                            </h3>
                            <ul className="space-y-1">
                              {stockDetail.cons.map((con, i) => (
                                <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                                  <span className="text-red-500 mt-0.5 shrink-0">&bull;</span>
                                  <span>{con}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ──── QUARTERLY RESULTS (screener-style table) ──── */}
                    {stockDetail.quarters.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Quarterly Results
                          <span className="normal-case tracking-normal font-normal text-muted-foreground/60 ml-1">
                            (Standalone, Rs. Cr.)
                          </span>
                        </h3>
                        <div className="rounded-lg border border-border overflow-x-auto">
                          <ScreenerTable
                            headers={["", ...stockDetail.quarters.map((q) => q.label)]}
                            fiscalYearEnds={stockDetail.quarters
                              .map((q, i) => (/Mar/i.test(q.label) ? i : -1))
                              .filter((i) => i >= 0)}
                          >
                            <ScreenerRow label="Sales" values={stockDetail.quarters.map((q) => q.sales)} />
                            <ScreenerRow label="Net Profit" values={stockDetail.quarters.map((q) => q.netProfit)} />
                            {stockDetail.quarters[0]?.opm && stockDetail.quarters[0].opm !== "-" && (
                              <ScreenerRow label="OPM %" values={stockDetail.quarters.map((q) => q.opm)} />
                            )}
                          </ScreenerTable>
                        </div>
                      </div>
                    )}

                    {/* ──── BALANCE SHEET ──── */}
                    {stockDetail.balanceSheet && stockDetail.balanceSheet.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Balance Sheet
                          <span className="normal-case tracking-normal font-normal text-muted-foreground/60 ml-1">
                            (Rs. Cr.)
                          </span>
                        </h3>
                        <div className="rounded-lg border border-border overflow-x-auto">
                          <ScreenerTable
                            headers={["", ...stockDetail.balanceSheet.map((bs) => bs.label)]}
                            fiscalYearEnds={stockDetail.balanceSheet
                              .map((bs, i) => (/Mar/i.test(bs.label) ? i : -1))
                              .filter((i) => i >= 0)}
                          >
                            <ScreenerRow label="Reserves" values={stockDetail.balanceSheet.map((bs) => bs.reserves)} />
                            <ScreenerRow label="Borrowings" values={stockDetail.balanceSheet.map((bs) => bs.borrowing)} />
                            <ScreenerRow label="Other Liab." values={stockDetail.balanceSheet.map((bs) => bs.otherLiab)} />
                            <ScreenerRow label="Total Liab." values={stockDetail.balanceSheet.map((bs) => bs.totalLiab)} />
                            <ScreenerRow label="Fixed Assets" values={stockDetail.balanceSheet.map((bs) => bs.fixedAssets)} />
                            <ScreenerRow label="CWIP" values={stockDetail.balanceSheet.map((bs) => bs.cwip)} />
                            <ScreenerRow label="Total Assets" values={stockDetail.balanceSheet.map((bs) => bs.totalAssets)} />
                          </ScreenerTable>
                        </div>
                      </div>
                    )}

                    {/* ──── CASH FLOW ──── */}
                    {stockDetail.cashFlow && stockDetail.cashFlow.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Cash Flow
                          <span className="normal-case tracking-normal font-normal text-muted-foreground/60 ml-1">
                            (Rs. Cr.)
                          </span>
                        </h3>
                        <div className="rounded-lg border border-border overflow-x-auto">
                          <ScreenerTable
                            headers={["", ...stockDetail.cashFlow.map((cf) => cf.label)]}
                            fiscalYearEnds={stockDetail.cashFlow
                              .map((cf, i) => (/Mar/i.test(cf.label) ? i : -1))
                              .filter((i) => i >= 0)}
                          >
                            <ScreenerRow label="Operating CF" values={stockDetail.cashFlow.map((cf) => cf.operatingCF)} />
                            <ScreenerRow label="Investing CF" values={stockDetail.cashFlow.map((cf) => cf.investingCF)} />
                            <ScreenerRow label="Financing CF" values={stockDetail.cashFlow.map((cf) => cf.financingCF)} />
                          </ScreenerTable>
                        </div>
                      </div>
                    )}

                    {/* ──── SHAREHOLDING PATTERN ──── */}
                    {stockDetail.shareholding && stockDetail.shareholding.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Shareholding Pattern
                        </h3>
                        <div className="rounded-lg border border-border overflow-hidden">
                          {stockDetail.shareholding.map((sh) => (
                            <div key={sh.category}>
                              <div className="px-3 py-1.5 bg-primary/10 border-b border-border">
                                <span className="text-[10px] font-semibold text-primary">{sh.category}</span>
                              </div>
                              {sh.values.map((v, vi) => (
                                <div
                                  key={v.label}
                                  className={`flex items-center justify-between px-3 py-1.5 ${
                                    vi % 2 === 0 ? "bg-secondary/40" : ""
                                  }`}
                                >
                                  <span className="text-[11px] text-muted-foreground truncate mr-2">{v.label}</span>
                                  <span className="text-[11px] font-mono font-medium shrink-0">{v.value}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ──── ANNUAL RESULTS ──── */}
                    {stockDetail.annualResults && stockDetail.annualResults.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Annual Results
                          <span className="normal-case tracking-normal font-normal text-muted-foreground/60 ml-1">
                            (Rs. Cr.)
                          </span>
                        </h3>
                        <div className="rounded-lg border border-border overflow-x-auto">
                          <ScreenerTable
                            headers={["", ...stockDetail.annualResults.map((ar) => ar.label)]}
                            fiscalYearEnds={stockDetail.annualResults
                              .map((ar, i) => (/Mar/i.test(ar.label) ? i : -1))
                              .filter((i) => i >= 0)}
                          >
                            <ScreenerRow label="Sales" values={stockDetail.annualResults.map((ar) => ar.sales)} />
                            <ScreenerRow label="Net Profit" values={stockDetail.annualResults.map((ar) => ar.netProfit)} />
                          </ScreenerTable>
                        </div>
                      </div>
                    )}

                    {/* ──── PEER COMPANIES (clickable, like screener) ──── */}
                    {stockDetail.peers.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Peer Companies
                        </h3>
                        <div className="rounded-lg border border-border overflow-hidden">
                          {stockDetail.peers.map((peer, idx) => (
                            <button
                              key={peer.ticker}
                              disabled={peerLoading}
                              className={`w-full text-left flex items-center justify-between px-3 py-2.5 transition-colors hover:bg-primary/5 disabled:opacity-50 ${
                                idx % 2 === 0 ? "bg-secondary/30" : ""
                              }`}
                              onClick={() => handlePeerClick(peer.name, peer.ticker)}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[10px] text-muted-foreground w-4 text-center shrink-0">{idx + 1}</span>
                                {peerLoading ? (
                                  <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />
                                ) : null}
                                <span className="text-xs font-medium text-foreground truncate hover:text-primary transition-colors">
                                  {peer.name}
                                </span>
                                <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">
                                  {peer.ticker}
                                </span>
                              </div>
                              <ArrowUpRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
                          Click a peer to view its financial data
                        </p>
                      </div>
                    )}

                  </div>

                  {/* ═══ STICKY FOOTER with action buttons ═══ */}
                  <div className="border-t border-border px-4 py-3 flex items-center gap-2 bg-background/95 backdrop-blur-sm">
                    <a
                      href={tradingViewUrl(selectedStock.ticker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button className="w-full" variant="outline" size="sm">
                        <LineChart className="w-3.5 h-3.5 mr-1.5" />
                        Chart
                      </Button>
                    </a>
                    <a
                      href={`https://www.screener.in/company/${selectedStock.ticker}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button className="w-full" variant="outline" size="sm">
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        Screener.in
                      </Button>
                    </a>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── BACKDROP ───────────────────────────────────────────── */}
        <AnimatePresence>
          {selectedStock && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 md:block hidden"
              onClick={() => setSelectedStock(null)}
            />
          )}
        </AnimatePresence>

        {/* ─── SECTOR DETAIL MODAL ─────────────────────────────── */}
        <AnimatePresence>
          {selectedSectorInsight && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/60"
                onClick={() => setSelectedSectorInsight(null)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ type: "tween", duration: 0.2 }}
                className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-lg z-50 bg-background border border-border rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
              >
                {/* Modal Header */}
                <div className="shrink-0 border-b border-border px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2.5 h-2.5 rounded-full ${confidenceDot(selectedSectorInsight.confidence)}`} />
                    <h2 className="text-base font-semibold text-foreground truncate">{selectedSectorInsight.sector}</h2>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={`border-0 font-semibold ${trendColor(selectedSectorInsight.trend).text} ${trendColor(selectedSectorInsight.trend).bg}`}>
                      {selectedSectorInsight.trend}
                    </Badge>
                    <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setSelectedSectorInsight(null)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Modal Body */}
                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                  {/* Analysis */}
                  <div>
                    <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Analysis</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{selectedSectorInsight.description}</p>
                  </div>

                  {/* Confidence */}
                  <div>
                    <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Confidence Level</h3>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${confidenceDot(selectedSectorInsight.confidence)}`} />
                      <span className="text-sm text-muted-foreground">{selectedSectorInsight.confidence}</span>
                    </div>
                    <p className="text-xs text-muted-foreground/60 mt-1.5">
                      {selectedSectorInsight.confidence === "High" && "Based on strong macro indicators, consistent data trends, and multiple confirming signals."}
                      {selectedSectorInsight.confidence === "Medium" && "Based on mixed signals with some supporting data. Monitor for confirmation or reversal."}
                      {selectedSectorInsight.confidence === "Low" && "Limited data or high uncertainty. Treat as directional guidance only."}
                    </p>
                  </div>

                  {/* Trend Interpretation */}
                  <div>
                    <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">What This Means</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {selectedSectorInsight.trend === "Bullish" && "This sector has strong momentum and favorable conditions. Stocks in this sector may continue to perform well. Look for volume shockers in this sector as potential opportunities."}
                      {selectedSectorInsight.trend === "Bearish" && "This sector faces headwinds and negative conditions. Exercise caution with stocks in this sector. Volume spikes here may indicate distribution rather than accumulation."}
                      {selectedSectorInsight.trend === "Neutral" && "This sector is in a consolidation phase with no strong directional bias. Wait for clear signals before taking positions. Volume breakouts could signal the next move."}
                      {selectedSectorInsight.trend === "Rotating In" && "Institutional money is starting to flow into this sector. Early-stage rotation often precedes sustained rallies. Watch for increasing volume and price breakout patterns."}
                      {selectedSectorInsight.trend === "Rotating Out" && "Institutional money is exiting this sector. This often leads to prolonged underperformance. Reduce exposure to stocks in this sector."}
                    </p>
                  </div>

                  {/* Stocks from this sector */}
                  <div>
                    <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Volume Shockers in This Sector</h3>
                    {filteredStocks.filter(st => {
                      const info = sectorMap.get(st.ticker);
                      return info?.sector === selectedSectorInsight.sector;
                    }).length > 0 ? (
                      <div className="space-y-1.5">
                        {filteredStocks.filter(st => {
                          const info = sectorMap.get(st.ticker);
                          return info?.sector === selectedSectorInsight.sector;
                        }).map(st => (
                          <button
                            key={st.ticker}
                            onClick={() => { setSelectedSectorInsight(null); setSelectedStock(st); }}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border hover:bg-secondary/50 transition-colors text-left"
                          >
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-foreground truncate block">{st.name}</span>
                              <span className="text-xs text-muted-foreground">{st.ticker}</span>
                            </div>
                            <div className="text-right shrink-0 ml-3">
                              <div className="text-sm font-mono text-foreground">₹{st.close.toLocaleString("en-IN")}</div>
                              <span className={`text-xs font-mono ${st.isPositive ? "text-emerald-400" : "text-red-400"}`}>
                                {st.isPositive ? "+" : ""}{st.change.toFixed(2)}%
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground/60">
                        {sectorMap.size > 0 ? "No volume shockers found in this sector today." : "Load sector data first to see matching stocks."}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

      </div>
    </TooltipProvider>
  );
}