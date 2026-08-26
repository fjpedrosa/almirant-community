export const PI_INBOUND_RECORD_MAX_BYTES = 262_144;
export const PI_OUTBOUND_RECORD_MAX_BYTES = 4_194_304;

export type PiAiProvider = "anthropic" | "openai" | "google" | "zai" | "xai";
export type PiAuthClass = "api_key" | "setup_token" | "provider_oauth" | "subscription";
export type PiCapabilityId =
  | "mcp"
  | "browser"
  | "extensions"
  | "sandbox"
  | "permission_enforced"
  | "read_only_enforced";

export interface PiCapabilityContract {
  schemaVersion: "pi-capability-contract-v1";
  contractVersion: 1;
  runtime: {
    packageName: "@earendil-works/pi-coding-agent";
    packageVersion: "0.84.2";
    nodeEngine: ">=22.19.0";
    binary: "pi";
    mode: "rpc";
    configDirectoryPolicy: "new-empty-per-session";
    sessionPersistence: false;
    projectResources: false;
    offline: true;
    telemetry: false;
    versionChecks: false;
    arguments: string[];
    environment: Record<string, string>;
  };
  framing: {
    recordDelimiter: "LF";
    acceptsCrlfInput: true;
    unicodeLineSeparatorsAreContent: true;
    finalLfRequired: true;
    objectRecordsOnly: true;
    inboundMaxBytes: 262_144;
    outboundMaxBytes: 4_194_304;
    failureScope: "session";
    recordSizeExcludesDelimiter: true;
  };
  rpc: {
    commands: Array<{
      type: "get_state" | "set_model" | "prompt" | "abort" | "get_session_stats";
      responseCardinality: "exactly-one-correlated";
    }>;
    normalTerminal: "agent_settled";
    nonTerminals: string[];
    abortAcknowledgementIsTerminal: false;
    duplicateTerminalPolicy: "ignore-after-first";
    abnormalTerminalClasses: Array<{
      class:
        | "protocol_error"
        | "process_exit"
        | "process_signal"
        | "stdin_error"
        | "timeout"
        | "cancelled";
      code: string;
    }>;
    fatalInputClasses: string[];
  };
  usage: {
    streaming: "cumulative-snapshot-never-sum";
    finalMessage: "per-message-authoritative";
    postSettlementSessionStats: "whole-session-aggregate";
    continuedTurns: "subtract-pre-turn-session-baseline";
    reasoning: "subset-of-output";
    unavailable: "unknown-never-zero-filled";
    precedence: string[];
  };
  authClasses: Array<{
    id: PiAuthClass;
    documentationCandidate: boolean;
    admissionEnabled: boolean;
    rejectionCode: string | null;
  }>;
  providers: PiProviderCandidate[];
  capabilities: Array<{
    id: PiCapabilityId;
    enabled: false;
    rejectionCode: string;
  }>;
  customProviders: {
    enabled: false;
    rejectionCode: "PI_CUSTOM_PROVIDER_DISABLED";
    unsafeInputs: string[];
    enablementPrerequisites: string[];
  };
  persistedSurfaceAudit: PiPersistedSurfaceAudit[];
  provenance: PiProvenance[];
}

export interface PiProviderCandidate {
  displayName: string;
  aiProvider: PiAiProvider;
  piProvider: PiAiProvider;
  authClass: "api_key";
  environmentVariable: string;
  endpoint: string;
  apis: string[];
  targetCatalogModels: string[];
  candidateModels: string[];
  candidateModelApis: Record<string, string>;
  admittedModels: string[];
  excludedTargetModels: string[];
  exclusionRule: string;
  runtimeVerified: boolean;
  admissionEnabled: boolean;
  catalogProvenance: {
    providerSource: string;
    modelData: string;
    targetCatalog: string;
  };
}

