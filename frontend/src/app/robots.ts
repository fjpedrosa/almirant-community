import type { MetadataRoute } from "next";
import { getAbsoluteUrl, SITE_URL } from "@/lib/site-url";

const DISALLOWED_PATHS = [
  "/accept-invitation",
  "/api/",
  "/backoffice/",
  "/board/",
  "/cli-auth",
  "/docs/",
  "/expenses/",
  "/feedback/",
  "/goals/",
  "/ideas/",
  "/notifications/",
  "/not-authorized",
  "/plan/",
  "/projects/",
  "/roadmap/",
  "/seeds/",
  "/settings/",
  "/sign-in",
  "/teams/",
  "/todos/",
];

const AI_CRAWLER_USER_AGENTS = [
  "Amazonbot",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "ClaudeBot",
  "Google-Extended",
  "GPTBot",
  "meta-externalagent",
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOWED_PATHS,
      },
      ...AI_CRAWLER_USER_AGENTS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: DISALLOWED_PATHS,
      })),
    ],
    sitemap: getAbsoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
