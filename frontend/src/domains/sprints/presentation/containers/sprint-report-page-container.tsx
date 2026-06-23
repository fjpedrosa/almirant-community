"use client";

import { useMemo } from "react";
import { useSprintReport } from "../../application/hooks/use-sprint-report";
import {
  buildSprintShareSourceFromReport,
  useSprintShare,
} from "../../application/hooks/use-sprint-share";
import { SprintReportPage } from "../components/sprint-report-page";
import { ShareToXDialog } from "../components/share-to-x-dialog";
import type { SprintReportPageContainerProps } from "../../domain/types";

export const SprintReportPageContainer: React.FC<SprintReportPageContainerProps> = ({
  sprintId,
  area,
}) => {
  const { data: report, isLoading } = useSprintReport(sprintId);
  const shareSource = useMemo(
    () => (report ? buildSprintShareSourceFromReport(report) : null),
    [report]
  );
  const share = useSprintShare(shareSource);

  const backHref = `/board/${area}`;

  return (
    <>
      <SprintReportPage
        report={report!}
        isLoading={isLoading}
        backHref={backHref}
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
