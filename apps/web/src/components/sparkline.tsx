type SparklineProps = {
  values: number[];
  accent?: "teal" | "rust";
};

export function Sparkline({ values, accent = "teal" }: SparklineProps) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className={`sparkline sparkline-${accent}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

