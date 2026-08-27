export const RUNTIME_CAPABILITY_REGISTRY_SCHEMA_VERSION =
  "runtime-capability-registry-v1" as const;
export const RUNTIME_CAPABILITY_PROJECTION_SCHEMA_VERSION =
  "runtime-capability-projection-v1" as const;
export const RUNTIME_CAPABILITY_REGISTRY_VERSION = 1 as const;

export type RuntimeCodingAgent = "claude-code" | "codex" | "opencode" | "pi";
export type RuntimeAiProvider = "anthropic" | "openai" | "google" | "zai" | "xai";
export type RuntimeAuthClass =
  | "api_key"
  | "setup_token"
  | "provider_oauth"
  | "subscription";
export type RuntimeCapabilityId =
  | "mcp"
  | "browser"
  | "extensions"
  | "sandbox"
  | "permission_enforced"
  | "read_only_enforced";
export type RuntimeReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type RuntimeRejectionCode =
  | "RUNTIME_CODING_AGENT_UNSUPPORTED"
  | "RUNTIME_AI_PROVIDER_UNSUPPORTED"
  | "RUNTIME_MODEL_UNSUPPORTED"
  | "RUNTIME_AUTH_CLASS_UNSUPPORTED"
  | "RUNTIME_CAPABILITY_UNSUPPORTED"
  | "RUNTIME_ADMISSION_DISABLED"
  | "RUNTIME_REGISTRY_VERSION_MISMATCH"
  | "RUNTIME_REGISTRY_HASH_MISMATCH"
  | "PI_AUTH_SETUP_TOKEN_DISABLED"
  | "PI_AUTH_PROVIDER_OAUTH_DISABLED"
  | "PI_AUTH_SUBSCRIPTION_DISABLED"
  | "PI_CAPABILITY_MCP_DISABLED"
  | "PI_CAPABILITY_BROWSER_DISABLED"
  | "PI_CAPABILITY_EXTENSIONS_DISABLED"
  | "PI_CAPABILITY_SANDBOX_DISABLED"
  | "PI_CAPABILITY_PERMISSION_ENFORCEMENT_DISABLED"
  | "PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED"
  | "PI_CUSTOM_PROVIDER_DISABLED";

export interface RuntimeModelCapability {
  readonly id: string;
  readonly reasoningEfforts: readonly RuntimeReasoningEffort[];
}

export interface RuntimeModelCatalog {
  readonly aiProvider: RuntimeAiProvider;
  readonly defaultModel: string;
  readonly models: readonly RuntimeModelCapability[];
}

export interface RuntimeModelDefault {
  readonly aiProvider: RuntimeAiProvider;
  readonly model: string;
}

export interface RuntimeCapabilityTuple {
  readonly codingAgent: RuntimeCodingAgent;
  readonly aiProvider: RuntimeAiProvider;
  readonly model: string;
  readonly authClasses: readonly RuntimeAuthClass[];
  readonly reasoningEfforts: readonly RuntimeReasoningEffort[];
  readonly runtimeVerified: boolean;
  readonly admissionEnabled: boolean;
  readonly rejectionCode: RuntimeRejectionCode | null;
}

export interface RuntimeCapabilityPolicy {
  readonly codingAgent: RuntimeCodingAgent;
  readonly capability: RuntimeCapabilityId;
  readonly enabled: boolean;
  readonly runtimeVerified: boolean;
  readonly rejectionCode: RuntimeRejectionCode | null;
}

export interface RuntimeAuthPolicy {
  readonly codingAgent: RuntimeCodingAgent;
  readonly authClass: RuntimeAuthClass;
  readonly enabled: boolean;
  readonly runtimeVerified: boolean;
  readonly rejectionCode: RuntimeRejectionCode | null;
}

export interface RuntimeCustomProviderPolicy {
  readonly codingAgent: RuntimeCodingAgent;
  readonly enabled: boolean;
  readonly runtimeVerified: boolean;
  readonly rejectionCode: RuntimeRejectionCode;
}

export interface RuntimeAdmissionRequest {
  readonly codingAgent: string;
  readonly aiProvider: string;
  readonly model: string;
  readonly authClass: string;
  readonly capabilities?: readonly string[];
  readonly customProvider?: boolean;
  readonly registryVersion?: number;
  readonly projectionHash?: string;
}

export interface RuntimeAdmissionSelection {
  readonly codingAgent: RuntimeCodingAgent;
  readonly aiProvider: RuntimeAiProvider;
  readonly model: string;
  readonly authClass: RuntimeAuthClass;
  readonly capabilities: readonly RuntimeCapabilityId[];
}

