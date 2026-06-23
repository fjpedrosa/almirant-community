"use client";

import { useTranslations } from "next-intl";
import { ListPageShell } from "@/domains/shared/presentation/components/list-page-shell";
import { useWebhooks } from "../../application/hooks/use-webhooks";
import { useWebhookForm } from "../../application/hooks/use-webhook-form";
import { WebhooksList } from "../components/webhooks-list";
import { CreateWebhookDialog } from "../components/create-webhook-dialog";
import { WebhookInfoCard } from "../components/webhook-info-card";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";

export const WebhooksPageContainer: React.FC = () => {
  const { data: webhooks, isLoading } = useWebhooks();

  const {
    form,
    dialogOpen,
    setDialogOpen,
    onSubmit,
    handleDelete,
    handleToggle,
    handleTest,
    testingId,
    isCreating,
    triggerLabels,
    confirmDialogProps,
  } = useWebhookForm();
  const t = useTranslations("webhooks");

  return (
    <>
      <ListPageShell
        header={
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{t("title")}</h1>
              <p className="text-muted-foreground">{t("subtitle")}</p>
            </div>

            <CreateWebhookDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              form={form}
              isPending={isCreating}
              onSubmit={onSubmit}
              triggerLabels={triggerLabels}
            />
          </div>
        }
      >
        <WebhooksList
          webhooks={webhooks ?? []}
          isLoading={isLoading}
          testingId={testingId}
          onToggle={handleToggle}
          onTest={handleTest}
          onDelete={handleDelete}
          onCreateClick={() => setDialogOpen(true)}
          triggerLabels={triggerLabels}
        />
        <WebhookInfoCard />
      </ListPageShell>

      <ConfirmDialog
        isOpen={confirmDialogProps.isOpen}
        options={confirmDialogProps.options}
        onConfirm={confirmDialogProps.handleConfirm}
        onCancel={confirmDialogProps.handleCancel}
      />
    </>
  );
};
