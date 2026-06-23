import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShieldX } from "lucide-react";

export default function NotAuthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <ShieldX className="size-12 text-destructive" />
          </div>
        </div>

        <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
          403
        </h1>
        <h2 className="mb-4 text-xl font-semibold text-foreground">
          Access Denied
        </h2>
        <p className="mb-8 text-muted-foreground">
          You do not have permission to access this page. This area is
          restricted to administrators only.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href="/board">Go to Dashboard</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Go to Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
