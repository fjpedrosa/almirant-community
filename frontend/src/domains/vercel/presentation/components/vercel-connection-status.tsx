"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformProviderIcon } from "@/components/icons/platform-provider-icon";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { VercelConnectionStatusProps } from "../../domain/types";

export const VercelConnectionStatus: React.FC<VercelConnectionStatusProps> = ({
  status,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const { configured, connected, connection } = status;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          Connection
          {configured ? (
            <CheckCircle2
              className="h-4 w-4 text-green-500"
              aria-hidden="true"
            />
          ) : (
            <AlertCircle
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!configured ? (
          <p className="text-sm text-muted-foreground">
            Vercel is not connected. Connect your account to manage deployments.
          </p>
        ) : (
          <div className="space-y-4">
            {connected && connection && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Account
                </h4>
                <div className="flex items-center gap-2 text-sm">
                  <PlatformProviderIcon provider="vercel" className="h-4 w-4" size={16} aria-hidden="true" />
                  <span className="font-medium">
                    {connection.teamName ?? "Personal Account"}
                  </span>
                  {connection.scope && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {connection.scope}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0"
                  >
                    {connection.tokenPrefix}...
                  </Badge>
                </div>
              </div>
            )}

            {!connected && (
              <p className="text-sm text-muted-foreground">
                Account configured but not currently connected.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
