import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserSprintStats } from "../../domain/types";

const getInitials = (name: string): string => {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

export const UserContributionStats: React.FC<{
  userStats?: UserSprintStats[];
}> = ({ userStats }) => {
  const t = useTranslations("sprints.report");

  if (!userStats || userStats.length === 0) {
    return null;
  }

  const maxTotal = Math.max(
    ...userStats.map(
      (u) => u.tasksCreated + u.tasksCompleted + u.tasksAssigned
    ),
    1
  );

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4" />
          {t("userContributions")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-2 space-y-3">
        {userStats.map((user) => {
          const total =
            user.tasksCreated + user.tasksCompleted + user.tasksAssigned;
          const barWidth = (total / maxTotal) * 100;

          return (
            <div key={user.userId} className="space-y-1.5">
              <div className="flex items-center gap-2">
                {user.userImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.userImage}
                    alt={user.userName}
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {getInitials(user.userName)}
                  </div>
                )}
                <span className="truncate text-sm font-medium">
                  {user.userName}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground pl-9">
                <span>
                  <span className="font-medium text-foreground">
                    {user.tasksCreated}
                  </span>{" "}
                  {t("tasksCreated")}
                </span>
                <span>
                  <span className="font-medium text-foreground">
                    {user.tasksCompleted}
                  </span>{" "}
                  {t("tasksCompleted")}
                </span>
                <span>
                  <span className="font-medium text-foreground">
                    {user.tasksAssigned}
                  </span>{" "}
                  {t("tasksAssigned")}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted ml-9">
                <div
                  className={cn("h-full rounded-full bg-primary/60 transition-all")}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
