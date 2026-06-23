import type { RadialProgressProps } from "../../domain/types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const RadialProgress: React.FC<RadialProgressProps> = ({
  value,
  size = 80,
  strokeWidth = 8,
  label,
}) => {
  const clamped = clamp(value, 0, 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const center = size / 2;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-primary/15"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-primary transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-semibold leading-none tabular-nums">{clamped}%</span>
        {label && <span className="mt-0.5 text-[10px] text-muted-foreground leading-none">{label}</span>}
      </div>
    </div>
  );
};
