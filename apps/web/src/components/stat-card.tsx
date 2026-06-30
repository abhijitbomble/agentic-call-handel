type StatCardProps = {
  label: string;
  value: string | number;
  detail?: string;
  trend?: string;
  trendUp?: boolean;
  tone?: "default" | "accent" | "warning" | "success" | "info";
  icon?: "phone" | "queue" | "check" | "clock" | "star" | "alert";
};

function StatIcon({ icon }: { icon: StatCardProps["icon"] }) {
  switch (icon) {
    case "phone":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M6.3 3.5h2.5l1.2 3.2-1.8 1.4a12 12 0 0 0 3.6 3.6l1.4-1.8 3.2 1.2v2.5c0 .8-.7 1.5-1.5 1.5A11.4 11.4 0 0 1 3.5 5c0-.8.7-1.5 1.5-1.5" />
        </svg>
      );
    case "queue":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M10 10a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 10 10m0 2c-3 0-5.5 1.5-6 4h12c-.5-2.5-3-4-6-4" />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M16 5L8 13l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M10 3a7 7 0 1 0 0 14A7 7 0 0 0 10 3zm1 7V7H9v4l3 2 1-1.5z" />
        </svg>
      );
    case "star":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M10 2l2.4 5h5.2l-4.2 3.1 1.6 5.2L10 12.2l-5 3.1 1.6-5.2L2.4 7h5.2z" />
        </svg>
      );
    case "alert":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M10 2L1 17h18L10 2zm0 4v5h-1V6h1zm0 7.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" />
        </svg>
      );
    default:
      return null;
  }
}

export function StatCard({ label, value, detail, trend, trendUp, tone = "default", icon }: StatCardProps) {
  return (
    <article className={`stat-card stat-card-${tone}`}>
      <div className="stat-card-top">
        {icon && (
          <div className={`stat-icon stat-icon-${tone}`}>
            <StatIcon icon={icon} />
          </div>
        )}
        <p className="stat-value">{value}</p>
        <p className="stat-label">{label}</p>
      </div>
      <div className="stat-card-bottom">
        {trend ? (
          <p className={`stat-trend ${trendUp === false ? "stat-trend-down" : "stat-trend-up"}`}>
            {trend}
          </p>
        ) : (
          <p className="stat-detail">{detail ?? " "}</p>
        )}
      </div>
    </article>
  );
}
