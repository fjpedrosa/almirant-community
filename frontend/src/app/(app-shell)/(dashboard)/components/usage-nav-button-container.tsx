"use client";

import { useState } from "react";
import { Gauge } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { UsageDrawerContainer } from "@/domains/integrations/presentation/containers/usage-drawer-container";

export const UsageNavButtonContainer: React.FC = () => {
  const [open, setOpen] = useState(false);
  const t = useTranslations("providerUsagePanel");

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label={t("title")}
        onClick={() => setOpen(true)}
      >
        <Gauge className="h-3.5 w-3.5" />
      </Button>

      <UsageDrawerContainer open={open} onOpenChange={setOpen} />
    </>
  );
};
