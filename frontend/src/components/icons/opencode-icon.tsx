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
    viewBox="0 0 512 512"
    width="1em"
    role="img"
    className={className}
    aria-label="OpenCode"
  >
    <path d="M320 224V352H192V224H320Z" />
    <path clipRule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" />
  </svg>
);
