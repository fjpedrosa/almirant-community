import { db } from "../../client";
import { currencyRates } from "../../schema";
import { and, desc, eq, sql } from "drizzle-orm";

type CurrencyRate = typeof currencyRates.$inferSelect;

export const getLatestExchangeRate = async (
  from: string,
  to: string
): Promise<CurrencyRate | null> => {
  const [rate] = await db
    .select()
    .from(currencyRates)
    .where(
      and(
        eq(currencyRates.fromCurrency, from as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS"),
        eq(currencyRates.toCurrency, to as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS")
      )
    )
    .orderBy(desc(currencyRates.rateDate))
    .limit(1);

  return rate ?? null;
};

export const upsertExchangeRates = async (
  rates: { from: string; to: string; rate: string; rateDate: Date }[]
): Promise<void> => {
  if (rates.length === 0) return;

  for (const r of rates) {
    await db
      .insert(currencyRates)
      .values({
        fromCurrency: r.from as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS",
        toCurrency: r.to as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS",
        rate: r.rate,
        rateDate: r.rateDate,
      })
      .onConflictDoUpdate({
        target: [currencyRates.fromCurrency, currencyRates.toCurrency, currencyRates.rateDate],
        set: { rate: r.rate, fetchedAt: new Date() },
      });
  }
};

export const getExchangeRatesForDate = async (rateDate: Date): Promise<CurrencyRate[]> => {
  const dateStr = rateDate.toISOString().split("T")[0]!;
  return db
    .select()
    .from(currencyRates)
    .where(sql`DATE(${currencyRates.rateDate}) = ${dateStr}`);
};
