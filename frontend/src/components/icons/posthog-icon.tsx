interface PosthogIconProps {
  className?: string;
}

// Official PostHog hedgehog logo mark (Simple Icons - simpleicons.org/icons/posthog)
export const PosthogIcon: React.FC<PosthogIconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
    viewBox="0 0 24 24"
    role="img"
    className={className}
    aria-label="PostHog"
  >
    <path d="M12 24V12H0v1.2h1.2V24h1.2v-9.6h1.2V24h2.4v-9.6h1.2V24h1.2v-9.6H8.4V24h1.2v-9.6h1.2V24zm0-13.2V0L0 10.8zm2.4 1.2H24L14.4 2.4zM14.4 13.2V24h1.2v-9.6h1.2V24h1.2v-9.6h1.2V24h1.2v-9.6h1.2V24H24V13.2z" />
  </svg>
);
