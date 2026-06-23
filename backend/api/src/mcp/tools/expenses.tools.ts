import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getExpenses,
  getExpenseById,
  createExpense,
  getExpenseAggregations,
  getExpenseCategories,
  getRecurringExpenses,
} from "@almirant/database";
import { getOrganizationIdFromExtra } from "../setup";

export const registerExpensesTools = (server: McpServer) => {

  // list_expenses
  server.tool(
    "list_expenses",
    "List expenses with optional filters. Returns paginated list with category and user relations.",
    {
      paidByUserId: z.string().uuid().optional().describe("Filter by person who paid"),
      categoryId: z.string().uuid().optional().describe("Filter by expense category"),
      status: z.enum(["draft","pending_approval","approved","rejected","paid","void"]).optional().describe("Filter by status"),
      currency: z.enum(["EUR","USD","GBP","CHF","JPY","CAD","AUD","MXN","BRL","CLP","COP","ARS"]).optional().describe("Filter by currency"),
      dateFrom: z.string().optional().describe("Start date filter (ISO string)"),
      dateTo: z.string().optional().describe("End date filter (ISO string)"),
      search: z.string().optional().describe("Search in title or vendor"),
      page: z.number().int().min(1).optional().default(1).describe("Page number"),
      limit: z.number().int().min(1).max(100).optional().default(20).describe("Items per page"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }
        const pagination = {
          page: params.page ?? 1,
          limit: params.limit ?? 20,
          offset: ((params.page ?? 1) - 1) * (params.limit ?? 20),
        };
        const filters = {
          paidByUserId: params.paidByUserId,
          categoryId: params.categoryId,
          status: params.status,
          currency: params.currency,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          search: params.search,
        };
        const { items, total } = await getExpenses(organizationId, pagination, filters);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ items, total }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing expenses: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // get_expense
  server.tool(
    "get_expense",
    "Get details of a specific expense by ID, including category, paid-by user, and tags.",
    {
      id: z.string().uuid().describe("Expense UUID"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }
        const expense = await getExpenseById(organizationId, params.id);
        if (!expense) {
          return { content: [{ type: "text" as const, text: `Error: Expense '${params.id}' not found` }], isError: true };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(expense, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting expense: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // create_expense
  server.tool(
    "create_expense",
    "Create a new expense record.",
    {
      title: z.string().min(1).describe("Expense title (required)"),
      amount: z.string().describe("Amount as numeric string (e.g. '125.50')"),
      currency: z.enum(["EUR","USD","GBP","CHF","JPY","CAD","AUD","MXN","BRL","CLP","COP","ARS"]).describe("Currency code"),
      expenseDate: z.string().describe("Expense date as ISO string"),
      description: z.string().optional().describe("Optional description"),
      vendor: z.string().optional().describe("Vendor/supplier name"),
      categoryId: z.string().uuid().optional().describe("Expense category ID"),
      paidByUserId: z.string().optional().describe("User ID of who paid"),
      status: z.enum(["draft","pending_approval","approved","rejected","paid","void"]).optional().default("draft").describe("Expense status"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }
        const expense = await createExpense(organizationId, params as any);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(expense, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating expense: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // get_expense_summary
  server.tool(
    "get_expense_summary",
    "Get aggregated expense data: total amount, breakdown by person, by category, and monthly timeline. Most useful for AI agents to get an overview of spending.",
    {
      dateFrom: z.string().optional().describe("Start date for aggregation (ISO string)"),
      dateTo: z.string().optional().describe("End date for aggregation (ISO string)"),
      paidByUserId: z.string().uuid().optional().describe("Filter aggregations by person"),
      categoryId: z.string().uuid().optional().describe("Filter aggregations by category"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }
        const aggregations = await getExpenseAggregations(organizationId, params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(aggregations, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting expense summary: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // list_expense_categories
  server.tool(
    "list_expense_categories",
    "List all expense categories for the organization.",
    {},
    async (_params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }
        const categories = await getExpenseCategories(organizationId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(categories, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing expense categories: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // list_recurring_expenses
  server.tool(
    "list_recurring_expenses",
    "List recurring expense subscriptions (e.g. SaaS subscriptions, monthly services).",
    {
      activeOnly: z.boolean().optional().default(true).describe("Only return active subscriptions"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }
        const recurring = await getRecurringExpenses(organizationId, params.activeOnly ? { isActive: true } : undefined);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(recurring, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing recurring expenses: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
};
