import type { ReactNode } from "react";

import { getAnalytics, getMe, getOrganizations, getPrograms } from "@/lib/api";
import { LiveActivityNav } from "@/components/live-activity-nav";
import { LogoutButton } from "@/components/logout-button";
import { LiveClock } from "@/components/live-clock";

type AppShellProps = {
  children: ReactNode;
};

export async function AppShell({ children }: AppShellProps) {
  const [analytics, orgs, programs, me] = await Promise.all([
    getAnalytics(),
    getOrganizations(),
    getPrograms(),
    getMe(),
  ]);

  const primaryOrg = orgs[0];
  const primaryProgram = programs[0];

  const displayName = me?.full_name ?? me?.username ?? "Agent";
  const displayRole = me?.role
    ? me.role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Agent";
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-logo">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden>
              <circle cx="16" cy="16" r="16" fill="rgba(15,123,119,0.9)" />
              <path d="M10 22 L16 10 L22 22 M13 18 L19 18" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="brand-mark">VoiceOps Control</p>
        </div>

        <LiveActivityNav
          initialLiveCalls={analytics.live_calls}
          initialCallbacksPending={analytics.callbacks_pending}
          initialQaPending={analytics.qa_pending}
        />

        <div className="sidebar-user">
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <span className="user-name">{displayName}</span>
            <span className="user-role">{displayRole}</span>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <main className="main-column">
        <div className="topbar">
          <div className="topbar-selectors">
            <div className="topbar-selector-group">
              <label className="topbar-selector-label">Organization</label>
              <div className="topbar-selector">
                <span>{primaryOrg?.name ?? "BrightConnect BPO"}</span>
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                </svg>
              </div>
            </div>
            <div className="topbar-selector-group">
              <label className="topbar-selector-label">Program</label>
              <div className="topbar-selector">
                <span>{primaryProgram?.name ?? "Acme Insurance"}</span>
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                </svg>
              </div>
            </div>
          </div>

          <div className="topbar-actions">
            <button className="topbar-action-btn topbar-notif" aria-label="Notifications">
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path d="M10 2a6 6 0 0 0-6 6v3l-2 2v1h16v-1l-2-2V8a6 6 0 0 0-6-6zm-1 15a1 1 0 0 0 2 0H9z" />
              </svg>
              <span className="notif-badge">1</span>
            </button>
            <button className="topbar-action-btn" aria-label="Help">
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M8 8a2 2 0 1 1 3.2 1.6c-.5.4-1.2.9-1.2 1.9M10 14.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </svg>
            </button>
            <LiveClock />
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
