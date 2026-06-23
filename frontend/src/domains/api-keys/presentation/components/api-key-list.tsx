"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2 } from "lucide-react";
import type { ApiKeyListProps } from "@/domains/api-keys/domain/types";

const formatRelativeDate = (dateString: string | null): string => {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

export const ApiKeyList: React.FC<ApiKeyListProps> = ({
  apiKeys,
  isLoading,
  onRevoke,
  onCreateClick,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  if (!apiKeys || apiKeys.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground mb-4">No API keys created</p>
          <Button onClick={onCreateClick}>
            <Plus className="h-4 w-4 mr-2" />
            Create first API key
          </Button>
        </CardContent>
      </Card>
    );
  }

  const renderRevokeDialog = (apiKey: (typeof apiKeys)[number]) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={!apiKey.isActive}
          aria-label="Revoke API key"
        >
          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Revocar {apiKey.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. La clave API dejará de funcionar inmediatamente.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => onRevoke(apiKey.id, apiKey.name)}
          >
            Revocar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <>
      {/* Mobile: stacked cards */}
      <div className="space-y-3 md:hidden">
        {apiKeys.map((apiKey) => (
          <Card key={apiKey.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{apiKey.name}</p>
                  <code className="mt-1 inline-block rounded bg-muted px-2 py-0.5 text-xs">
                    {apiKey.keyPrefix}...
                  </code>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {apiKey.isActive ? (
                    <Badge variant="default">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Revoked</Badge>
                  )}
                  {renderRevokeDialog(apiKey)}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <dt className="font-medium">Last used</dt>
                  <dd>{formatRelativeDate(apiKey.lastUsedAt)}</dd>
                </div>
                <div>
                  <dt className="font-medium">Created</dt>
                  <dd>{new Date(apiKey.createdAt).toLocaleDateString()}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop: table */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[70px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {apiKeys.map((apiKey) => (
              <TableRow key={apiKey.id}>
                <TableCell className="font-medium">{apiKey.name}</TableCell>
                <TableCell>
                  <code className="text-sm bg-muted px-2 py-1 rounded">
                    {apiKey.keyPrefix}...
                  </code>
                </TableCell>
                <TableCell>
                  {apiKey.isActive ? (
                    <Badge variant="default">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Revoked</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatRelativeDate(apiKey.lastUsedAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(apiKey.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>{renderRevokeDialog(apiKey)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
};
