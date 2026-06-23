"use client";

import { ExpensesPageContainer } from "@/domains/expenses/presentation/containers/expenses-page-container";
import { BetaGate } from "@/domains/shared/presentation/components/beta-gate";

export default function ExpensesPage() {
  return (
    <BetaGate flagKey="beta-expenses">
      <ExpensesPageContainer />
    </BetaGate>
  );
}
