"use client";

import { useEffect, useState } from "react";

export function LiveClock() {
  const [display, setDisplay] = useState<{ time: string; date: string } | null>(null);

  useEffect(() => {
    function tick() {
      const now = new Date();
      setDisplay({
        time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
        date: now.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      });
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!display) return null;

  return (
    <div className="topbar-time">
      <span className="topbar-time-value">{display.time}</span>
      <span className="topbar-time-date">{display.date}</span>
    </div>
  );
}
