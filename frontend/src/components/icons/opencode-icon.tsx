interface OpenCodeIconProps {
  className?: string;
}

export const OpenCodeIcon: React.FC<OpenCodeIconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
    fillRule="evenodd"
    height="1em"
    style={{ flex: "none", lineHeight: 1 }}
    viewBox="0 0 24 24"
    width="1em"
    role="img"
    className={className}
    aria-label="OpenCode"
  >
    <path d="M16 6H8v12h8V6zm4 16H4V2h16v20z" />
  </svg>
);
