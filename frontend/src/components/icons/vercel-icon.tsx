interface VercelIconProps {
  className?: string;
}

// Official Vercel triangle logo mark (Simple Icons - simpleicons.org/icons/vercel)
export const VercelIcon: React.FC<VercelIconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
    viewBox="0 0 24 24"
    role="img"
    className={className}
    aria-label="Vercel"
  >
    <path d="M24 22.525H0l12-21.05z" />
  </svg>
);
