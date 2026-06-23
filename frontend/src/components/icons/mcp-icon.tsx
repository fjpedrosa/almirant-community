interface McpIconProps {
  className?: string;
}

// MCP (Model Context Protocol) hexagonal connector icon
export const McpIcon: React.FC<McpIconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
    viewBox="0 0 24 24"
    role="img"
    className={className}
    aria-label="MCP"
  >
    {/* Hexagon outline */}
    <path
      d="M12 2L3.5 7v10L12 22l8.5-5V7L12 2zm0 2.15L18.5 8v8L12 19.85 5.5 16V8L12 4.15z"
      fillRule="evenodd"
    />
    {/* Connection nodes at vertices */}
    <circle cx="12" cy="4.5" r="1.4" />
    <circle cx="18" cy="8" r="1.4" />
    <circle cx="18" cy="16" r="1.4" />
    <circle cx="12" cy="19.5" r="1.4" />
    <circle cx="6" cy="16" r="1.4" />
    <circle cx="6" cy="8" r="1.4" />
  </svg>
);
