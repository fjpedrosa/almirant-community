import { Badge } from "@/components/ui/badge";
import type { CurrencyCode } from "../../domain/types";

const CURRENCY_FLAGS: Record<CurrencyCode, string> = {
  EUR: "🇪🇺",
  USD: "🇺🇸",
  GBP: "🇬🇧",
  CHF: "🇨🇭",
  JPY: "🇯🇵",
  CAD: "🇨🇦",
  AUD: "🇦🇺",
  MXN: "🇲🇽",
  BRL: "🇧🇷",
  CLP: "🇨🇱",
  COP: "🇨🇴",
  ARS: "🇦🇷",
};

interface Props {
  currency: CurrencyCode;
}

export const ExpenseCurrencyBadge = ({ currency }: Props) => (
  <Badge variant="secondary" className="text-xs font-mono">
    {CURRENCY_FLAGS[currency]} {currency}
  </Badge>
);
