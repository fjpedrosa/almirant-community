import { getLatestExchangeRate, upsertExchangeRates } from "@almirant/database";
import { logger } from "@almirant/config";

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

const SUPPORTED = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "CAD",
  "AUD",
  "MXN",
  "BRL",
  "CLP",
  "COP",
  "ARS",
] as const;

type SupportedCurrency = (typeof SUPPORTED)[number];

// Parse ECB XML: looks for <Cube currency="USD" rate="1.09"/>
// Returns map of currency -> rate (EUR-based)
async function fetchEcbRates(): Promise<{ date: string; rates: Record<string, string> } | null> {
  try {
    const res = await fetch(ECB_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const xml = await res.text();
    // Extract date
    const dateMatch = xml.match(/time="(\d{4}-\d{2}-\d{2})"/);
    const date = dateMatch?.[1];
    if (!date) return null;
    // Extract rates
    const rates: Record<string, string> = {};
    const ratePattern = /currency="([A-Z]+)"\s+rate="([0-9.]+)"/g;
    let match;
    while ((match = ratePattern.exec(xml)) !== null) {
      rates[match[1]!] = match[2]!;
    }
    return { date, rates };
  } catch (err) {
    logger.error({ err }, "Failed to fetch ECB rates");
    return null;
  }
}

export async function refreshExchangeRates(): Promise<void> {
  const data = await fetchEcbRates();
  if (!data) {
    logger.warn("Could not refresh exchange rates from ECB");
    return;
  }

  const rateDate = new Date(data.date);
  const toUpsert: { from: string; to: string; rate: string; rateDate: Date }[] = [];

  // EUR -> X rates
  for (const [currency, rate] of Object.entries(data.rates)) {
    if (SUPPORTED.includes(currency as SupportedCurrency)) {
      toUpsert.push({ from: "EUR", to: currency, rate, rateDate });
      // X -> EUR = 1/rate
      const inverseRate = (1 / parseFloat(rate)).toFixed(8);
      toUpsert.push({ from: currency, to: "EUR", rate: inverseRate, rateDate });
    }
  }

  // Also compute cross rates for non-EUR pairs via EUR as pivot
  await upsertExchangeRates(toUpsert);
  logger.info({ count: toUpsert.length, date: data.date }, "Exchange rates refreshed from ECB");
}

function getPreviousBusinessDay(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d.toISOString().split("T")[0]!;
}

export async function getExchangeRate(
  from: SupportedCurrency,
  to: SupportedCurrency
): Promise<number | null> {
  if (from === to) return 1;

  const cached = await getLatestExchangeRate(from, to);
  if (cached) {
    // Check if stale (older than today)
    const today = new Date().toISOString().split("T")[0]!;
    const rateDay = cached.rateDate.toISOString().split("T")[0]!;
    if (rateDay >= today || rateDay === getPreviousBusinessDay()) {
      return parseFloat(cached.rate);
    }
  }

  // Refresh and retry
  await refreshExchangeRates();
  const fresh = await getLatestExchangeRate(from, to);
  return fresh ? parseFloat(fresh.rate) : null;
}

export async function convertAmount(
  amount: number,
  from: SupportedCurrency,
  to: SupportedCurrency
): Promise<number | null> {
  const rate = await getExchangeRate(from, to);
  if (rate === null) return null;
  return Math.round(amount * rate * 100) / 100;
}
