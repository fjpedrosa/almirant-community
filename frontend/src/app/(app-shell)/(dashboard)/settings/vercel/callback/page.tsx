"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { vercelApi } from "@/lib/api/client";

function VercelCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasProcessed = useRef(false);

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const exchangeCode = async () => {
      if (!code || !state) {
        showToast.error("Missing authorization parameters");
        router.push("/settings/providers?provider=vercel");
        return;
      }

      try {
        await vercelApi.exchangeCode(code, state);
        showToast.success("Vercel connected successfully");
      } catch {
        showToast.error("Failed to connect Vercel");
      } finally {
        router.push("/settings/providers?provider=vercel");
      }
    };

    exchangeCode();
  }, [code, state, router]);

  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}

export default function VercelCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <VercelCallbackContent />
    </Suspense>
  );
}
