import { AlmirantLogo } from "@/components/icons/almirant-logo";
import { CheckCircle2 } from "lucide-react";

export default function CliAuthSuccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <AlmirantLogo className="size-12 text-primary" />
        </div>

        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-emerald-500/10 p-4">
            <CheckCircle2 className="size-12 text-emerald-500" />
          </div>
        </div>

        <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
          Authentication Complete
        </h1>
        <p className="text-muted-foreground">
          You can safely close this window and return to your terminal.
        </p>
      </div>
    </div>
  );
}
