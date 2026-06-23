import { PlatformIcon } from "platformicons";

type SupportedProvider = "sentry" | "vercel" | "github";

const PLATFORM_MAP: Record<SupportedProvider, string> = {
  sentry: "sentry",
  vercel: "vercel",
  // platformicons does not currently expose a dedicated GitHub logo.
  github: "git",
};

interface PlatformProviderIconProps {
  provider: SupportedProvider;
  className?: string;
  size?: number | string;
  radius?: number | null;
  "aria-hidden"?: React.AriaAttributes["aria-hidden"];
  "aria-label"?: string;
}

export const PlatformProviderIcon: React.FC<PlatformProviderIconProps> = ({
  provider,
  className,
  size = 20,
  radius = 3,
  ...rest
}) => {
  return (
    <PlatformIcon
      platform={PLATFORM_MAP[provider]}
      size={size}
      radius={radius}
      className={className}
      {...rest}
    />
  );
};