export interface RuntimeAdmissionAccepted {
  readonly admitted: true;
  readonly selection: RuntimeAdmissionSelection;
  readonly tuple: RuntimeCapabilityTuple;
  readonly registryVersion: typeof RUNTIME_CAPABILITY_REGISTRY_VERSION;
  readonly projectionHash: string;
}

export interface RuntimeAdmissionRejected {
  readonly admitted: false;
  readonly code: RuntimeRejectionCode;
  readonly registryVersion: typeof RUNTIME_CAPABILITY_REGISTRY_VERSION;
  readonly projectionHash: string;
}

export type RuntimeAdmissionResult =
  | RuntimeAdmissionAccepted
  | RuntimeAdmissionRejected;

export interface RuntimeCapabilityProjectionPayloadV1 {
  readonly schemaVersion: typeof RUNTIME_CAPABILITY_PROJECTION_SCHEMA_VERSION;
  readonly version: typeof RUNTIME_CAPABILITY_REGISTRY_VERSION;
  readonly codingAgents: readonly RuntimeCodingAgent[];
  readonly aiProviders: readonly RuntimeAiProvider[];
  readonly authClasses: readonly RuntimeAuthClass[];
  readonly capabilityIds: readonly RuntimeCapabilityId[];
  readonly defaults: readonly RuntimeModelDefault[];
  readonly tuples: readonly RuntimeCapabilityTuple[];
  readonly authPolicies: readonly RuntimeAuthPolicy[];
  readonly capabilityPolicies: readonly RuntimeCapabilityPolicy[];
  readonly customProviderPolicies: readonly RuntimeCustomProviderPolicy[];
  readonly rejectionCodes: readonly RuntimeRejectionCode[];
}

export interface RuntimeCapabilityProjectionV1
  extends RuntimeCapabilityProjectionPayloadV1 {
  readonly hash: string;
}

export interface RuntimeCapabilityRegistry {
  readonly schemaVersion: typeof RUNTIME_CAPABILITY_REGISTRY_SCHEMA_VERSION;
  readonly version: typeof RUNTIME_CAPABILITY_REGISTRY_VERSION;
  readonly projectionHash: string;
  readonly codingAgents: readonly RuntimeCodingAgent[];
  readonly aiProviders: readonly RuntimeAiProvider[];
  readonly authClasses: readonly RuntimeAuthClass[];
  readonly capabilityIds: readonly RuntimeCapabilityId[];
  readonly modelCatalogs: readonly RuntimeModelCatalog[];
  readonly tuples: readonly RuntimeCapabilityTuple[];
  readonly authPolicies: readonly RuntimeAuthPolicy[];
  readonly capabilityPolicies: readonly RuntimeCapabilityPolicy[];
  readonly customProviderPolicies: readonly RuntimeCustomProviderPolicy[];
  readonly rejectionCodes: readonly RuntimeRejectionCode[];
  readonly projection: RuntimeCapabilityProjectionV1;
  getModels(aiProvider: string): readonly RuntimeModelCapability[];
  getDefaultModel(aiProvider: string): string | null;
  getReasoningEfforts(
    aiProvider: string,
    model: string,
  ): readonly RuntimeReasoningEffort[] | null;
  admit(request: RuntimeAdmissionRequest): RuntimeAdmissionResult;
}

const CODING_AGENTS = ["claude-code", "codex", "opencode", "pi"] as const;
const AI_PROVIDERS = ["anthropic", "google", "openai", "xai", "zai"] as const;
const AUTH_CLASSES = [
  "api_key",
  "provider_oauth",
  "setup_token",
  "subscription",
] as const;
const CAPABILITY_IDS = [
  "browser",
  "extensions",
  "mcp",
  "permission_enforced",
  "read_only_enforced",
  "sandbox",
] as const;

const LOW_TO_XHIGH = ["low", "medium", "high", "xhigh"] as const;
const MEDIUM_TO_XHIGH = ["medium", "high", "xhigh"] as const;
const LOW_TO_MAX = ["low", "medium", "high", "max"] as const;
const LOW_TO_XHIGH_AND_MAX = ["low", "medium", "high", "xhigh", "max"] as const;
const HIGH_TO_MAX = ["high", "max"] as const;
const NO_REASONING = [] as const;

const model = (
  id: string,
  reasoningEfforts: readonly RuntimeReasoningEffort[] = NO_REASONING,
): RuntimeModelCapability => ({ id, reasoningEfforts });

