/**
 * Debug context collection utilities for the feedback widget.
 * Captures screenshots and browser environment metadata for bug reports.
 */

import type { DebugContext } from "../../domain/types";
import { getRecentConsoleErrors } from "./console-error-buffer";
import { traceSink } from "@/domains/debug/application/trace-sink";

export interface CaptureResult {
  blob: Blob | null;
  error: string | null;
}

/**
 * Type definition for navigator.userAgentData (User-Agent Client Hints API).
 * This API is not yet universally supported but provides accurate platform info.
 */
interface NavigatorUAData {
  readonly brands: ReadonlyArray<{ brand: string; version: string }>;
  readonly mobile: boolean;
  readonly platform: string;
  getHighEntropyValues(hints: string[]): Promise<{
    architecture?: string;
    bitness?: string;
    brands?: ReadonlyArray<{ brand: string; version: string }>;
    fullVersionList?: ReadonlyArray<{ brand: string; version: string }>;
    mobile?: boolean;
    model?: string;
    platform?: string;
    platformVersion?: string;
    uaFullVersion?: string;
  }>;
}

declare global {
  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
}

/**
 * Parses browser name and version from User-Agent string.
 * Supports Chrome, Firefox, Safari, Edge, and Opera.
 *
 * @param ua - User-Agent string
 * @returns Formatted browser string (e.g., "Chrome 120", "Safari 17.2")
 */
export const parseBrowserInfo = (ua: string): string => {
  if (!ua) return "Unknown";

  // Order matters: check more specific browsers first
  // Edge (Chromium-based) - must check before Chrome
  const edgeMatch = ua.match(/Edg(?:e|A|iOS)?\/(\d+(?:\.\d+)?)/);
  if (edgeMatch) {
    return `Edge ${edgeMatch[1]}`;
  }

  // Opera - must check before Chrome
  const operaMatch = ua.match(/(?:OPR|Opera)\/(\d+(?:\.\d+)?)/);
  if (operaMatch) {
    return `Opera ${operaMatch[1]}`;
  }

  // Chrome (but not Chromium-based Edge/Opera)
  const chromeMatch = ua.match(/Chrome\/(\d+(?:\.\d+)?)/);
  if (chromeMatch && !ua.includes("Edg") && !ua.includes("OPR")) {
    return `Chrome ${chromeMatch[1]}`;
  }

  // Firefox
  const firefoxMatch = ua.match(/Firefox\/(\d+(?:\.\d+)?)/);
  if (firefoxMatch) {
    return `Firefox ${firefoxMatch[1]}`;
  }

  // Safari (must check after Chrome since Chrome UA also contains Safari)
  const safariMatch = ua.match(/Version\/(\d+(?:\.\d+)?).*Safari/);
  if (safariMatch) {
    return `Safari ${safariMatch[1]}`;
  }

  // Generic Safari without version (iOS)
  if (ua.includes("Safari") && !ua.includes("Chrome")) {
    return "Safari";
  }

  return "Unknown";
};

/**
 * Parses operating system name and version from User-Agent string.
 * Supports macOS, Windows, Linux, iOS, and Android.
 *
 * @param ua - User-Agent string
 * @returns Formatted OS string (e.g., "macOS 14.3", "Windows 11", "iOS 17.2")
 */
export const parseOSInfo = (ua: string): string => {
  if (!ua) return "Unknown";

  // macOS (Mac OS X)
  const macMatch = ua.match(/Mac OS X (\d+)[_.](\d+)(?:[_.](\d+))?/);
  if (macMatch) {
    const major = parseInt(macMatch[1], 10);
    const minor = macMatch[2];
    // macOS versions: 10.x = named versions, 11+ = Big Sur and later
    if (major >= 11) {
      return `macOS ${major}.${minor}`;
    }
    return `macOS 10.${minor}`;
  }

  // iOS
  const iosMatch = ua.match(/(?:iPhone|iPad|iPod).*OS (\d+)[_.](\d+)/);
  if (iosMatch) {
    return `iOS ${iosMatch[1]}.${iosMatch[2]}`;
  }

  // Android
  const androidMatch = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (androidMatch) {
    return `Android ${androidMatch[1]}`;
  }

  // Windows
  if (ua.includes("Windows")) {
    // Windows 11 is reported as Windows NT 10.0 but we can't distinguish from Windows 10
    // without userAgentData, so we check for common patterns
    const winMatch = ua.match(/Windows NT (\d+\.\d+)/);
    if (winMatch) {
      const version = winMatch[1];
      const versionMap: Record<string, string> = {
        "10.0": "Windows 10/11",
        "6.3": "Windows 8.1",
        "6.2": "Windows 8",
        "6.1": "Windows 7",
        "6.0": "Windows Vista",
        "5.1": "Windows XP",
      };
      return versionMap[version] || `Windows NT ${version}`;
    }
    return "Windows";
  }

  // Linux distributions
  if (ua.includes("Linux")) {
    if (ua.includes("Ubuntu")) return "Ubuntu Linux";
    if (ua.includes("Fedora")) return "Fedora Linux";
    if (ua.includes("Debian")) return "Debian Linux";
    return "Linux";
  }

  // Chrome OS
  if (ua.includes("CrOS")) {
    return "Chrome OS";
  }

  return "Unknown";
};

