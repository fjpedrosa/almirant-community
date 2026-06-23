"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlmirantLogo } from "@/components/icons/almirant-logo";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";

export default function CliAuthErrorPage() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") || "An unknown error occurred.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <AlmirantLogo className="size-12 text-primary" />
        </div>

        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <XCircle className="size-12 text-destructive" />
          </div>
        </div>

        <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
          Authentication Failed
        </h1>
        <p className="mb-8 text-muted-foreground">{reason}</p>

        <Button asChild>
          <Link href="/">Try Again</Link>
        </Button>
      </div>
    </div>
  );
}