const MODEL_CATALOGS: readonly RuntimeModelCatalog[] = [
  {
    aiProvider: "anthropic",
    defaultModel: "claude-opus-5",
    models: [
      model("claude-opus-5", LOW_TO_XHIGH_AND_MAX),
      model("claude-opus-4-8", LOW_TO_XHIGH_AND_MAX),
      model("claude-fable-5", LOW_TO_XHIGH_AND_MAX),
      model("claude-opus-4-7", LOW_TO_XHIGH_AND_MAX),
      model("claude-sonnet-5", LOW_TO_XHIGH_AND_MAX),
      model("claude-haiku-4-5"),
      model("claude-opus-4-6", LOW_TO_MAX),
      model("claude-sonnet-4-6", LOW_TO_MAX),
      model("claude-opus-4-5"),
      model("claude-sonnet-4-5"),
    ],
  },
  {
    aiProvider: "openai",
    defaultModel: "gpt-5.6-sol",
    models: [
      model("gpt-5.6", LOW_TO_XHIGH),
      model("gpt-5.6-sol", LOW_TO_XHIGH),
      model("gpt-5.6-terra", LOW_TO_XHIGH),
      model("gpt-5.6-luna", LOW_TO_XHIGH),
      model("gpt-5.5", LOW_TO_XHIGH),
      model("gpt-5.5-pro", MEDIUM_TO_XHIGH),
      model("gpt-5.4", LOW_TO_XHIGH),
      model("gpt-5.4-pro", MEDIUM_TO_XHIGH),
      model("gpt-5.4-mini", LOW_TO_XHIGH),
      model("gpt-5.4-nano", LOW_TO_XHIGH),
      model("gpt-5.3-codex", LOW_TO_XHIGH),
      model("gpt-4.1"),
      model("gpt-4.1-mini"),
    ],
  },
  {
    aiProvider: "google",
    defaultModel: "gemini-3.1-pro-preview",
    models: [
      model("gemini-3.1-pro-preview"),
      model("gemini-3.5-flash"),
      model("gemini-3.1-flash-lite"),
      model("gemini-3-flash-preview"),
      model("gemini-2.5-pro"),
      model("gemini-2.5-flash"),
      model("gemini-2.5-flash-lite"),
    ],
  },
  {
    aiProvider: "zai",
    defaultModel: "glm-5.2",
    models: [
      model("glm-5.3", HIGH_TO_MAX),
      model("glm-5.2", HIGH_TO_MAX),
      model("glm-5.1"),
      model("glm-5"),
      model("glm-5-turbo"),
      model("glm-4.7"),
      model("glm-4.6"),
      model("glm-4.5"),
      model("glm-4.5-air"),
    ],
  },
  {
    aiProvider: "xai",
    defaultModel: "grok-4.3",
    models: [
      model("grok-4.3"),
      model("grok-4.20-reasoning"),
      model("grok-4.20-multi-agent"),
      model("grok-4.20"),
      model("grok-build-0.1"),
    ],
  },
];

const EXISTING_RUNTIME_FAMILIES = [
  ["claude-code", "anthropic"],
  ["claude-code", "zai"],
  ["codex", "openai"],
  ["opencode", "openai"],
  ["opencode", "xai"],
  ["opencode", "zai"],
] as const satisfies readonly (readonly [RuntimeCodingAgent, RuntimeAiProvider])[];

const PI_CANDIDATE_MODELS = {
  anthropic: [
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-fable-5",
    "claude-opus-4-7",
    "claude-sonnet-5",
    "claude-haiku-4-5",
  ],
  openai: [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.3-codex",
    "gpt-4.1",
    "gpt-4.1-mini",
  ],
  google: [
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ],
  zai: ["glm-5.3", "glm-5.2", "glm-5-turbo", "glm-4.7"],
  xai: ["grok-4.3", "grok-build-0.1"],
} as const satisfies Readonly<Record<RuntimeAiProvider, readonly string[]>>;

const GENERIC_REJECTION_CODES = [
  "RUNTIME_ADMISSION_DISABLED",
  "RUNTIME_AI_PROVIDER_UNSUPPORTED",
  "RUNTIME_AUTH_CLASS_UNSUPPORTED",
  "RUNTIME_CAPABILITY_UNSUPPORTED",
  "RUNTIME_CODING_AGENT_UNSUPPORTED",
  "RUNTIME_MODEL_UNSUPPORTED",
  "RUNTIME_REGISTRY_HASH_MISMATCH",
  "RUNTIME_REGISTRY_VERSION_MISMATCH",
] as const satisfies readonly RuntimeRejectionCode[];