export interface PiPersistedSurfaceAudit {
  surface:
    | "agent_jobs"
    | "loops"
    | "scheduled_agent_configs"
    | "work_items"
    | "system_settings.agent_routing"
    | "agent_native_events";
  auditStatus: "documented";
  locations: string[];
  defaults: Record<string, string>;
  nullability: Record<string, string>;
  duplicateRepresentations: string[];
  precedence: string;
  legacyValues: string[];
  currentConflict: string;
}

export interface PiProvenance {
  id: string;
  scope: "pi-package" | "pi-ai-package" | "repository";
  path: string;
  establishes: string;
}

export type PiFramingCase =
  | {
      id: string;
      kind: "literal";
      wire: string;
      expected:
        | { accepted: true; records: number }
        | { accepted: false; code: string; failureScope: "session" };
    }
  | {
      id: string;
      kind: "sized-object";
      recordBytes: number;
      expected:
        | { accepted: true; records: number }
        | { accepted: false; code: string; failureScope: "session" };
    };

export interface PiFramingCases {
  schemaVersion: "pi-rpc-framing-cases-v1";
  packageVersion: "0.84.2";
  limits: {
    inboundMaxBytes: 262_144;
    outboundMaxBytes: 4_194_304;
    finalLfRequired: true;
  };
  cases: PiFramingCase[];
}

export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  reasoning?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface PiLifecycleMessage {
  role: string;
  content: unknown;
  usage?: PiUsage;
  [key: string]: unknown;
}

export interface PiLifecycleRecord {
  type: string;
  id?: string;
  command?: string;
  success?: boolean;
  usage?: PiUsage;
  message?: string | PiLifecycleMessage;
  data?: Record<string, any>;
  [key: string]: unknown;
}

export interface PiLifecycleEnvelope {
  fixture: "rpc-lifecycle-v1";
  packageVersion: "0.84.2";
  runtimeCaptured: false;
  basis: "schema-derived";
  sequence: number;
  record: PiLifecycleRecord;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (path: string, expectation: string): never => {
  throw new Error(`${path}: ${expectation}`);
};

const record = (value: unknown, path: string): Record<string, unknown> =>
  isRecord(value) ? value : fail(path, "expected object");

const string = (value: unknown, path: string): string =>
  typeof value === "string" ? value : fail(path, "expected string");

const boolean = (value: unknown, path: string): boolean =>
  typeof value === "boolean" ? value : fail(path, "expected boolean");

const number = (value: unknown, path: string): number =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : fail(path, "expected finite number");

const array = (value: unknown, path: string): unknown[] =>
  Array.isArray(value) ? value : fail(path, "expected array");

const stringArray = (value: unknown, path: string): string[] =>
  array(value, path).map((entry, index) => string(entry, `${path}[${index}]`));

const literal = <T extends string | number | boolean>(
  value: unknown,
  expected: T,
  path: string,
): T => (value === expected ? expected : fail(path, `expected ${JSON.stringify(expected)}`));

const assertUnique = (values: string[], label: string): void => {
  if (new Set(values).size !== values.length) {
    throw new Error(`duplicate ${label}`);
  }
};

const SENSITIVE_KEYS = new Set([
  "apikey",
  "authorization",
  "credential",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "token",
]);

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:^|[^A-Za-z0-9])(?:ghp_|xox[baprs]-|sk-[A-Za-z0-9])/i,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._~-]+/i,
  /(?:\/Users\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\)/,
];

/** Returns JSON paths containing credential-like values or user-specific paths. */
export const findSensitiveMaterial = (value: unknown): string[] => {
  const findings: string[] = [];
  const visit = (current: unknown, path: string, key?: string): void => {
    if (typeof current === "string") {
      if (
        (key !== undefined && SENSITIVE_KEYS.has(key.toLowerCase()) && current.length > 0) ||
        SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(current))
      ) {
        findings.push(path);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!isRecord(current)) return;
    for (const [childKey, child] of Object.entries(current)) {
      visit(child, `${path}.${childKey}`, childKey);
    }
  };
  visit(value, "$");
  return findings;
};