/**
 * Parses architecture from User-Agent string.
 * This is a fallback when userAgentData is not available.
 *
 * @param ua - User-Agent string
 * @returns Architecture string (e.g., "x86-64", "arm64") or "Unknown"
 */
export const parseArchitecture = (ua: string): string => {
  if (!ua) return "Unknown";

  // 64-bit indicators
  if (ua.includes("x86_64") || ua.includes("x64") || ua.includes("Win64") || ua.includes("WOW64")) {
    return "x86-64";
  }

  // ARM64 indicators
  if (ua.includes("arm64") || ua.includes("aarch64")) {
    return "arm64";
  }

  // ARM 32-bit
  if (ua.includes("armv7") || ua.includes("arm")) {
    return "arm";
  }

  // 32-bit x86
  if (ua.includes("i686") || ua.includes("i386")) {
    return "x86";
  }

  // Note: Modern browsers often don't expose architecture in UA string
  // for privacy reasons. macOS Safari reports "Intel" even on ARM Macs.
  return "Unknown";
};

/**
 * Captures a screenshot of the current page as a JPEG blob.
 * Uses modern-screenshot (supports CSS lab(), oklch, etc. used by Tailwind CSS 4).
 */
export const captureScreenshot = async (): Promise<CaptureResult> => {
  // SSR guard
  if (typeof window === "undefined") {
    return { blob: null, error: "SSR" };
  }

  try {
    const { domToBlob } = await import("modern-screenshot");

    const blob = await domToBlob(document.body, {
      scale: 1,
      type: "image/png",
      features: {
        removeControlCharacter: false,
      },
    });

    if (!blob) {
      return { blob: null, error: "domToBlob returned null" };
    }

    return { blob, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[Feedback] Screenshot capture failed:", msg);
    return { blob: null, error: msg };
  }
};

/**
 * Collects browser environment metadata for debug context.
 * Uses User-Agent Client Hints API when available for accurate platform info,
 * with fallback to User-Agent string parsing.
 *
 * @param screenshotUrl - URL of the uploaded screenshot, or null if not captured
 * @returns Promise resolving to DebugContext object with all collected metadata
 */
export const collectDebugMetadata = async (
  screenshotUrl: string | null
): Promise<DebugContext> => {
  // SSR guard - return default values
  if (typeof window === "undefined") {
    return {
      timestamp: new Date().toISOString(),
      pageUrl: "",
      pathname: "",
      locale: "en",
      userAgent: "",
      language: "en",
      platform: "",
      browser: "Unknown",
      os: "Unknown",
      architecture: "Unknown",
      viewportWidth: 0,
      viewportHeight: 0,
      devicePixelRatio: 1,
      screenshotUrl: null,
      consoleErrors: [],
      source: "widget",
    };
  }

  const userAgent = navigator.userAgent;

  // Parse browser info from User-Agent (no async API for this)
  const browser = parseBrowserInfo(userAgent);

  // Default values from UA parsing
  let os = parseOSInfo(userAgent);
  let architecture = parseArchitecture(userAgent);
  let platform = os; // Use parsed OS as platform instead of deprecated navigator.platform

  // Try to use User-Agent Client Hints API for more accurate data
  // This API provides accurate architecture info on ARM Macs (vs "MacIntel" from navigator.platform)
  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      const highEntropyValues = await navigator.userAgentData.getHighEntropyValues([
        "architecture",
        "platform",
        "platformVersion",
      ]);

      // Use more accurate platform info if available
      if (highEntropyValues.platform) {
        const platformName = highEntropyValues.platform;
        const platformVersion = highEntropyValues.platformVersion || "";

        // Format the OS string with version when available
        if (platformVersion) {
          // Windows reports build numbers, macOS reports semantic versions
          if (platformName === "Windows") {
            // Windows 10/11 differentiation: build >= 22000 is Windows 11
            const buildNumber = parseInt(platformVersion.split(".")[0], 10);
            os = buildNumber >= 22000 ? "Windows 11" : "Windows 10";
          } else if (platformName === "macOS") {
            os = `macOS ${platformVersion}`;
          } else {
            os = `${platformName} ${platformVersion}`;
          }
        } else {
          os = platformName;
        }
        platform = os;
      }

      // Use accurate architecture if available
      if (highEntropyValues.architecture) {
        // Normalize architecture names
        const arch = highEntropyValues.architecture.toLowerCase();
        if (arch === "arm" || arch === "arm64") {
          architecture = "arm64";
        } else if (arch === "x86" || arch === "x64" || arch === "x86-64") {
          architecture = arch === "x86" ? "x86" : "x86-64";
        } else {
          architecture = highEntropyValues.architecture;
        }
      }
    } catch {
      // Silently fall back to UA parsing values if Client Hints fail
      // Some browsers may deny high-entropy values for privacy
    }
  }

  const snapshot = traceSink.snapshot();

  const result: DebugContext = {
    timestamp: new Date().toISOString(),
    pageUrl: window.location.href,
    pathname: window.location.pathname,
    locale: document.documentElement.lang || "en",
    userAgent,
    language: navigator.language,
    platform,
    browser,
    os,
    architecture,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    screenshotUrl,
    consoleErrors: getRecentConsoleErrors(),
    source: "widget",
    ...(snapshot.length > 0 ? { traceSink: snapshot } : {}),
  };

  // Clear the sink after capturing so the next feedback starts fresh
  if (snapshot.length > 0) {
    traceSink.clear();
  }

  return result;
};
