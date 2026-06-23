import { pgTable, uuid, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { currencyCodeEnum } from "./enums";

export const currencyRates = pgTable("currency_rates", {
  id: uuid("id").defaultRandom().primaryKey(),
  fromCurrency: currencyCodeEnum("from_currency").notNull(),
  toCurrency: currencyCodeEnum("to_currency").notNull(),
  rate: numeric("rate", { precision: 16, scale: 8 }).notNull(),
  rateDate: timestamp("rate_date", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("currency_rates_pair_date_idx").on(table.fromCurrency, table.toCurrency, table.rateDate),
]);

export type CurrencyRate = typeof currencyRates.$inferSelect;
export type NewCurrencyRate = typeof currencyRates.$inferInsert;
