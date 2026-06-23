"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { FileText, Library } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocsPageContainer } from "./docs-page-container";
import { CrossProjectDocumentsContainer } from "./cross-project-documents-container";

type DocsTab = "viewer" | "cross-project";

export const DocsPageWithTabsContainer: React.FC = () => {
  const t = useTranslations("documents");
  const searchParams = useSearchParams();
  const router = useRouter();

  // If docId is in query params, default to viewer tab
  const docIdFromUrl = searchParams.get("docId");
  const defaultTab: DocsTab = docIdFromUrl ? "viewer" : "cross-project";

  const handleTabChange = useCallback(
    (value: string) => {
      // Clear docId from URL when switching tabs
      if (value !== "viewer" && docIdFromUrl) {
        router.replace("/docs");
      }
    },
    [docIdFromUrl, router]
  );

  return (
    <Tabs
      defaultValue={defaultTab}
      className="flex flex-col h-full"
      onValueChange={handleTabChange}
    >
      <div className="border-b px-4">
        <TabsList className="h-10 bg-transparent p-0 gap-4">
          <TabsTrigger
            value="cross-project"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-2.5 pt-2 text-sm gap-1.5"
          >
            <Library className="h-4 w-4" />
            {t("crossProject.tabTitle")}
          </TabsTrigger>
          <TabsTrigger
            value="viewer"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-2.5 pt-2 text-sm gap-1.5"
          >
            <FileText className="h-4 w-4" />
            {t("editorTab")}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="cross-project" className="flex-1 mt-0 overflow-hidden">
        <CrossProjectDocumentsContainer />
      </TabsContent>
      <TabsContent value="viewer" className="flex-1 mt-0 overflow-hidden">
        <DocsPageContainer />
      </TabsContent>
    </Tabs>
  );
};
