import { Elysia } from "elysia";
import { expensesRoutes } from "./expenses/routes/expenses.routes";
import { recurringExpensesRoutes } from "./expenses/routes/recurring-expenses.routes";
import { quotaRoutes } from "./quota/routes/quota.routes";
import { usageRoutes } from "./quota/routes/usage.routes";
import { expenseCategoriesModule } from "./expense-categories";

export const billingModule = {
  /** Stripe webhook is EE-only; CE does not mount any public billing route. */
  public: () => new Elysia({ name: "billing-public-noop" }),

  /** Protected routes — mounted inside /api group (session auth) */
  protected: () =>
    new Elysia()
      .use(expensesRoutes)
      .use(recurringExpensesRoutes)
      .use(quotaRoutes)
      .use(usageRoutes)
      .use(expenseCategoriesModule()),
};
