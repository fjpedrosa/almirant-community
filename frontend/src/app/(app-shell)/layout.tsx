import type { Metadata, Viewport } from "next";
import { GoogleAnalyticsProvider } from "@/components/providers/google-analytics";
import { OrganizationJsonLd, WebSiteJsonLd } from "@/components/seo";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SITE_URL } from "@/lib/site-url";
import { buildSocialMetadata } from "@/lib/social-metadata";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Almirant",
    template: "%s | Almirant",
  },
  description: "Stop Managing Agents. Start Shipping Products.",
  applicationName: "Almirant",
  appleWebApp: {
    title: "Almirant",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon0.svg", type: "image/svg+xml" },
      { url: "/icon1.png", type: "image/png", sizes: "96x96" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
  ...buildSocialMetadata({
    title: "Almirant - The Operating System for human-agent teams",
    description: "Stop Managing Agents. Start Shipping Products.",
    canonicalPath: "/",
    includeCanonical: false,
  }),
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <OrganizationJsonLd />
        <WebSiteJsonLd />
        <ThemeProvider>
          <NextIntlClientProvider messages={messages}>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
      <GoogleAnalyticsProvider />
    </html>
  );
}