const assertRuntime = (value: unknown): void => {
  const runtime = record(value, "$.runtime");
  literal(runtime.packageName, "@earendil-works/pi-coding-agent", "$.runtime.packageName");
  literal(runtime.packageVersion, "0.84.2", "$.runtime.packageVersion");
  literal(runtime.nodeEngine, ">=22.19.0", "$.runtime.nodeEngine");
  literal(runtime.binary, "pi", "$.runtime.binary");
  literal(runtime.mode, "rpc", "$.runtime.mode");
  literal(
    runtime.configDirectoryPolicy,
    "new-empty-per-session",
    "$.runtime.configDirectoryPolicy",
  );
  literal(runtime.sessionPersistence, false, "$.runtime.sessionPersistence");
  literal(runtime.projectResources, false, "$.runtime.projectResources");
  literal(runtime.offline, true, "$.runtime.offline");
  literal(runtime.telemetry, false, "$.runtime.telemetry");
  literal(runtime.versionChecks, false, "$.runtime.versionChecks");
  stringArray(runtime.arguments, "$.runtime.arguments");
  const environment = record(runtime.environment, "$.runtime.environment");
  for (const [key, entry] of Object.entries(environment)) {
    string(entry, `$.runtime.environment.${key}`);
  }
};

const assertFraming = (value: unknown): void => {
  const framing = record(value, "$.framing");
  literal(framing.recordDelimiter, "LF", "$.framing.recordDelimiter");
  literal(framing.acceptsCrlfInput, true, "$.framing.acceptsCrlfInput");
  literal(
    framing.unicodeLineSeparatorsAreContent,
    true,
    "$.framing.unicodeLineSeparatorsAreContent",
  );
  literal(framing.finalLfRequired, true, "$.framing.finalLfRequired");
  literal(framing.objectRecordsOnly, true, "$.framing.objectRecordsOnly");
  literal(framing.inboundMaxBytes, PI_INBOUND_RECORD_MAX_BYTES, "$.framing.inboundMaxBytes");
  literal(
    framing.outboundMaxBytes,
    PI_OUTBOUND_RECORD_MAX_BYTES,
    "$.framing.outboundMaxBytes",
  );
  literal(framing.failureScope, "session", "$.framing.failureScope");
  literal(
    framing.recordSizeExcludesDelimiter,
    true,
    "$.framing.recordSizeExcludesDelimiter",
  );
};

const assertRpc = (value: unknown): void => {
  const rpc = record(value, "$.rpc");
  const commands = array(rpc.commands, "$.rpc.commands");
  commands.forEach((entry, index) => {
    const command = record(entry, `$.rpc.commands[${index}]`);
    string(command.type, `$.rpc.commands[${index}].type`);
    literal(
      command.responseCardinality,
      "exactly-one-correlated",
      `$.rpc.commands[${index}].responseCardinality`,
    );
  });
  assertUnique(
    commands.map((entry) => string(record(entry, "command").type, "command.type")),
    "RPC command",
  );
  literal(rpc.normalTerminal, "agent_settled", "$.rpc.normalTerminal");
  stringArray(rpc.nonTerminals, "$.rpc.nonTerminals");
  literal(
    rpc.abortAcknowledgementIsTerminal,
    false,
    "$.rpc.abortAcknowledgementIsTerminal",
  );
  literal(rpc.duplicateTerminalPolicy, "ignore-after-first", "$.rpc.duplicateTerminalPolicy");
  const abnormal = array(rpc.abnormalTerminalClasses, "$.rpc.abnormalTerminalClasses");
  abnormal.forEach((entry, index) => {
    const terminal = record(entry, `$.rpc.abnormalTerminalClasses[${index}]`);
    string(terminal.class, `$.rpc.abnormalTerminalClasses[${index}].class`);
    string(terminal.code, `$.rpc.abnormalTerminalClasses[${index}].code`);
  });
  assertUnique(
    abnormal.map((entry) => string(record(entry, "terminal").class, "terminal.class")),
    "abnormal terminal class",
  );
  assertUnique(
    abnormal.map((entry) => string(record(entry, "terminal").code, "terminal.code")),
    "abnormal terminal code",
  );
  stringArray(rpc.fatalInputClasses, "$.rpc.fatalInputClasses");
};

