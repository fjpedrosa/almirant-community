import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

export const isAuthorizedRunnerControlRequest = (
  request: Request,
  serverOwnedToken: string | undefined,
): boolean => {
  if (!serverOwnedToken) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const candidate = authorization.slice("Bearer ".length);
  if (!candidate) return false;
  return timingSafeEqual(digest(candidate), digest(serverOwnedToken));
};
