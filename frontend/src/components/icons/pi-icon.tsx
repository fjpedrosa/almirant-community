interface PiIconProps {
  className?: string;
  title?: string;
  "aria-label"?: string;
}

// Official Pi logo geometry vendored from https://pi.dev/logo-auto.svg.
// See pi-icon.LICENSE.txt for provenance and the upstream MIT notice.
export const PiIcon: React.FC<PiIconProps> = ({
  className,
  title,
  "aria-label": ariaLabel,
}) => {
  const accessibleName = ariaLabel || title;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 800 800"
      role={accessibleName ? "img" : undefined}
      aria-hidden={accessibleName ? undefined : true}
      aria-label={ariaLabel}
      className={className}
    >
      {title && !ariaLabel ? <title>{title}</title> : null}
      <path
        d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        d="M517.36 400 H634.72 V634.72 H517.36 Z"
        fill="currentColor"
      />
    </svg>
  );
};

PiIcon.displayName = "PiIcon";
