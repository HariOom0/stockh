import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { getTradingDate } from "@/lib/trading-calendar";

export const dynamic = "force-dynamic";

function hasValidDbUrl() {
  const url = process.env.DATABASE_URL;
  return !!url && (url.startsWith("postgresql://") || url.startsWith("postgres://") || url.startsWith("file:"));
}

export async function GET() {
  const tradingDate = getTradingDate();

  if (hasValidDbUrl()) {
    try {
      const { db } = await import("@/lib/db");
      const snapshot = await db.dailyStockSnapshot.findUnique({ where: { date: tradingDate } });
      if (snapshot?.icStocksJson) {
        return NextResponse.json({
          stocks: JSON.parse(snapshot.icStocksJson),
          tradingDate,
          lastUpdated: snapshot.createdAt.getTime(),
          source: "database",
        });
      }
    } catch (error) {
      console.warn("[IC] Database lookup failed:", error);
    }
  }

  try {
    const staticData = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "stocks.json"), "utf-8"));
    if (staticData.tradingDate && Array.isArray(staticData.icStocks)) {
      return NextResponse.json({
        stocks: staticData.icStocks,
        tradingDate: staticData.tradingDate,
        lastUpdated: staticData.lastUpdated,
        source: "static",
      });
    }
  } catch (error) {
    console.warn("[IC] Static lookup failed:", error);
  }

  return NextResponse.json({ stocks: [], tradingDate, source: "none" });
}
