import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";
import type { GithubSetupGuideProps } from "../../domain/types";

export const GithubSetupGuide: React.FC<GithubSetupGuideProps> = ({
  githubAppSlug,
  installUrl,
}) => {
  const t = useTranslations("github");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          {t("setupGuide.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
              1
            </span>
            <div>
              <p className="font-medium">{t("setupGuide.step1Title")}</p>
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline mt-0.5"
              >
                {t("setupGuide.step1Link", { slug: githubAppSlug })}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
              2
            </span>
            <div>
              <p className="font-medium">{t("setupGuide.step2Title")}</p>
              <p className="text-muted-foreground mt-0.5">
                {t("setupGuide.step2Description")}
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
              3
            </span>
            <div>
              <p className="font-medium">{t("setupGuide.step3Title")}</p>
              <p className="text-muted-foreground mt-0.5">
                {t("setupGuide.step3Description")}
              </p>
            </div>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
};
