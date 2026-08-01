export const SIGNUP_SOURCES = ["marketing"] as const;
export const SIGNUP_PLACEMENTS = [
  "hero",
  "header",
  "mobile_nav",
  "final_cta",
  "pricing",
] as const;
export const SIGNUP_PLANS = ["free", "pro", "business"] as const;

type SearchParamValue = string | string[] | undefined;

export type SignupAttribution = {
  source: (typeof SIGNUP_SOURCES)[number] | "direct";
  placement: (typeof SIGNUP_PLACEMENTS)[number] | "direct";
  plan?: (typeof SIGNUP_PLANS)[number];
};

const getSingleValue = (value: SearchParamValue): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const includes = <T extends readonly string[]>(
  values: T,
  value: string | undefined
): value is T[number] => Boolean(value && values.includes(value));

export const getSignupAttribution = (
  searchParams: Record<string, SearchParamValue>
): SignupAttribution => {
  const source = getSingleValue(searchParams.source);
  const placement = getSingleValue(searchParams.placement);
  const plan = getSingleValue(searchParams.plan);

  return {
    source: includes(SIGNUP_SOURCES, source) ? source : "direct",
    placement: includes(SIGNUP_PLACEMENTS, placement) ? placement : "direct",
    ...(includes(SIGNUP_PLANS, plan) ? { plan } : {}),
  };
};

export const getSignupPath = (attribution: SignupAttribution): string => {
  const params = new URLSearchParams({
    source: attribution.source,
    placement: attribution.placement,
  });

  if (attribution.plan) {
    params.set("plan", attribution.plan);
  }

  return `/signup?${params.toString()}`;
};

const SIGNUP_ATTRIBUTION_STORAGE_KEY = "almirant.signup-attribution";

export const storeSignupAttribution = (attribution: SignupAttribution): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      SIGNUP_ATTRIBUTION_STORAGE_KEY,
      JSON.stringify(attribution)
    );
  } catch {
    // Attribution storage must not affect authentication.
  }
};

export const getStoredSignupAttribution = (): SignupAttribution | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.sessionStorage.getItem(SIGNUP_ATTRIBUTION_STORAGE_KEY);
    if (!value) {
      return null;
    }

    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? getSignupAttribution(parsed as Record<string, SearchParamValue>)
      : null;
  } catch {
    return null;
  }
};

export const clearStoredSignupAttribution = (): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(SIGNUP_ATTRIBUTION_STORAGE_KEY);
  } catch {
    // Attribution storage must not affect onboarding.
  }
};