const PI_AUTH_POLICIES = [
  {
    codingAgent: "pi",
    authClass: "api_key",
    enabled: true,
    runtimeVerified: true,
    rejectionCode: null,
  },
  {
    codingAgent: "pi",
    authClass: "provider_oauth",
    enabled: false,
    runtimeVerified: false,
    rejectionCode: "PI_AUTH_PROVIDER_OAUTH_DISABLED",
  },
  {
    codingAgent: "pi",
    authClass: "setup_token",
    enabled: false,
    runtimeVerified: false,
    rejectionCode: "PI_AUTH_SETUP_TOKEN_DISABLED",
  },
  {
    codingAgent: "pi",
    authClass: "subscription",
    enabled: false,
    runtimeVerified: false,
    rejectionCode: "PI_AUTH_SUBSCRIPTION_DISABLED",
  },
] as const satisfies readonly RuntimeAuthPolicy[];

const PI_CAPABILITY_POLICIES = [
  {
    codingAgent: "pi",
    capability: "browser",
    enabled: false,
    runtimeVerified: false,
    rejectionCode: "PI_CAPABILITY_BROWSER_DISABLED",
  },
  {
    codingAgent: "pi",
    capability: "extensions",
    enabled: false,
    runtimeVerified: false,
    rejectionCode: "PI_CAPABILITY_EXTENSIONS_DISABLED",
  },
  {
    codingAgent: "pi",
    capability: "mcp",
    enabled: false,
    runtimeVerified: false,
    rejectionCode: "PI_CAPABILITY_MCP_DISABLED",
  },
  {
    codingAgent: "pi",
    capability: "permission_enforced",
    enabled: false,
    runtimeVerified: false,
    rejectionCode: "PI_CAPABILITY_PERMISSION_ENFORCEMENT_DISABLED",
  },
  {
    codingAgent: "pi",
    capability: "read_only_enforced",
    enabled: false,
    runtimeVerified: false,
    rejectionCode: "PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED",
  },
  {
    codingAgent: "pi",
    capability: "sandbox",
    enabled: false,
    runtimeVerified: false,
    rejectionCode: "PI_CAPABILITY_SANDBOX_DISABLED",
  },
] as const satisfies readonly RuntimeCapabilityPolicy[];

const CUSTOM_PROVIDER_POLICIES = [
  {
    codingAgent: "pi",
    enabled: false,
    runtimeVerified: false,
    rejectionCode: "PI_CUSTOM_PROVIDER_DISABLED",
  },
] as const satisfies readonly RuntimeCustomProviderPolicy[];

const modelCatalog = (aiProvider: RuntimeAiProvider): RuntimeModelCatalog => {
  const catalog = MODEL_CATALOGS.find((entry) => entry.aiProvider === aiProvider);
  if (!catalog) throw new Error(`missing model catalog for ${aiProvider}`);
  return catalog;
};

const modelCapability = (
  aiProvider: RuntimeAiProvider,
  modelId: string,
): RuntimeModelCapability => {
  const capability = modelCatalog(aiProvider).models.find((entry) => entry.id === modelId);
  if (!capability) throw new Error(`missing ${aiProvider}/${modelId} model capability`);
  return capability;
};

const tupleKey = (tuple: RuntimeCapabilityTuple): string =>
  `${tuple.codingAgent}\u0000${tuple.aiProvider}\u0000${tuple.model}`;

