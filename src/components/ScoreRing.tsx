export function ScoreRing({ score, size = 128 }: { score: number; size?: number }) {
  const stroke = size < 80 ? 6 : 10;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circ - (clamped / 100) * circ;
  const color =
    clamped < 40
      ? "oklch(0.65 0.24 25)"
      : clamped < 70
        ? "oklch(0.78 0.17 60)"
        : "oklch(0.78 0.17 155)";
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="oklch(1 0 0 / 0.1)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 800ms ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display font-bold leading-none" style={{ fontSize: size / 3.5 }}>
          {clamped}
        </div>
        {size >= 96 && (
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            /100
          </div>
        )}
      </div>
    </div>
  );
}