const assertUsage = (value: unknown): void => {
  const usage = record(value, "$.usage");
  literal(usage.streaming, "cumulative-snapshot-never-sum", "$.usage.streaming");
  literal(usage.finalMessage, "per-message-authoritative", "$.usage.finalMessage");
  literal(
    usage.postSettlementSessionStats,
    "whole-session-aggregate",
    "$.usage.postSettlementSessionStats",
  );
  literal(
    usage.continuedTurns,
    "subtract-pre-turn-session-baseline",
    "$.usage.continuedTurns",
  );
  literal(usage.reasoning, "subset-of-output", "$.usage.reasoning");
  literal(usage.unavailable, "unknown-never-zero-filled", "$.usage.unavailable");
  stringArray(usage.precedence, "$.usage.precedence");
};

const assertAuthClasses = (value: unknown): void => {
  const entries = array(value, "$.authClasses");
  entries.forEach((entry, index) => {
    const auth = record(entry, `$.authClasses[${index}]`);
    string(auth.id, `$.authClasses[${index}].id`);
    boolean(auth.documentationCandidate, `$.authClasses[${index}].documentationCandidate`);
    boolean(auth.admissionEnabled, `$.authClasses[${index}].admissionEnabled`);
    if (auth.rejectionCode !== null) {
      string(auth.rejectionCode, `$.authClasses[${index}].rejectionCode`);
    }
  });
  assertUnique(
    entries.map((entry) => string(record(entry, "auth").id, "auth.id")),
    "auth class",
  );
  const enabled = entries.filter(
    (entry) => record(entry, "auth").admissionEnabled === true,
  );
  if (
    enabled.length !== 1 ||
    string(record(enabled[0], "auth").id, "auth.id") !== "api_key"
  ) {
    fail("$.authClasses", "only api_key may be admission-enabled");
  }
};

