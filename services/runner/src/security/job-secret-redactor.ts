import type { StreamPublisher } from "@almirant/stream-consumer";
import { sanitizeLogContent } from "../observability/log-sanitizer";

const REDACTED_JOB_SECRET = "[REDACTED:JOB_SECRET]";
const MIN_REDACTABLE_SECRET_LENGTH = 8;
const SENSITIVE_KEY =
  /(?:^|[_-])(?:api[_-]?key|auth|authorization|credential|password|passphrase|secret|token)(?:$|[_-])/i;

export type JobSecretRedactor = {
  register: (label: string, value: string | null | undefined) => void;
  redactString: (value: string) => string;
  redactValue: <T>(value: T) => T;
};

export type JobSafeConsole = {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

const encodedVariants = (value: string): string[] => {
  const componentEncoded = encodeURIComponent(value);
  const formEncoded = new URLSearchParams({ value }).toString().slice("value=".length);
  const lowerCasePercentEncoding = (encoded: string): string =>
    encoded.replace(/%[0-9A-F]{2}/g, (match) => match.toLowerCase());
  return [
    value,
    componentEncoded,
    lowerCasePercentEncoding(componentEncoded),
    formEncoded,
    lowerCasePercentEncoding(formEncoded),
  ];
};

const secretRepresentations = (value: string): string[] => {
  const base64 = Buffer.from(value, "utf8").toString("base64");
  const base64Url = Buffer.from(value, "utf8").toString("base64url");
  const rawRepresentations = new Set([
    value,
    base64,
    base64.replace(/=+$/u, ""),
    base64Url,
  ]);

  return [...rawRepresentations].flatMap(encodedVariants);
};

export const createJobSecretRedactor = (): JobSecretRedactor => {
  const registeredValues = new Set<string>();
  let orderedValues: string[] = [];

  const register = (_label: string, value: string | null | undefined): void => {
    if (
      typeof value !== "string" ||
      value.length < MIN_REDACTABLE_SECRET_LENGTH
    ) {
      return;
    }

    let changed = false;
    for (const variant of secretRepresentations(value)) {
      if (variant.length === 0 || registeredValues.has(variant)) continue;
      registeredValues.add(variant);
      changed = true;
    }

    if (changed) {
      orderedValues = [...registeredValues].sort(
        (left, right) => right.length - left.length,
      );
    }
  };

  const redactString = (value: string): string => {
    let redacted = value;
    for (const registeredValue of orderedValues) {
      redacted = redacted.split(registeredValue).join(REDACTED_JOB_SECRET);
    }
    return sanitizeLogContent(redacted);
  };

  const redactValue = <T>(value: T): T => {
    const visited = new WeakMap<object, unknown>();

    const redactRecursive = (current: unknown): unknown => {
      if (typeof current === "string") return redactString(current);
      if (typeof current !== "object" || current === null) return current;
      if (
        current instanceof Date ||
        current instanceof ArrayBuffer ||
        ArrayBuffer.isView(current)
      ) {
        return current;
      }

      const existing = visited.get(current);
      if (existing !== undefined) return existing;

      if (current instanceof Error) {
        const redactedError = new Error(redactString(current.message));
        redactedError.name = current.name;
        redactedError.stack = current.stack
          ? redactString(current.stack)
          : undefined;
        visited.set(current, redactedError);
        for (const [key, nested] of Object.entries(current)) {
          (redactedError as unknown as Record<string, unknown>)[key] =
            redactRecursive(nested);
        }
        return redactedError;
      }

      if (Array.isArray(current)) {
        const redactedArray: unknown[] = [];
        visited.set(current, redactedArray);
        for (const item of current) {
          redactedArray.push(redactRecursive(item));
        }
        return redactedArray;
      }

      const redactedObject: Record<string, unknown> = {};
      visited.set(current, redactedObject);
      for (const [key, nested] of Object.entries(current)) {
        redactedObject[key] = redactRecursive(nested);
      }
      return redactedObject;
    };

    return redactRecursive(value) as T;
  };

  return { register, redactString, redactValue };
};

export const createJobSafeConsole = (
  redactor: JobSecretRedactor,
  underlying: JobSafeConsole = console,
): JobSafeConsole => {
  const redactArgs = (args: unknown[]): unknown[] =>
    args.map((value) =>
      typeof value === "string"
        ? redactor.redactString(value)
        : redactor.redactValue(value),
    );

  return {
    log: (...args) => underlying.log(...redactArgs(args)),
    warn: (...args) => underlying.warn(...redactArgs(args)),
    error: (...args) => underlying.error(...redactArgs(args)),
  };
};

const registerStringLeaves = (
  redactor: JobSecretRedactor,
  label: string,
  value: unknown,
  visited: WeakSet<object>,
): void => {
  if (typeof value === "string") {
    redactor.register(label, value);
    const bearerToken = value.match(/^Bearer\s+(.+)$/i)?.[1];
    if (bearerToken) redactor.register(label, bearerToken);
    return;
  }
  if (typeof value !== "object" || value === null || visited.has(value)) return;
  visited.add(value);
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    registerStringLeaves(redactor, label, nested, visited);
  }
};

export const registerSensitiveValuesFromObject = (
  redactor: JobSecretRedactor,
  value: unknown,
): void => {
  const visited = new WeakSet<object>();

  const visit = (current: unknown, path: string): void => {
    if (typeof current !== "object" || current === null || visited.has(current)) {
      return;
    }
    visited.add(current);

    const entries = Array.isArray(current)
      ? current.map((nested, index) => [String(index), nested] as const)
      : Object.entries(current);
    for (const [key, nested] of entries) {
      const nestedPath = path ? `${path}.${key}` : key;
      if (SENSITIVE_KEY.test(key)) {
        registerStringLeaves(redactor, nestedPath, nested, new WeakSet());
      } else {
        visit(nested, nestedPath);
      }
    }
  };

  visit(value, "");
};

export const createRedactingStreamPublisher = (
  underlying: StreamPublisher,
  redactor: JobSecretRedactor,
): StreamPublisher => ({
  publish: (event) => underlying.publish(redactor.redactValue(event)),
  publishCanonicalEnvelope: (envelope) =>
    underlying.publishCanonicalEnvelope(redactor.redactValue(envelope)),
  publishNativeEnvelope: (envelope) =>
    underlying.publishNativeEnvelope(redactor.redactValue(envelope)),
  close: () => underlying.close(),
});
