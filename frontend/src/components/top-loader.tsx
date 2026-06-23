"use client";

import NextTopLoader from "nextjs-toploader";

export const TopLoader = () => {
  return (
    <NextTopLoader color="hsl(var(--primary))" height={2} showSpinner={false} />
  );
};