const assertProviders = (value: unknown): void => {
  const entries = array(value, "$.providers");
  entries.forEach((entry, index) => {
    const provider = record(entry, `$.providers[${index}]`);
    string(provider.displayName, `$.providers[${index}].displayName`);
    string(provider.aiProvider, `$.providers[${index}].aiProvider`);
    string(provider.piProvider, `$.providers[${index}].piProvider`);
    literal(provider.authClass, "api_key", `$.providers[${index}].authClass`);
    string(provider.environmentVariable, `$.providers[${index}].environmentVariable`);
    string(provider.endpoint, `$.providers[${index}].endpoint`);
    const apis = stringArray(provider.apis, `$.providers[${index}].apis`);
    const target = stringArray(
      provider.targetCatalogModels,
      `$.providers[${index}].targetCatalogModels`,
    );
    const candidates = stringArray(
      provider.candidateModels,
      `$.providers[${index}].candidateModels`,
    );
    const candidateModelApis = record(
      provider.candidateModelApis,
      `$.providers[${index}].candidateModelApis`,
    );
    Object.entries(candidateModelApis).forEach(([model, api]) => {
      const resolvedApi = string(api, `$.providers[${index}].candidateModelApis.${model}`);
      if (!apis.includes(resolvedApi)) {
        fail(`$.providers[${index}].candidateModelApis.${model}`, "must use a provider API");
      }
    });
    const admittedModels = stringArray(
      provider.admittedModels,
      `$.providers[${index}].admittedModels`,
    );
    if (
      Object.keys(candidateModelApis).length !== candidates.length ||
      !candidates.every((model) =>
        Object.prototype.hasOwnProperty.call(candidateModelApis, model),
      )
    ) {
      fail(`$.providers[${index}].candidateModelApis`, "must map every candidate exactly once");
    }
    const excluded = stringArray(
      provider.excludedTargetModels,
      `$.providers[${index}].excludedTargetModels`,
    );
    assertUnique(target, `target model in provider ${string(provider.aiProvider, "aiProvider")}`);
    assertUnique(candidates, `candidate model in provider ${string(provider.aiProvider, "aiProvider")}`);
    assertUnique(admittedModels, `admitted model in provider ${string(provider.aiProvider, "aiProvider")}`);
    assertUnique(excluded, `excluded model in provider ${string(provider.aiProvider, "aiProvider")}`);
    if (candidates.some((model) => excluded.includes(model))) {
      fail(`$.providers[${index}]`, "candidate and excluded model sets must be disjoint");
    }
    if (!target.every((model) => candidates.includes(model) || excluded.includes(model))) {
      fail(`$.providers[${index}]`, "target catalog model missing from intersection decision");
    }
    if (!admittedModels.every((model) => candidates.includes(model))) {
      fail(`$.providers[${index}].admittedModels`, "must be candidate models");
    }
    string(provider.exclusionRule, `$.providers[${index}].exclusionRule`);
    const runtimeVerified = boolean(
      provider.runtimeVerified,
      `$.providers[${index}].runtimeVerified`,
    );
    const admissionEnabled = boolean(
      provider.admissionEnabled,
      `$.providers[${index}].admissionEnabled`,
    );
    if (
      runtimeVerified !== admissionEnabled ||
      admissionEnabled !== (admittedModels.length > 0)
    ) {
      fail(
        `$.providers[${index}].admissionEnabled`,
        "must exactly match runtime verification and admitted models",
      );
    }
    const provenance = record(
      provider.catalogProvenance,
      `$.providers[${index}].catalogProvenance`,
    );
    string(provenance.providerSource, `$.providers[${index}].catalogProvenance.providerSource`);
    string(provenance.modelData, `$.providers[${index}].catalogProvenance.modelData`);
    string(provenance.targetCatalog, `$.providers[${index}].catalogProvenance.targetCatalog`);
  });
  assertUnique(
    entries.map((entry) => string(record(entry, "provider").aiProvider, "provider.aiProvider")),
    "provider",
  );
  const admittedRows = entries.flatMap((entry) => {
    const provider = record(entry, "provider");
    const aiProvider = string(provider.aiProvider, "provider.aiProvider");
    return stringArray(provider.admittedModels, "provider.admittedModels").map(
      (model) => `${aiProvider}/${model}`,
    );
  });
  if (admittedRows.length !== 1 || admittedRows[0] !== "zai/glm-5.3") {
    fail("$.providers", "only zai/glm-5.3 may be admission-enabled");
  }
};

const assertCapabilities = (value: unknown): void => {
  const entries = array(value, "$.capabilities");
  entries.forEach((entry, index) => {
    const capability = record(entry, `$.capabilities[${index}]`);
    string(capability.id, `$.capabilities[${index}].id`);
    literal(capability.enabled, false, `$.capabilities[${index}].enabled`);
    string(capability.rejectionCode, `$.capabilities[${index}].rejectionCode`);
  });
  assertUnique(
    entries.map((entry) => string(record(entry, "capability").id, "capability.id")),
    "capability",
  );
};

const assertCustomProviders = (value: unknown): void => {
  const custom = record(value, "$.customProviders");
  literal(custom.enabled, false, "$.customProviders.enabled");
  literal(
    custom.rejectionCode,
    "PI_CUSTOM_PROVIDER_DISABLED",
    "$.customProviders.rejectionCode",
  );
  stringArray(custom.unsafeInputs, "$.customProviders.unsafeInputs");
  stringArray(custom.enablementPrerequisites, "$.customProviders.enablementPrerequisites");
};

