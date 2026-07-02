"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  hint: string;
  icon: "overview" | "calls" | "callbacks" | "reviews" | "programs" | "knowledge" | "tickets" | "customers" | "analytics" | "builder" | "voicelab" | "campaigns" | "squad" | "twilio";
  badgeKey?: "live_calls" | "callbacks_pending" | "qa_pending";
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "OPERATIONS",
    items: [
      { href: "/", label: "Dashboard", hint: "Operations at a glance", icon: "overview" },
      { href: "/calls", label: "Live Calls", hint: "Monitor calls in progress", icon: "calls", badgeKey: "live_calls" },
      { href: "/campaigns", label: "Outbound Campaigns", hint: "AI calls your customer list", icon: "campaigns" },
      { href: "/callbacks", label: "Callback Queue", hint: "Customers waiting for a call back", icon: "callbacks", badgeKey: "callbacks_pending" },
      { href: "/reviews", label: "QA Review", hint: "Score calls and coach agents", icon: "reviews", badgeKey: "qa_pending" },
      { href: "/tickets", label: "Tickets", hint: "Open complaints and follow-up", icon: "tickets" },
      { href: "/voice-lab", label: "Live Call Simulator", hint: "Test AI call handling with voice", icon: "voicelab" },
      { href: "/squad", label: "Agent Squad", hint: "6 AI agents handling calls in parallel", icon: "squad" },
      { href: "/twilio", label: "Real Calls (Twilio)", hint: "Connect a real phone number", icon: "twilio" },
    ],
  },
  {
    label: "ACCOUNTS",
    items: [
      { href: "/programs", label: "Client Programs", hint: "Verification and escalation rules", icon: "programs" },
      { href: "/customers", label: "Customers", hint: "Customer profiles and VIP flags", icon: "customers" },
      { href: "/knowledge-base", label: "Knowledge Base", hint: "Approved AI answers", icon: "knowledge" },
    ],
  },
  {
    label: "ADMIN",
    items: [
      { href: "/analytics", label: "Analytics", hint: "Resolution rates and trends", icon: "analytics" },
      { href: "/agent-builder", label: "Agent Portal", hint: "Manage agent thinking, KB, and tools", icon: "builder" },
    ],
  },
];

function NavIcon({ icon }: { icon: NavItem["icon"] }) {
  switch (icon) {
    case "overview":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M3 3h6v6H3zm8 0h6v10h-6zM3 11h6v6H3zm8 4h6v2h-6z" /></svg>;
    case "calls":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M6.3 3.5h2.5l1.2 3.2-1.8 1.4a12 12 0 0 0 3.6 3.6l1.4-1.8 3.2 1.2v2.5c0 .8-.7 1.5-1.5 1.5A11.4 11.4 0 0 1 3.5 5c0-.8.7-1.5 1.5-1.5" /></svg>;
    case "callbacks":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M10 3a7 7 0 1 0 7 7h-2a5 5 0 1 1-1.5-3.6L11 9h6V3l-2.1 2.1A7 7 0 0 0 10 3" /></svg>;
    case "reviews":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M10 2 3 5v5c0 4.2 3 8 7 9 4-1 7-4.8 7-9V5zm-1 10L6.5 9.5l1.1-1.1L9 9.8l3.4-3.4 1.1 1.1z" /></svg>;
    case "programs":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M3 5h14v3H3zm0 5h9v3H3zm0 5h14v2H3z" /></svg>;
    case "knowledge":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M4 4h9l3 3v9H4zm8 0v4h4" /></svg>;
    case "tickets":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M4 4h12v4a2 2 0 1 0 0 4v4H4v-4a2 2 0 1 0 0-4zm4 4h4v1H8zm0 3h4v1H8z" /></svg>;
    case "customers":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M10 10a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 10 10m0 2c-3 0-5.5 1.5-6 4h12c-.5-2.5-3-4-6-4" /></svg>;
    case "analytics":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M4 15h2V8H4zm5 0h2V5H9zm5 0h2V10h-2zM3 17h14v1H3z" /></svg>;
    case "campaigns":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M3 10a7 7 0 1 0 14 0A7 7 0 0 0 3 10zm5-1h4v2H8zm-2 4h8v1H6zm1-7h6l-1 2H8z" /></svg>;
    case "builder":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M3 5h14v2H3zm0 4h14v2H3zm0 4h9v2H3zM14.4 11.8l1.8 1.8 1.8-1.8a1 1 0 0 0 0-1.4l-1.2-1.2a1 1 0 0 0-1.4 0l-1.8 1.8zM13 13.2 11.2 15H10v-1.2l1.8-1.8z" /></svg>;
    case "voicelab":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M10 2a2 2 0 0 1 2 2v6a2 2 0 0 1-4 0V4a2 2 0 0 1 2-2zm-5 6a5 5 0 0 0 10 0h-2a3 3 0 0 1-6 0zm5 7v3h-2v-3a7 7 0 0 1-5.4-4.5l1.9-.7A5 5 0 0 0 15 12.8l1.9.7A7 7 0 0 1 10 15z" /></svg>;
    case "squad":
      return <svg viewBox="0 0 20 20" aria-hidden><path d="M4 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0m8 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0M2 13c.5-2 2-3 4-3s3.5 1 4 3H2zm10 0c.5-2 2-3 4-3s3.5 1 4 3h-8z" /></svg>;
    case "twilio":
      return <svg viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="7" cy="8" r="1.2"/><circle cx="13" cy="8" r="1.2"/><circle cx="7" cy="12" r="1.2"/><circle cx="13" cy="12" r="1.2"/></svg>;
  }
}

type SidebarNavProps = {
  liveCalls?: number;
  callbacksPending?: number;
  qaPending?: number;
};

export function SidebarNav({ liveCalls = 0, callbacksPending = 0, qaPending = 0 }: SidebarNavProps) {
  const pathname = usePathname();

  const badgeCounts: Record<string, number> = {
    live_calls: liveCalls,
    callbacks_pending: callbacksPending,
    qa_pending: qaPending,
  };

  return (
    <nav className="sidebar-nav" aria-label="Primary">
      {navGroups.map((group) => (
        <div key={group.label} className="nav-group">
          <span className="nav-section-label">{group.label}</span>
          {group.items.map((item) => {
            const active = pathname === item.href;
            const badgeCount = item.badgeKey ? badgeCounts[item.badgeKey] : 0;
            return (
              <Link key={item.href} href={item.href} className={`nav-item${active ? " nav-item-active" : ""}`}>
                <span className="nav-icon">
                  <NavIcon icon={item.icon} />
                </span>
                <span className="nav-copy">
                  <span className="nav-label-row">
                    <span className="nav-label">{item.label}</span>
                    {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
                  </span>
                  <span className="nav-hint">{item.hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
