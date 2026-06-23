import { getAbsoluteUrl } from "@/lib/site-url";

export const buildLlmsTxt = (): string =>
  [
    "# Almirant",
    "",
    "> Almirant is an AI operating system for human-agent teams.",
    "",
    "Public marketing pages are the canonical public content surface.",
    "Product dashboards, auth flows, and API endpoints are not part of the public knowledge surface.",
    "",
    "## Primary",
    `- [Homepage](${getAbsoluteUrl("/")}): Main product overview and positioning.`,
    `- [Pricing](${getAbsoluteUrl("/pricing")}): Plans, BYOK model, and commercial details.`,
    "",
    "## Optional",
    `- [Sitemap](${getAbsoluteUrl("/sitemap.xml")}): Full list of canonical public URLs.`,
  ].join("\n");
