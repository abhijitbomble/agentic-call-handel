"use client";

import { useEffect, useState } from "react";
import { SidebarNav } from "@/components/sidebar-nav";

type Props = {
  initialLiveCalls: number;
  initialCallbacksPending: number;
  initialQaPending: number;
};

export function LiveActivityNav({ initialLiveCalls, initialCallbacksPending, initialQaPending }: Props) {
  const [liveCalls, setLiveCalls] = useState(initialLiveCalls);
  const [callbacksPending, setCallbacksPending] = useState(initialCallbacksPending);
  const [qaPending, setQaPending] = useState(initialQaPending);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/analytics", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { live_calls?: number; callbacks_pending?: number; qa_pending?: number };
        if (cancelled) return;
        if (typeof data.live_calls === "number") setLiveCalls(data.live_calls);
        if (typeof data.callbacks_pending === "number") setCallbacksPending(data.callbacks_pending);
        if (typeof data.qa_pending === "number") setQaPending(data.qa_pending);
      } catch {
        // silently ignore — stale values stay until next poll
      }
    }

    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <SidebarNav
      liveCalls={liveCalls}
      callbacksPending={callbacksPending}
      qaPending={qaPending}
    />
  );
}
