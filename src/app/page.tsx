"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  Shield,
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
  sector?: string;
  industry?: string;
  about?: string;
  metrics: Record<string, string>;
  quarters: {
    label: string;
    sales: string;
    netProfit: string;
    opm: string;
  }[];
  peers: string[];
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

type ViewMode = "list" | "suggestions" | "search";

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

// ─── Main Component ──────────────────────────────────────────────────
export default function Home() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [filteredStocks, setFilteredStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"volGainPct" | "change" | "close" | "name">("volGainPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [stockDetail, setStockDetail] = useState<StockDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [sectorInsights, setSectorInsights] = useState<SectorInsight[]>([]);
  const [sectorLoading, setSectorLoading] = useState(true);
  const [showSectors, setShowSectors] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [stats, setStats] = useState({ total: 0, filtered: 0 });

  // ─── Suggestions state ───────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("list");
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
  };

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
                <h1 className="text-lg font-bold tracking-tight">StockPulse</h1>
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
                onClick={() => { setShowSectors(!showSectors); if (!showSectors) fetchSectors(); }}
              >
                <Activity className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Sectors</span>
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
            </div>
          </div>
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
                          <div key={s.sector} className={`rounded-lg border p-3 ${tc.bg} ${tc.border}`}>
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

          {/* ─── STATS BAR ────────────────────────────────────────── */}
          {!error && stocks.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-5">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">
                  {stats.filtered} Stocks
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Positive &amp; Vol &gt; 180%
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border">
                <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {stats.total} Total on Chartink
                </span>
              </div>
            </div>
          )}

          {/* ─── VIEW TABS ────────────────────────────────────────── */}
          {(stocks.length > 0 || viewMode === "search") && (
            <div className="flex items-center gap-1 mb-5 p-1 rounded-lg bg-secondary w-fit">
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
            </div>
          )}

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
                        <td className="px-4 py-3 text-muted-foreground text-xs">{stock.sr}</td>
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

          {/* ─── DATA SOURCE FOOTER ───────────────────────────────── */}
          {!loading && stocks.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Info className="w-3 h-3" />
                Data sourced from{" "}
                <a href="https://chartink.com/eodscanner/Volume-Shockers.html" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Chartink.com
                </a>{" "}
                &middot; Refreshes daily at 7:00 PM IST
              </span>
              <span className="hidden sm:inline">&middot;</span>
              <span className="flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Stock details from{" "}
                <a href="https://www.screener.in/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Screener.in
                </a>
              </span>
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
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-background border-l border-border shadow-2xl overflow-y-auto"
            >
              {/* Panel Header */}
              <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center justify-between">
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
                <div className="p-4 space-y-5">
                  {/* Stock Header */}
                  <div>
                    <h2 className="text-xl font-bold">{stockDetail.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedStock.ticker}
                      {stockDetail.sector && <span className="ml-2">&middot; {stockDetail.sector}</span>}
                      {stockDetail.industry && <span className="ml-2 text-xs">({stockDetail.industry})</span>}
                    </p>
                    {!isSearchedStock && (
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-2xl font-bold font-mono">{selectedStock.close.toFixed(2)}</span>
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                          <TrendingUp className="w-3 h-3 mr-1" />
                          +{selectedStock.change.toFixed(2)}%
                        </Badge>
                        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">
                          <Zap className="w-3 h-3 mr-1" />
                          Vol: {selectedStock.volGainPct.toFixed(0)}%
                        </Badge>
                      </div>
                    )}
                    {isSearchedStock && (
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary" className="bg-primary/15 text-primary border-primary/30">
                          <Globe className="w-3 h-3 mr-1" />
                          Screener.in Data
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Sector Suggestion */}
                  {selectedSectorSuggestion && (
                    <Card className={`border ${trendColor(selectedSectorSuggestion.trend).border}`}>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Activity className="w-3.5 h-3.5 text-primary" />
                          <span className="text-xs font-semibold text-foreground">
                            Sector Outlook: {selectedSectorSuggestion.sector}
                          </span>
                          <Badge variant="secondary" className={`text-[10px] ${trendColor(selectedSectorSuggestion.trend).bg} ${trendColor(selectedSectorSuggestion.trend).text}`}>
                            {selectedSectorSuggestion.trend}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{selectedSectorSuggestion.description}</p>
                        <div className="flex items-center gap-1 mt-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${confidenceDot(selectedSectorSuggestion.confidence)}`} />
                          <span className="text-[10px] text-muted-foreground">Confidence: {selectedSectorSuggestion.confidence}</span>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* About */}
                  {stockDetail.about && (
                    <div>
                      <h3 className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-primary" /> About
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">{stockDetail.about}</p>
                    </div>
                  )}

                  <Separator />

                  {/* Key Metrics */}
                  {Object.keys(stockDetail.metrics).length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-primary" /> Key Ratios
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(stockDetail.metrics).map(([key, val]) => (
                          <div key={key} className="rounded-lg bg-secondary p-2.5">
                            <p className="text-[10px] text-muted-foreground truncate">{key}</p>
                            <p className="text-sm font-semibold font-mono mt-0.5">{val}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quarterly Results */}
                  {stockDetail.quarters.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-primary" /> Recent Quarterly Results
                      </h3>
                      <div className="rounded-lg border border-border overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-secondary">
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Metric</th>
                              {stockDetail.quarters.map((q) => (
                                <th key={q.label} className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                                  {q.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t border-border">
                              <td className="px-3 py-2 text-muted-foreground">Sales</td>
                              {stockDetail.quarters.map((q) => (
                                <td key={q.label} className="text-right px-3 py-2 font-mono">{q.sales}</td>
                              ))}
                            </tr>
                            <tr className="border-t border-border">
                              <td className="px-3 py-2 text-muted-foreground">Net Profit</td>
                              {stockDetail.quarters.map((q) => (
                                <td key={q.label} className="text-right px-3 py-2 font-mono">{q.netProfit}</td>
                              ))}
                            </tr>
                            {stockDetail.quarters[0]?.opm && stockDetail.quarters[0].opm !== "-" && (
                              <tr className="border-t border-border">
                                <td className="px-3 py-2 text-muted-foreground">OPM</td>
                                {stockDetail.quarters.map((q) => (
                                  <td key={q.label} className="text-right px-3 py-2 font-mono">{q.opm}</td>
                                ))}
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Peers */}
                  {stockDetail.peers.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Peer Companies</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {stockDetail.peers.map((peer) => (
                          <Badge key={peer} variant="secondary" className="text-xs">{peer}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pros & Cons */}
                  {(stockDetail.pros && stockDetail.pros.length > 0) && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Pros
                      </h3>
                      <ul className="space-y-1.5">
                        {stockDetail.pros.map((pro, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <CheckCircle className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                            <span>{pro}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(stockDetail.cons && stockDetail.cons.length > 0) && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-red-400" /> Cons
                      </h3>
                      <ul className="space-y-1.5">
                        {stockDetail.cons.map((con, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                            <span>{con}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Balance Sheet Summary */}
                  {stockDetail.balanceSheet && stockDetail.balanceSheet.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5 text-primary" /> Balance Sheet (in Cr)
                      </h3>
                      <div className="rounded-lg border border-border overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-secondary">
                              <th className="text-left px-2 py-2 font-medium text-muted-foreground">Item</th>
                              {stockDetail.balanceSheet.map((bs) => (
                                <th key={bs.label} className="text-right px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">
                                  {bs.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { key: "reserves", label: "Reserves" },
                              { key: "borrowing", label: "Borrowings" },
                              { key: "totalLiab", label: "Total Liab." },
                              { key: "fixedAssets", label: "Fixed Assets" },
                              { key: "totalAssets", label: "Total Assets" },
                            ].map((row) => (
                              <tr key={row.key} className="border-t border-border">
                                <td className="px-2 py-1.5 text-muted-foreground">{row.label}</td>
                                {stockDetail.balanceSheet!.map((bs) => (
                                  <td key={bs.label} className="text-right px-2 py-1.5 font-mono">
                                    {bs[row.key as keyof typeof bs]}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Cash Flow */}
                  {stockDetail.cashFlow && stockDetail.cashFlow.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5 text-primary" /> Cash Flow (in Cr)
                      </h3>
                      <div className="rounded-lg border border-border overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-secondary">
                              <th className="text-left px-2 py-2 font-medium text-muted-foreground">Type</th>
                              {stockDetail.cashFlow.map((cf) => (
                                <th key={cf.label} className="text-right px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">
                                  {cf.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t border-border">
                              <td className="px-2 py-1.5 text-muted-foreground">Operating</td>
                              {stockDetail.cashFlow.map((cf) => (
                                <td key={cf.label} className="text-right px-2 py-1.5 font-mono">{cf.operatingCF}</td>
                              ))}
                            </tr>
                            <tr className="border-t border-border">
                              <td className="px-2 py-1.5 text-muted-foreground">Investing</td>
                              {stockDetail.cashFlow.map((cf) => (
                                <td key={cf.label} className="text-right px-2 py-1.5 font-mono">{cf.investingCF}</td>
                              ))}
                            </tr>
                            <tr className="border-t border-border">
                              <td className="px-2 py-1.5 text-muted-foreground">Financing</td>
                              {stockDetail.cashFlow.map((cf) => (
                                <td key={cf.label} className="text-right px-2 py-1.5 font-mono">{cf.financingCF}</td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Shareholding Pattern */}
                  {stockDetail.shareholding && stockDetail.shareholding.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-primary" /> Shareholding Pattern
                      </h3>
                      {stockDetail.shareholding.map((sh) => (
                        <div key={sh.category} className="mb-3 last:mb-0">
                          <p className="text-[10px] text-muted-foreground mb-1 font-medium">{sh.category}</p>
                          <div className="space-y-1">
                            {sh.values.map((v) => (
                              <div key={v.label} className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground truncate mr-2">{v.label}</span>
                                <span className="font-mono font-medium shrink-0">{v.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Annual Results */}
                  {stockDetail.annualResults && stockDetail.annualResults.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-primary" /> Annual Results
                      </h3>
                      <div className="rounded-lg border border-border overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-secondary">
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Metric</th>
                              {stockDetail.annualResults.map((ar) => (
                                <th key={ar.label} className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                                  {ar.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t border-border">
                              <td className="px-3 py-2 text-muted-foreground">Sales</td>
                              {stockDetail.annualResults.map((ar) => (
                                <td key={ar.label} className="text-right px-3 py-2 font-mono">{ar.sales}</td>
                              ))}
                            </tr>
                            <tr className="border-t border-border">
                              <td className="px-3 py-2 text-muted-foreground">Net Profit</td>
                              {stockDetail.annualResults.map((ar) => (
                                <td key={ar.label} className="text-right px-3 py-2 font-mono">{ar.netProfit}</td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <Separator />
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={tradingViewUrl(selectedStock.ticker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <Button className="w-full" variant="outline">
                        <LineChart className="w-4 h-4 mr-2" />
                        TradingView Chart
                      </Button>
                    </a>
                    <a
                      href={`https://www.screener.in/company/${selectedStock.ticker}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <Button className="w-full" variant="outline">
                        <ExternalLink className="w-4 h-4 mr-2" />
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
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:block hidden"
              onClick={() => setSelectedStock(null)}
            />
          )}
        </AnimatePresence>

        {/* ─── FOOTER ─────────────────────────────────────────────── */}
        <footer className="mt-auto border-t border-border py-4 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>
              StockPulse &middot; Data from Chartink &amp; Screener.in &middot;
              For informational purposes only. Not financial advice.
            </p>
            <p className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              Always do your own research before investing.
            </p>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}