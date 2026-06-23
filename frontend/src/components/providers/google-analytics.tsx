import Script from "next/script";

const GOOGLE_ADS_ID = "AW-18009358439";

export function GoogleAnalyticsProvider() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
  const primaryId = measurementId || GOOGLE_ADS_ID;

  return (
    <>
      <Script
        id="google-analytics-src"
        src={`https://www.googletagmanager.com/gtag/js?id=${primaryId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GOOGLE_ADS_ID}');${measurementId ? `\ngtag('config', '${measurementId}');` : ""}`}
      </Script>
    </>
  );
}
