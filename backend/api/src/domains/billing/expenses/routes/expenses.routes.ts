import { Elysia, t } from "elysia";
import {
  getExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseAggregations,
} from "@almirant/database";
import {
  buildPaginationMeta,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  successResponse,
} from "../../../../shared/services/response";

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

const EXPENSE_STATUS_SCHEMA = t.Union([
  t.Literal("draft"),
  t.Literal("pending_approval"),
  t.Literal("approved"),
  t.Literal("rejected"),
  t.Literal("paid"),
  t.Literal("void"),
]);

const normalizeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

const getOrganizationIdFromContext = (ctx: unknown): string => {
  const activeOrganization = (ctx as { activeOrganization?: { id?: string } }).activeOrganization;
  if (!activeOrganization?.id) throw new Error("ACTIVE_ORGANIZATION_NOT_FOUND");
  return activeOrganization.id;
};

const getUserFromContext = (ctx: unknown): string | undefined => {
  return (ctx as { user?: { id?: string } }).user?.id;
};

export const expensesRoutes = new Elysia({ prefix: "/expenses" })
  // POST /expenses/with-invoice — create expense from invoice file
  // MUST come before /:id to avoid route conflict
  .post(
    "/with-invoice",
    async (ctx) => {
      try {
        const organizationId = getOrganizationIdFromContext(ctx);
        const userId = getUserFromContext(ctx);

        const file = (ctx.body as { file: File }).file;
        if (!file) return errorResponse("No file provided");

        const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
        if (!allowedTypes.includes(file.type)) {
          return errorResponse("Invalid file type. Allowed: PDF, PNG, JPG, WEBP");
        }
        if (file.size > 10 * 1024 * 1024) {
          return errorResponse("File too large. Max 10MB");
        }

        const { generateInvoiceKey, uploadBufferToS3 } = await import("../../../../shared/services/s3-service");
        const { parseInvoice, isInvoiceParsingConfigured } = await import("../services/invoice-parser-service");

        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const s3Key = generateInvoiceKey(organizationId, file.name);
        const fileUrl = await uploadBufferToS3(fileBuffer, s3Key, file.type);

        let parsedData = null;
        let processingStatus = "pending";

        if (isInvoiceParsingConfigured()) {
          try {
            parsedData = await parseInvoice(fileBuffer, file.type);
            processingStatus = parsedData ? "processed" : "failed";
          } catch {
            processingStatus = "failed";
          }
        }

        const created = await createExpense(
          organizationId,
          {
            title: parsedData?.vendor || file.name,
            amount: parsedData?.amount ? String(parsedData.amount) : "0",
            currency: (parsedData?.currency as "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD" | "MXN" | "BRL" | "CLP" | "COP" | "ARS" | null) || "EUR",
            expenseDate: parsedData?.date || new Date().toISOString(),
            vendor: parsedData?.vendor || null,
            status: "draft",
          },
          userId
        );

        const expense = await updateExpense(organizationId, created.id, {
          invoiceFileName: file.name,
          invoiceFileUrl: fileUrl,
          invoiceFileSize: file.size,
          invoiceMimeType: file.type,
          invoiceProcessingStatus: processingStatus,
          invoiceProcessedData: parsedData
            ? (parsedData as unknown as Record<string, unknown>)
            : undefined,
        });

        return successResponse(expense ?? created);
      } catch (error) {
        return errorResponse(normalizeErrorMessage(error));
      }
    },
    {
      body: t.Object({ file: t.File({ maxSize: 10 * 1024 * 1024 }) }),
    }
  )
  // GET /expenses/aggregations — MUST come before /:id to avoid route conflict
  .get("/aggregations", async (ctx) => {
    try {
      const organizationId = getOrganizationIdFromContext(ctx);
      const query = ctx.query as Record<string, string>;
      const filters = {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        paidByUserId: query.paidByUserId,
        categoryId: query.categoryId,
      };
      const aggregations = await getExpenseAggregations(organizationId, filters);
      return successResponse(aggregations);
    } catch (error) {
      return errorResponse(normalizeErrorMessage(error));
    }
  })
  // GET /expenses — list with filters + pagination
  .get("/", async (ctx) => {
    try {
      const organizationId = getOrganizationIdFromContext(ctx);
      const query = ctx.query as Record<string, string>;
      const pagination = parsePaginationParams(query);
      const filters = {
        search: query.search,
        status: query.status,
        currency: query.currency,
        categoryId: query.categoryId,
        paidByUserId: query.paidByUserId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      };
      const { items, total } = await getExpenses(organizationId, pagination, filters);
      return successResponse(items, buildPaginationMeta(pagination.page, pagination.limit, total));
    } catch (error) {
      return errorResponse(normalizeErrorMessage(error));
    }
  })
  // GET /expenses/:id
  .get("/:id", async (ctx) => {
    try {
      const organizationId = getOrganizationIdFromContext(ctx);
      const expense = await getExpenseById(organizationId, ctx.params.id);
      if (!expense) return notFoundResponse("Expense not found");
      return successResponse(expense);
    } catch (error) {
      return errorResponse(normalizeErrorMessage(error));
    }
  })
  // POST /expenses
  .post(
    "/",
    async (ctx) => {
      try {
        const organizationId = getOrganizationIdFromContext(ctx);
        const userId = getUserFromContext(ctx);
        const expense = await createExpense(organizationId, ctx.body as Parameters<typeof createExpense>[1], userId);
        return successResponse(expense);
      } catch (error) {
        return errorResponse(normalizeErrorMessage(error));
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        amount: t.String(),
        currency: CURRENCY_SCHEMA,
        expenseDate: t.String(),
        description: t.Optional(t.Nullable(t.String())),
        vendor: t.Optional(t.Nullable(t.String())),
        categoryId: t.Optional(t.Nullable(t.String())),
        paidByUserId: t.Optional(t.Nullable(t.String())),
        status: t.Optional(EXPENSE_STATUS_SCHEMA),
        projectId: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  // PATCH /expenses/:id
  .patch(
    "/:id",
    async (ctx) => {
      try {
        const organizationId = getOrganizationIdFromContext(ctx);
        const expense = await updateExpense(organizationId, ctx.params.id, ctx.body as Parameters<typeof updateExpense>[2]);
        if (!expense) return notFoundResponse("Expense not found");
        return successResponse(expense);
      } catch (error) {
        return errorResponse(normalizeErrorMessage(error));
      }
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        amount: t.Optional(t.String()),
        currency: t.Optional(CURRENCY_SCHEMA),
        expenseDate: t.Optional(t.String()),
        description: t.Optional(t.Nullable(t.String())),
        vendor: t.Optional(t.Nullable(t.String())),
        categoryId: t.Optional(t.Nullable(t.String())),
        paidByUserId: t.Optional(t.Nullable(t.String())),
        status: t.Optional(EXPENSE_STATUS_SCHEMA),
      }),
    }
  )
  // DELETE /expenses/:id
  .delete("/:id", async (ctx) => {
    try {
      const organizationId = getOrganizationIdFromContext(ctx);
      const deleted = await deleteExpense(organizationId, ctx.params.id);
      if (!deleted) return notFoundResponse("Expense not found");
      return successResponse({ deleted: true });
    } catch (error) {
      return errorResponse(normalizeErrorMessage(error));
    }
  })
  // POST /expenses/:id/invoice — upload invoice file
  .post(
    "/:id/invoice",
    async (ctx) => {
      try {
        const organizationId = getOrganizationIdFromContext(ctx);
        const expense = await getExpenseById(organizationId, ctx.params.id);
        if (!expense) return notFoundResponse("Expense not found");

        const file = (ctx.body as { file: File }).file;
        if (!file) return errorResponse("No file provided");

        const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
        if (!allowedTypes.includes(file.type)) {
          return errorResponse("Invalid file type. Allowed: PDF, PNG, JPG, WEBP");
        }
        if (file.size > 10 * 1024 * 1024) {
          return errorResponse("File too large. Max 10MB");
        }

        const { generateInvoiceKey, uploadBufferToS3 } = await import("../../../../shared/services/s3-service");
        const { parseInvoice, isInvoiceParsingConfigured } = await import("../services/invoice-parser-service");

        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const s3Key = generateInvoiceKey(organizationId, file.name);
        const fileUrl = await uploadBufferToS3(fileBuffer, s3Key, file.type);

        let parsedData = null;
        let processingStatus = "pending";

        if (isInvoiceParsingConfigured()) {
          try {
            parsedData = await parseInvoice(fileBuffer, file.type);
            processingStatus = parsedData ? "processed" : "failed";
          } catch {
            processingStatus = "failed";
          }
        }

        const updateData: Record<string, unknown> = {
          invoiceFileName: file.name,
          invoiceFileUrl: fileUrl,
          invoiceFileSize: file.size,
          invoiceMimeType: file.type,
          invoiceProcessingStatus: processingStatus,
          invoiceProcessedData: parsedData || undefined,
        };

        // If AI extracted data and expense is draft, auto-fill empty fields
        if (parsedData && expense.status === "draft") {
          if (!expense.vendor && parsedData.vendor) updateData.vendor = parsedData.vendor;
          if (expense.amount === "0" && parsedData.amount) updateData.amount = String(parsedData.amount);
          if (parsedData.currency) updateData.currency = parsedData.currency;
          if (parsedData.date) updateData.expenseDate = parsedData.date;
        }

        const updated = await updateExpense(organizationId, ctx.params.id, updateData as Parameters<typeof updateExpense>[2]);
        return successResponse(updated);
      } catch (error) {
        return errorResponse(normalizeErrorMessage(error));
      }
    },
    {
      body: t.Object({ file: t.File({ maxSize: 10 * 1024 * 1024 }) }),
    }
  );