const assertPersistedAudit = (value: unknown): void => {
  const entries = array(value, "$.persistedSurfaceAudit");
  entries.forEach((entry, index) => {
    const audit = record(entry, `$.persistedSurfaceAudit[${index}]`);
    string(audit.surface, `$.persistedSurfaceAudit[${index}].surface`);
    literal(audit.auditStatus, "documented", `$.persistedSurfaceAudit[${index}].auditStatus`);
    stringArray(audit.locations, `$.persistedSurfaceAudit[${index}].locations`);
    const defaults = record(audit.defaults, `$.persistedSurfaceAudit[${index}].defaults`);
    Object.entries(defaults).forEach(([key, entry]) =>
      string(entry, `$.persistedSurfaceAudit[${index}].defaults.${key}`),
    );
    const nullability = record(
      audit.nullability,
      `$.persistedSurfaceAudit[${index}].nullability`,
    );
    Object.entries(nullability).forEach(([key, entry]) =>
      string(entry, `$.persistedSurfaceAudit[${index}].nullability.${key}`),
    );
    stringArray(
      audit.duplicateRepresentations,
      `$.persistedSurfaceAudit[${index}].duplicateRepresentations`,
    );
    string(audit.precedence, `$.persistedSurfaceAudit[${index}].precedence`);
    stringArray(audit.legacyValues, `$.persistedSurfaceAudit[${index}].legacyValues`);
    const conflict = string(
      audit.currentConflict,
      `$.persistedSurfaceAudit[${index}].currentConflict`,
    );
    if (conflict.length === 0) fail(`$.persistedSurfaceAudit[${index}]`, "currentConflict required");
  });
  assertUnique(
    entries.map((entry) => string(record(entry, "audit").surface, "audit.surface")),
    "persisted audit surface",
  );
};

const assertProvenance = (value: unknown): void => {
  const entries = array(value, "$.provenance");
  const sources: string[] = [];
  entries.forEach((entry, index) => {
    const provenance = record(entry, `$.provenance[${index}]`);
    string(provenance.id, `$.provenance[${index}].id`);
    const scope = string(provenance.scope, `$.provenance[${index}].scope`);
    const path = string(provenance.path, `$.provenance[${index}].path`);
    string(provenance.establishes, `$.provenance[${index}].establishes`);
    if (path.startsWith("/") || /^[A-Za-z]:\\/.test(path)) {
      fail(`$.provenance[${index}].path`, "must be package- or repository-relative");
    }
    sources.push(`${scope}:${path}`);
  });
  assertUnique(
    entries.map((entry) => string(record(entry, "provenance").id, "provenance.id")),
    "provenance id",
  );
  assertUnique(sources, "provenance source");
};

/** Dependency-free runtime validation for the versioned capability fixture. */
export function assertPiCapabilityContract(
  value: unknown,
): asserts value is PiCapabilityContract {
  const sensitive = findSensitiveMaterial(value);
  if (sensitive.length > 0) {
    throw new Error(`sensitive material at ${sensitive.join(", ")}`);
  }
  const contract = record(value, "$");
  literal(contract.schemaVersion, "pi-capability-contract-v1", "$.schemaVersion");
  literal(contract.contractVersion, 1, "$.contractVersion");
  assertRuntime(contract.runtime);
  assertFraming(contract.framing);
  assertRpc(contract.rpc);
  assertUsage(contract.usage);
  assertAuthClasses(contract.authClasses);
  assertProviders(contract.providers);
  assertCapabilities(contract.capabilities);
  assertCustomProviders(contract.customProviders);
  assertPersistedAudit(contract.persistedSurfaceAudit);
  assertProvenance(contract.provenance);
}