const compareBy = <T>(key: (value: T) => string) => (left: T, right: T): number => {
  const leftKey = key(left);
  const rightKey = key(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
};

const existingTuples = EXISTING_RUNTIME_FAMILIES.flatMap(
  ([codingAgent, aiProvider]): RuntimeCapabilityTuple[] =>
    modelCatalog(aiProvider).models.map((entry) => ({
      codingAgent,
      aiProvider,
      model: entry.id,
      authClasses: AUTH_CLASSES,
      reasoningEfforts: entry.reasoningEfforts,
      runtimeVerified: true,
      admissionEnabled: true,
      rejectionCode: null,
    })),
);

const piTuples = Object.entries(PI_CANDIDATE_MODELS).flatMap(
  ([aiProvider, models]): RuntimeCapabilityTuple[] =>
    models.map((modelId) => {
      const productionEnabled = aiProvider === "zai" && modelId === "glm-5.3";
      return {
        codingAgent: "pi",
        aiProvider: aiProvider as RuntimeAiProvider,
        model: modelId,
        authClasses: ["api_key"],
        reasoningEfforts: modelCapability(aiProvider as RuntimeAiProvider, modelId)
          .reasoningEfforts,
        runtimeVerified: productionEnabled,
        admissionEnabled: productionEnabled,
        rejectionCode: productionEnabled ? null : "RUNTIME_ADMISSION_DISABLED",
      };
    }),
);

export const canonicalRuntimeCapabilityTuples: readonly RuntimeCapabilityTuple[] = [
  ...existingTuples,
  ...piTuples,
].sort(compareBy(tupleKey));

const PI_REJECTION_CODES = [
  ...PI_AUTH_POLICIES.flatMap((policy) =>
    policy.rejectionCode === null ? [] : [policy.rejectionCode],
  ),
  ...PI_CAPABILITY_POLICIES.map((policy) => policy.rejectionCode),
  ...CUSTOM_PROVIDER_POLICIES.map((policy) => policy.rejectionCode),
].sort() as RuntimeRejectionCode[];

const REJECTION_CODES: readonly RuntimeRejectionCode[] = [
  ...GENERIC_REJECTION_CODES,
  ...PI_REJECTION_CODES,
].sort();

const projectionPayload: RuntimeCapabilityProjectionPayloadV1 = {
  schemaVersion: RUNTIME_CAPABILITY_PROJECTION_SCHEMA_VERSION,
  version: RUNTIME_CAPABILITY_REGISTRY_VERSION,
  codingAgents: [...CODING_AGENTS].sort(),
  aiProviders: [...AI_PROVIDERS].sort(),
  authClasses: [...AUTH_CLASSES].sort(),
  capabilityIds: [...CAPABILITY_IDS].sort(),
  defaults: MODEL_CATALOGS.map((catalog) => ({
    aiProvider: catalog.aiProvider,
    model: catalog.defaultModel,
  })).sort(compareBy((entry) => entry.aiProvider)),
  tuples: canonicalRuntimeCapabilityTuples,
  authPolicies: [...PI_AUTH_POLICIES].sort(
    compareBy((policy) => `${policy.codingAgent}\u0000${policy.authClass}`),
  ),
  capabilityPolicies: [...PI_CAPABILITY_POLICIES].sort(
    compareBy((policy) => `${policy.codingAgent}\u0000${policy.capability}`),
  ),
  customProviderPolicies: [...CUSTOM_PROVIDER_POLICIES].sort(
    compareBy((policy) => policy.codingAgent),
  ),
  rejectionCodes: REJECTION_CODES,
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
};

export const canonicalStringifyRuntimeCapabilityValue = (
  value: unknown,
  space?: number,
): string => JSON.stringify(canonicalize(value), null, space);

const SHA_256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

/** Dependency-free SHA-256 keeps the production registry runtime-neutral. */
export const sha256RuntimeCapabilityValue = (value: string): string => {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;

  const data = new DataView(bytes.buffer);
  const bitLength = input.length * 8;
  data.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  data.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = data.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>>
        0;
    }

    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    let f = hash[5] ?? 0;
    let g = hash[6] ?? 0;
    let h = hash[7] ?? 0;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sum1 + choice + (SHA_256_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>>
        0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }

  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
};

const projectionHash = `sha256:${sha256RuntimeCapabilityValue(
  canonicalStringifyRuntimeCapabilityValue(projectionPayload),
)}`;

const projection: RuntimeCapabilityProjectionV1 = {
  ...projectionPayload,
  hash: projectionHash,
};

const isCodingAgent = (value: string): value is RuntimeCodingAgent =>
  CODING_AGENTS.some((entry) => entry === value);
const isAiProvider = (value: string): value is RuntimeAiProvider =>
  AI_PROVIDERS.some((entry) => entry === value);
const isAuthClass = (value: string): value is RuntimeAuthClass =>
  AUTH_CLASSES.some((entry) => entry === value);
const isCapability = (value: string): value is RuntimeCapabilityId =>
  CAPABILITY_IDS.some((entry) => entry === value);

const reject = (code: RuntimeRejectionCode): RuntimeAdmissionRejected => ({
  admitted: false,
  code,
  registryVersion: RUNTIME_CAPABILITY_REGISTRY_VERSION,
  projectionHash,
});

