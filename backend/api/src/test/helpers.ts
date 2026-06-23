import { Elysia } from "elysia";

/**
 * Create a test Elysia app with the given route plugin.
 * Uses the route's own prefix (no auth middleware).
 */
export const createTestApp = (routePlugin: Parameters<Elysia["use"]>[0]) => {
  return new Elysia().use(routePlugin);
};

/**
 * Build a Request object for the given path.
 */
export const makeRequest = (path: string, options?: RequestInit): Request => {
  return new Request(`http://localhost${path}`, options);
};

/**
 * Build RequestInit for a JSON POST/PATCH/PUT request.
 */
export const jsonBody = (data: unknown, method: string = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

/**
 * Parse a Response as JSON and return { status, body }.
 */
export const parseResponse = async <T = unknown>(res: Response): Promise<{ status: number; body: T }> => {
  const body = await res.json() as T;
  return { status: res.status, body };
};
