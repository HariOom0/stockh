import test from "node:test";
import assert from "node:assert/strict";

const hasDatabase = Boolean(process.env.DATABASE_URL);

test(
  "daily stock snapshots persist new data and later updates",
  { skip: !hasDatabase ? "DATABASE_URL is not configured" : false },
  async () => {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const date = "2999-12-31";
    const firstStocks = [
      {
        sr: 1,
        name: "Persistence Test Alpha",
        ticker: "PERSISTALPHA",
        close: 100,
        change: 5,
        volGainPct: 250,
        isPositive: true,
      },
    ];
    const updatedStocks = [
      ...firstStocks,
      {
        sr: 2,
        name: "Persistence Test Beta",
        ticker: "PERSISTBETA",
        close: 200,
        change: 7,
        volGainPct: 300,
        isPositive: true,
      },
    ];

    try {
      await db.dailyStockSnapshot.deleteMany({ where: { date } });

      await db.dailyStockSnapshot.upsert({
        where: { date },
        create: {
          date,
          stockCount: firstStocks.length,
          stocksJson: JSON.stringify(firstStocks),
        },
        update: {
          stockCount: firstStocks.length,
          stocksJson: JSON.stringify(firstStocks),
        },
      });

      const firstRead = await db.dailyStockSnapshot.findUnique({ where: { date } });
      assert.ok(firstRead, "the initial snapshot should be readable after saving");
      assert.equal(firstRead.stockCount, 1);
      assert.deepEqual(JSON.parse(firstRead.stocksJson), firstStocks);

      await db.dailyStockSnapshot.upsert({
        where: { date },
        create: {
          date,
          stockCount: updatedStocks.length,
          stocksJson: JSON.stringify(updatedStocks),
        },
        update: {
          stockCount: updatedStocks.length,
          stocksJson: JSON.stringify(updatedStocks),
        },
      });

      const updatedRead = await db.dailyStockSnapshot.findUnique({ where: { date } });
      assert.ok(updatedRead, "the updated snapshot should remain readable");
      assert.equal(updatedRead.stockCount, updatedStocks.length);
      assert.deepEqual(JSON.parse(updatedRead.stocksJson), updatedStocks);
    } finally {
      await db.dailyStockSnapshot.deleteMany({ where: { date } });
      await db.$disconnect();
    }
  },
);
