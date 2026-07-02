import { Elysia, t } from "elysia";
import {
  getRecurringExpenses,
  getRecurringExpenseById,
  createRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
  getUpcomingRenewals,
  getRecurringSummary,
} from "@almirant/database";
import { successResponse, errorResponse, notFoundResponse } from "../../../../shared/services/response";

const CURRENCY_SCHEMA = t.Union([
  t.Literal("EUR"),
  t.Literal("USD"),
  t.Literal("GBP"),
  t.Literal("CHF"),
  t.Literal("JPY"),
  t.Literal("CAD"),
  t.Literal("AUD"),
  t.Literal("MXN"),
  t.Literal("BRL"),
  t.Literal("CLP"),
  t.Literal("COP"),
  t.Literal("ARS"),
]);

const RECURRENCE_SCHEMA = t.Union([
  t.Literal("weekly"),
  t.Literal("monthly"),
  t.Literal("quarterly"),
  t.Literal("yearly"),
]);

const normalizeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

const getWorkspaceIdFromContext = (ctx: unknown): string => {
  const activeWorkspace = (ctx as { activeWorkspace?: { id?: string } }).activeWorkspace;
  if (!activeWorkspace?.id) throw new Error("ACTIVE_WORKSPACE_NOT_FOUND");
  return activeWorkspace.id;
};

const mapRecurringExpenseErrorToHttp = (errorMessage: string): { status: number; message: string } => {
  if (errorMessage === "ACTIVE_WORKSPACE_NOT_FOUND") {
    return { status: 403, message: "No active workspace in session" };
  }
  if (errorMessage === "RECURRING_EXPENSE_NOT_FOUND") {
    return { status: 404, message: "Recurring expense not found" };
  }
  if (errorMessage === "FAILED_TO_CREATE_RECURRING_EXPENSE") {
    return { status: 500, message: "Failed to create recurring expense" };
  }
  return { status: 500, message: errorMessage };
};

export const recurringExpensesRoutes = new Elysia({ prefix: "/recurring-expenses" })
  // ── List recurring expenses ──────────────────────────────────────────
  .get(
    "/",
    async (ctx) => {
      try {
        const { query } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const items = await getRecurringExpenses(orgId, {
          isActive: query.isActive !== undefined ? query.isActive === "true" : undefined,
        });
        return successResponse(items);
      } catch (error) {
        const mapped = mapRecurringExpenseErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      query: t.Object({
        isActive: t.Optional(t.String()),
      }),
    }
  )
  // ── Get summary ──────────────────────────────────────────────────────
  .get(
    "/summary",
    async (ctx) => {
      try {
        const orgId = getWorkspaceIdFromContext(ctx);
        const summary = await getRecurringSummary(orgId);
        return successResponse(summary);
      } catch (error) {
        const mapped = mapRecurringExpenseErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    }
  )
  // ── Get upcoming renewals ────────────────────────────────────────────
  .get(
    "/upcoming",
    async (ctx) => {
      try {
        const { query } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const daysAhead = query.daysAhead ? parseInt(query.daysAhead, 10) : 30;
        const items = await getUpcomingRenewals(orgId, daysAhead);
        return successResponse(items);
      } catch (error) {
        const mapped = mapRecurringExpenseErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      query: t.Object({
        daysAhead: t.Optional(t.String()),
      }),
    }
  )
  // ── Get by id ────────────────────────────────────────────────────────
  .get(
    "/:id",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const item = await getRecurringExpenseById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Recurring expense");
        }
        return successResponse(item);
      } catch (error) {
        const mapped = mapRecurringExpenseErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  // ── Create ───────────────────────────────────────────────────────────
  .post(
    "/",
    async (ctx) => {
      try {
        const { body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const title = body.title?.trim();
        if (!title) {
          set.status = 400;
          return errorResponse("Title is required", 400);
        }
        const item = await createRecurringExpense(orgId, {
          title,
          vendor: body.vendor ?? null,
          amount: body.amount,
          currency: body.currency,
          recurrence: body.recurrence,
          anchorDate: body.anchorDate,
          nextRenewalDate: body.nextRenewalDate ?? null,
          alertDaysBefore: body.alertDaysBefore ?? 7,
          categoryId: body.categoryId ?? null,
          paidByUserId: body.paidByUserId ?? null,
          projectId: body.projectId ?? null,
        });
        set.status = 201;
        return successResponse(item);
      } catch (error) {
        const mapped = mapRecurringExpenseErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      body: t.Object({
        title: t.String(),
        vendor: t.Optional(t.Nullable(t.String())),
        amount: t.String(),
        currency: CURRENCY_SCHEMA,
        recurrence: RECURRENCE_SCHEMA,
        anchorDate: t.String(),
        nextRenewalDate: t.Optional(t.Nullable(t.String())),
        alertDaysBefore: t.Optional(t.Number()),
        categoryId: t.Optional(t.Nullable(t.String())),
        paidByUserId: t.Optional(t.Nullable(t.String())),
        projectId: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  // ── Update ───────────────────────────────────────────────────────────
  .patch(
    "/:id",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const updated = await updateRecurringExpense(orgId, params.id, {
          title: body.title,
          vendor: body.vendor,
          amount: body.amount,
          currency: body.currency,
          recurrence: body.recurrence,
          anchorDate: body.anchorDate,
          nextRenewalDate: body.nextRenewalDate,
          alertDaysBefore: body.alertDaysBefore,
          categoryId: body.categoryId,
          paidByUserId: body.paidByUserId,
          projectId: body.projectId,
          isActive: body.isActive,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Recurring expense");
        }
        return successResponse(updated);
      } catch (error) {
        const mapped = mapRecurringExpenseErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        title: t.Optional(t.String()),
        vendor: t.Optional(t.Nullable(t.String())),
        amount: t.Optional(t.String()),
        currency: t.Optional(CURRENCY_SCHEMA),
        recurrence: t.Optional(RECURRENCE_SCHEMA),
        anchorDate: t.Optional(t.String()),
        nextRenewalDate: t.Optional(t.Nullable(t.String())),
        alertDaysBefore: t.Optional(t.Number()),
        categoryId: t.Optional(t.Nullable(t.String())),
        paidByUserId: t.Optional(t.Nullable(t.String())),
        projectId: t.Optional(t.Nullable(t.String())),
        isActive: t.Optional(t.Boolean()),
      }),
    }
  )
  // ── Delete ───────────────────────────────────────────────────────────
  .delete(
    "/:id",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const deleted = await deleteRecurringExpense(orgId, params.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Recurring expense");
        }
        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapRecurringExpenseErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  );
