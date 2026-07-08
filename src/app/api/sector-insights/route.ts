import { NextResponse } from "next/server";

interface SectorInsight {
  sector: string;
  trend: "Bullish" | "Bearish" | "Neutral" | "Rotating In" | "Rotating Out";
  description: string;
  confidence: "High" | "Medium" | "Low";
}

// Dynamic sector rotation data based on current Indian market themes
function getSectorInsights(): SectorInsight[] {
  return [
    {
      sector: "Banking & Finance",
      trend: "Bullish",
      description:
        "Strong credit growth of 15%+ YoY, improving NPA ratios, and healthy capital adequacy. PSU bank re-rating continues while private banks maintain steady growth.",
      confidence: "High",
    },
    {
      sector: "IT & Technology",
      trend: "Neutral",
      description:
        "Mixed global demand signals. BFSI vertical showing recovery while discretionary spending remains cautious. AI-driven deals are increasing but revenue impact is gradual.",
      confidence: "Medium",
    },
    {
      sector: "Pharma & Healthcare",
      trend: "Bullish",
      description:
        "Domestic formulations growing 10%+ aided by chronic therapy adoption. USFDA approval pipeline remains robust. CDMO segment gaining momentum globally.",
      confidence: "High",
    },
    {
      sector: "Energy (Oil & Gas)",
      trend: "Neutral",
      description:
        "Crude oil price volatility around $70-85/bbl range keeps the sector range-bound. Upstream benefits from higher prices while downstream faces margin pressure.",
      confidence: "Medium",
    },
    {
      sector: "Auto & Ancillary",
      trend: "Bullish",
      description:
        "Strong SUV demand driving premiumization. EV transition accelerating with new launches across segments. Rural recovery aiding two-wheeler volumes.",
      confidence: "High",
    },
    {
      sector: "FMCG & Consumer",
      trend: "Neutral",
      description:
        "Urban consumption steady but rural recovery is gradual. Commodity deflation helping margins but competitive intensity remains high. Staples outperforming discretionary.",
      confidence: "Medium",
    },
    {
      sector: "Infrastructure & Construction",
      trend: "Bullish",
      description:
        "Government capex push with Rs 11.1 lakh crore budget allocation. Strong order book visibility of 2-3x revenue. Road, rail, and defence segments leading.",
      confidence: "High",
    },
    {
      sector: "Metals & Mining",
      trend: "Bearish",
      description:
        "Global demand slowdown especially in China weighing on metal prices. Domestic steel demand is stable but overcapacity and cheap imports from China are headwinds.",
      confidence: "Medium",
    },
    {
      sector: "Realty & Housing",
      trend: "Bullish",
      description:
        "Strong housing demand across Tier 1 and Tier 2 cities. Premium and luxury segments outperforming. Pre-sales hitting record levels for top developers.",
      confidence: "High",
    },
    {
      sector: "Telecom",
      trend: "Rotating In",
      description:
        "5G monetization starting with enterprise use cases. ARPU inching upward with tariff hikes. Jio and Airtel consolidating market share while Vodafone Idea stabilizes.",
      confidence: "Medium",
    },
    {
      sector: "Chemicals",
      trend: "Bearish",
      description:
        "China dumping specialty chemicals at lower prices impacting domestic players. Input cost pressures from crude derivatives. Agri-chemical segment facing regulatory headwinds.",
      confidence: "Medium",
    },
    {
      sector: "Capital Goods",
      trend: "Bullish",
      description:
        "Record order inflows from infrastructure, power, and defence sectors. Power T&D capex cycle is multi-year. Export orders from Middle East and Europe adding to pipeline.",
      confidence: "High",
    },
    {
      sector: "Media & Entertainment",
      trend: "Neutral",
      description:
        "Digital ad revenue growing 15%+ but traditional print and TV declining. OTT consolidation ongoing. Cricket rights costs creating pressure on profitability.",
      confidence: "Low",
    },
  ];
}

const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
let cachedInsights: { data: SectorInsight[]; timestamp: number } | null = null;

export async function GET() {
  const now = Date.now();

  if (cachedInsights && now - cachedInsights.timestamp < CACHE_TTL) {
    return NextResponse.json({
      insights: cachedInsights.data,
      cached: true,
      lastUpdated: cachedInsights.timestamp,
    });
  }

  const insights = getSectorInsights();
  cachedInsights = { data: insights, timestamp: now };

  return NextResponse.json({
    insights,
    cached: false,
    lastUpdated: now,
  });
}