const admit = (request: RuntimeAdmissionRequest): RuntimeAdmissionResult => {
  if (
    request.registryVersion !== undefined &&
    request.registryVersion !== RUNTIME_CAPABILITY_REGISTRY_VERSION
  ) {
    return reject("RUNTIME_REGISTRY_VERSION_MISMATCH");
  }
  if (
    request.projectionHash !== undefined &&
    request.projectionHash !== projectionHash
  ) {
    return reject("RUNTIME_REGISTRY_HASH_MISMATCH");
  }
  if (!isCodingAgent(request.codingAgent)) {
    return reject("RUNTIME_CODING_AGENT_UNSUPPORTED");
  }
  if (
    request.codingAgent === "pi" &&
    (request.customProvider === true || request.aiProvider === "custom")
  ) {
    return reject("PI_CUSTOM_PROVIDER_DISABLED");
  }
  if (!isAiProvider(request.aiProvider)) {
    return reject("RUNTIME_AI_PROVIDER_UNSUPPORTED");
  }

  const providerTuples = canonicalRuntimeCapabilityTuples.filter(
    (tuple) =>
      tuple.codingAgent === request.codingAgent &&
      tuple.aiProvider === request.aiProvider,
  );
  if (providerTuples.length === 0) {
    return reject("RUNTIME_AI_PROVIDER_UNSUPPORTED");
  }

  const tuple = providerTuples.find((entry) => entry.model === request.model);
  if (!tuple) return reject("RUNTIME_MODEL_UNSUPPORTED");
  if (!isAuthClass(request.authClass)) {
    return reject("RUNTIME_AUTH_CLASS_UNSUPPORTED");
  }

  const authPolicy = PI_AUTH_POLICIES.find(
    (policy) =>
      policy.codingAgent === request.codingAgent &&
      policy.authClass === request.authClass,
  );
  if (authPolicy && !authPolicy.enabled) {
    return reject(authPolicy.rejectionCode ?? "RUNTIME_AUTH_CLASS_UNSUPPORTED");
  }
  if (!tuple.authClasses.includes(request.authClass)) {
    return reject("RUNTIME_AUTH_CLASS_UNSUPPORTED");
  }

  const capabilities = request.capabilities ?? [];
  for (const capability of capabilities) {
    if (!isCapability(capability)) {
      return reject("RUNTIME_CAPABILITY_UNSUPPORTED");
    }
    const policy = PI_CAPABILITY_POLICIES.find(
      (entry) =>
        entry.codingAgent === request.codingAgent &&
        entry.capability === capability,
    );
    if (policy?.rejectionCode) return reject(policy.rejectionCode);
  }

  if (!tuple.admissionEnabled) {
    return reject(tuple.rejectionCode ?? "RUNTIME_ADMISSION_DISABLED");
  }

  return {
    admitted: true,
    selection: {
      codingAgent: request.codingAgent,
      aiProvider: request.aiProvider,
      model: request.model,
      authClass: request.authClass,
      capabilities: capabilities as readonly RuntimeCapabilityId[],
    },
    tuple,
    registryVersion: RUNTIME_CAPABILITY_REGISTRY_VERSION,
    projectionHash,
  };
};

export const runtimeCapabilityRegistry: RuntimeCapabilityRegistry = {
  schemaVersion: RUNTIME_CAPABILITY_REGISTRY_SCHEMA_VERSION,
  version: RUNTIME_CAPABILITY_REGISTRY_VERSION,
  projectionHash,
  codingAgents: CODING_AGENTS,
  aiProviders: AI_PROVIDERS,
  authClasses: AUTH_CLASSES,
  capabilityIds: CAPABILITY_IDS,
  modelCatalogs: MODEL_CATALOGS,
  tuples: canonicalRuntimeCapabilityTuples,
  authPolicies: PI_AUTH_POLICIES,
  capabilityPolicies: PI_CAPABILITY_POLICIES,
  customProviderPolicies: CUSTOM_PROVIDER_POLICIES,
  rejectionCodes: REJECTION_CODES,
  projection,
  getModels: (aiProvider) =>
    MODEL_CATALOGS.find((catalog) => catalog.aiProvider === aiProvider)?.models ?? [],
  getDefaultModel: (aiProvider) =>
    MODEL_CATALOGS.find((catalog) => catalog.aiProvider === aiProvider)?.defaultModel ??
    null,
  getReasoningEfforts: (aiProvider, modelId) =>
    MODEL_CATALOGS.find((catalog) => catalog.aiProvider === aiProvider)?.models.find(
      (entry) => entry.id === modelId,
    )?.reasoningEfforts ?? null,
  admit,
};
