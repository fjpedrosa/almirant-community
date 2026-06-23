interface TokenCounterProps {
  input: number;
  output: number;
}

const formatTokens = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

export const TokenCounter: React.FC<TokenCounterProps> = ({ input, output }) => {
  const total = input + output;
  if (total === 0) return null;
  return (
    <span className="text-sm text-muted-foreground tabular-nums">
      <span className="text-muted-foreground/50">{"\u2193"}</span> {formatTokens(total)} tokens
    </span>
  );
};
