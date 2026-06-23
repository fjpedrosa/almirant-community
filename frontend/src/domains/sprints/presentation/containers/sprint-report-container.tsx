"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSprintReport } from "../../application/hooks/use-sprint-report";
import {
  buildSprintShareSourceFromReport,
  useSprintShare,
} from "../../application/hooks/use-sprint-share";
import { SprintReport } from "../components/sprint-report";
import { ShareToXDialog } from "../components/share-to-x-dialog";
import type { SprintReportContainerProps } from "../../domain/types";

export const SprintReportContainer: React.FC<SprintReportContainerProps> = ({
  sprintId,
  open,
  onOpenChange,
  projectId,
  area,
  autoOpenShareOnLoad,
}) => {
  const { data: report, isLoading } = useSprintReport(
    open ? sprintId : null,
    5,
    projectId
  );
  const shareSource = useMemo(
    () => (report ? buildSprintShareSourceFromReport(report) : null),
    [report]
  );
  const share = useSprintShare(shareSource);
  const isShareAvailable = share.isShareAvailable;
  const setShareDialogOpen = share.setIsDialogOpen;
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (!autoOpenShareOnLoad) {
      autoOpenedRef.current = false;
      return;
    }

    if (isShareAvailable && !autoOpenedRef.current) {
      setShareDialogOpen(true);
      autoOpenedRef.current = true;
    }
  }, [autoOpenShareOnLoad, isShareAvailable, setShareDialogOpen]);

  if (!open) return null;

  const fullReportHref =
    area && sprintId ? `/board/${area}/sprints/${sprintId}` : undefined;

  return (
    <>
      <SprintReport
        report={report!}
        isLoading={isLoading}
        onClose={() => onOpenChange(false)}
        fullReportHref={fullReportHref}
        onShareToX={share.openDialog}
        canShareToX={share.isShareAvailable}
      />
      <ShareToXDialog
        open={share.isDialogOpen}
        onOpenChange={share.setIsDialogOpen}
        draft={share.draft}
        isPreparing={isLoading || share.isPreparing}
        isCopying={share.isCopying}
        onCopyThread={share.copyThread}
        onOpenIntent={share.openIntent}
        isShareAvailable={share.isShareAvailable}
      />
    </>
  );
};