export function assertPiFramingCases(value: unknown): asserts value is PiFramingCases {
  const sensitive = findSensitiveMaterial(value);
  if (sensitive.length > 0) {
    throw new Error(`sensitive material at ${sensitive.join(", ")}`);
  }
  const fixture = record(value, "$");
  literal(fixture.schemaVersion, "pi-rpc-framing-cases-v1", "$.schemaVersion");
  literal(fixture.packageVersion, "0.84.2", "$.packageVersion");
  const limits = record(fixture.limits, "$.limits");
  literal(limits.inboundMaxBytes, PI_INBOUND_RECORD_MAX_BYTES, "$.limits.inboundMaxBytes");
  literal(
    limits.outboundMaxBytes,
    PI_OUTBOUND_RECORD_MAX_BYTES,
    "$.limits.outboundMaxBytes",
  );
  literal(limits.finalLfRequired, true, "$.limits.finalLfRequired");
  const cases = array(fixture.cases, "$.cases");
  cases.forEach((entry, index) => {
    const framingCase = record(entry, `$.cases[${index}]`);
    string(framingCase.id, `$.cases[${index}].id`);
    const kind = string(framingCase.kind, `$.cases[${index}].kind`);
    if (kind === "literal") {
      string(framingCase.wire, `$.cases[${index}].wire`);
    } else if (kind === "sized-object") {
      number(framingCase.recordBytes, `$.cases[${index}].recordBytes`);
    } else {
      fail(`$.cases[${index}].kind`, "expected literal or sized-object");
    }
    const expected = record(framingCase.expected, `$.cases[${index}].expected`);
    const accepted = boolean(expected.accepted, `$.cases[${index}].expected.accepted`);
    if (accepted) {
      number(expected.records, `$.cases[${index}].expected.records`);
    } else {
      string(expected.code, `$.cases[${index}].expected.code`);
      literal(
        expected.failureScope,
        "session",
        `$.cases[${index}].expected.failureScope`,
      );
    }
  });
  assertUnique(
    cases.map((entry) => string(record(entry, "framingCase").id, "framingCase.id")),
    "framing case",
  );
}

const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

const protocolError = (code: string, detail: string): never => {
  throw new Error(`${code}: ${detail}`);
};

/** Strict Almirant-side reader: LF-only, bounded, object-only, and final-LF required. */
export const decodeAlmirantJsonl = (
  input: Uint8Array,
  maxRecordBytes = PI_INBOUND_RECORD_MAX_BYTES,
): Record<string, unknown>[] => {
  if (input.length === 0 || input.at(-1) !== 0x0a) {
    protocolError("PI_RPC_UNTERMINATED_RECORD", "stream ended without final LF");
  }

  const records: Record<string, unknown>[] = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== 0x0a) continue;
    let end = index;
    if (end > start && input[end - 1] === 0x0d) end -= 1;
    const length = end - start;
    if (length > maxRecordBytes) {
      protocolError("PI_RPC_RECORD_TOO_LARGE", `${length} bytes exceeds ${maxRecordBytes}`);
    }
    if (length === 0) {
      protocolError("PI_RPC_MALFORMED_JSON", "empty record");
    }
    let text: string;
    try {
      text = fatalTextDecoder.decode(input.subarray(start, end));
    } catch {
      protocolError("PI_RPC_MALFORMED_JSON", "record is not valid UTF-8");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      protocolError("PI_RPC_MALFORMED_JSON", "record is not valid JSON");
    }
    if (!isRecord(parsed)) {
      protocolError("PI_RPC_NON_OBJECT", "record must be a non-null JSON object");
    }
    records.push(parsed);
    start = index + 1;
  }
  return records;
};

/** Object-only serializer with outbound byte enforcement and mandatory final LF. */
export const serializeAlmirantJsonl = (value: unknown): Uint8Array => {
  if (!isRecord(value)) {
    protocolError("PI_RPC_NON_OBJECT", "outbound record must be a non-null JSON object");
  }
  const recordBytes = textEncoder.encode(JSON.stringify(value));
  if (recordBytes.length > PI_OUTBOUND_RECORD_MAX_BYTES) {
    protocolError(
      "PI_RPC_RECORD_TOO_LARGE",
      `${recordBytes.length} bytes exceeds ${PI_OUTBOUND_RECORD_MAX_BYTES}`,
    );
  }
  const wire = new Uint8Array(recordBytes.length + 1);
  wire.set(recordBytes);
  wire[recordBytes.length] = 0x0a;
  return wire;
};

