import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { RefreshCw, Bot, Plug } from "lucide-react";
import type { ServiceAccountKeysProps } from "@/domains/api-keys/domain/types";

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString();
};

const TypeIcon: React.FC<{ type: "runner" | "integration" }> = ({ type }) => {
  if (type === "runner") {
    return <Bot className="h-4 w-4" />;
  }
  return <Plug className="h-4 w-4" />;
};

export const ServiceAccountKeys: React.FC<ServiceAccountKeysProps> = ({
  serviceAccounts,
  isLoading,
  onRotateKey,
  rotatingId,
}) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Service Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!serviceAccounts || serviceAccounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Service Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No service accounts configured for this organization.
          </p>
        </CardContent>
      </Card>
    );
  }

  const renderRotateButton = (sa: (typeof serviceAccounts)[number]) => (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onRotateKey(sa.id, sa.name)}
      disabled={rotatingId === sa.id}
    >
      <RefreshCw
        className={`h-4 w-4 mr-1 ${rotatingId === sa.id ? "animate-spin" : ""}`}
      />
      {sa.keyPrefix ? "Rotate" : "Generate"}
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Service Accounts</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Keys used by runners and integrations to authenticate with the API
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Mobile: stacked rows */}
        <div className="space-y-3 px-4 pb-4 md:hidden">
          {serviceAccounts.map((sa) => (
            <div key={sa.id} className="space-y-3 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate font-medium">{sa.name}</p>
                  <Badge variant="outline" className="gap-1">
                    <TypeIcon type={sa.type} />
                    {sa.type}
                  </Badge>
                </div>
                {sa.isActive ? (
                  <Badge variant="default">Active</Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                {sa.keyPrefix ? (
                  <code className="rounded bg-muted px-2 py-1 text-xs">
                    {sa.keyPrefix}...
                  </code>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No key generated
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatDate(sa.createdAt)}
                </span>
              </div>
              <div className="flex justify-end">{renderRotateButton(sa)}</div>
            </div>
          ))}
        </div>

        {/* Desktop: table */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Key Prefix</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {serviceAccounts.map((sa) => (
                <TableRow key={sa.id}>
                  <TableCell className="font-medium">{sa.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="gap-1">
                      <TypeIcon type={sa.type} />
                      {sa.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {sa.keyPrefix ? (
                      <code className="text-sm bg-muted px-2 py-1 rounded">
                        {sa.keyPrefix}...
                      </code>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        No key generated
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {sa.isActive ? (
                      <Badge variant="default">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(sa.createdAt)}
                  </TableCell>
                  <TableCell>{renderRotateButton(sa)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
