import { useTranslations } from "next-intl";
import { Users, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TeamCardProps } from "../../domain/types";

export const TeamCard: React.FC<TeamCardProps> = ({
  id,
  name,
  slug,
  memberCount,
  isActive,
  onSelect,
}) => {
  const t = useTranslations("teams");

  return (
    <Card
      className="cursor-pointer transition-colors hover:border-primary/50"
      onClick={() => onSelect(id)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{name}</CardTitle>
          {isActive && (
            <Badge variant="default" className="gap-1">
              <CheckCircle2 className="size-3" />
              {t("active")}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{slug}</p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4" />
          <span>
            {memberCount} {t("members")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