export const materializeFramingCase = (framingCase: PiFramingCase): Uint8Array => {
  if (framingCase.kind === "literal") {
    return textEncoder.encode(framingCase.wire);
  }
  const emptyObjectBytes = textEncoder.encode(JSON.stringify({ payload: "" })).length;
  if (!Number.isSafeInteger(framingCase.recordBytes) || framingCase.recordBytes < emptyObjectBytes) {
    fail("framingCase.recordBytes", `must be an integer >= ${emptyObjectBytes}`);
  }
  const payload = "x".repeat(framingCase.recordBytes - emptyObjectBytes);
  const recordBytes = textEncoder.encode(JSON.stringify({ payload }));
  if (recordBytes.length !== framingCase.recordBytes) {
    fail("framingCase.recordBytes", "could not materialize exact byte count");
  }
  const wire = new Uint8Array(recordBytes.length + 1);
  wire.set(recordBytes);
  wire[recordBytes.length] = 0x0a;
  return wire;
};

const assertUsageShape = (value: unknown, path: string): void => {
  const usage = record(value, path);
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
    const metric = number(usage[key], `${path}.${key}`);
    if (metric < 0) fail(`${path}.${key}`, "must be non-negative");
  }
  if (usage.reasoning !== undefined) {
    const reasoning = number(usage.reasoning, `${path}.reasoning`);
    if (reasoning < 0 || reasoning > number(usage.output, `${path}.output`)) {
      fail(`${path}.reasoning`, "must be a non-negative subset of output");
    }
  }
};

const assertLifecycleMessage = (value: unknown, path: string): void => {
  const message = record(value, path);
  string(message.role, `${path}.role`);
  if (message.usage !== undefined) {
    assertUsageShape(message.usage, `${path}.usage`);
  }
};

/** Parses and validates the deterministic, schema-derived lifecycle JSONL fixture. */
export const parsePiLifecycleJsonl = (text: string): PiLifecycleEnvelope[] => {
  const parsed = decodeAlmirantJsonl(textEncoder.encode(text), PI_OUTBOUND_RECORD_MAX_BYTES);
  const envelopes = parsed.map((entry, index) => {
    literal(entry.fixture, "rpc-lifecycle-v1", `$[${index}].fixture`);
    literal(entry.packageVersion, "0.84.2", `$[${index}].packageVersion`);
    literal(entry.runtimeCaptured, false, `$[${index}].runtimeCaptured`);
    literal(entry.basis, "schema-derived", `$[${index}].basis`);
    literal(entry.sequence, index + 1, `$[${index}].sequence`);
    const lifecycleRecord = record(entry.record, `$[${index}].record`);
    const recordType = string(lifecycleRecord.type, `$[${index}].record.type`);
    if (lifecycleRecord.usage !== undefined) {
      assertUsageShape(lifecycleRecord.usage, `$[${index}].record.usage`);
    }
    if (recordType === "prompt") {
      string(lifecycleRecord.message, `$[${index}].record.message`);
    } else if (recordType === "message_start" || recordType === "message_end") {
      assertLifecycleMessage(lifecycleRecord.message, `$[${index}].record.message`);
    } else if (lifecycleRecord.message !== undefined) {
      assertLifecycleMessage(lifecycleRecord.message, `$[${index}].record.message`);
    }
    return entry as unknown as PiLifecycleEnvelope;
  });
  if (findSensitiveMaterial(envelopes).length > 0) {
    fail("lifecycle", "contains sensitive material");
  }
  return envelopes;
};
