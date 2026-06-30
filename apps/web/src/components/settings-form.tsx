"use client";

import { useState } from "react";

type SettingItem = {
  label: string;
  description?: string;
  value: string;
  type: "text" | "select" | "number" | "toggle" | "time";
  options?: string[];
};

type SettingSection = {
  title: string;
  subtitle?: string;
  items: SettingItem[];
};

function buildSections(orgName: string): SettingSection[] {
  return [
    {
      title: "Workspace",
      subtitle: "Basic details about your BPO organization.",
      items: [
        { label: "Organization name", value: orgName, type: "text" },
        { label: "Default call language", value: "English", type: "select", options: ["English", "Hindi", "English + Hindi"] },
        { label: "Timezone", value: "Asia/Kolkata (IST)", type: "text" },
      ],
    },
    {
      title: "Call Handling",
      subtitle: "Controls how the AI behaves during calls and when to verify callers.",
      items: [
        {
          label: "Identity verification",
          description: "When required, the AI asks the caller to confirm their Customer ID or phone number before answering sensitive queries.",
          value: "Yes",
          type: "toggle",
        },
        {
          label: "Verification attempts before escalation",
          description: "If the caller fails this many times, the call is escalated to a live agent.",
          value: "3",
          type: "number",
        },
        {
          label: "AI confidence minimum (%)",
          description: "If the AI is less confident than this, it asks a live agent to take over instead of guessing.",
          value: "70",
          type: "number",
        },
        {
          label: "Announce AI at call start",
          description: "Play the AI introduction script before answering. Required by law in most regions.",
          value: "Yes",
          type: "toggle",
        },
      ],
    },
    {
      title: "Agent Handoff",
      subtitle: "Rules for transferring calls to a live agent.",
      items: [
        {
          label: "Allow live agent takeover",
          description: "Supervisors and agents can join a call and take over from the AI.",
          value: "Yes",
          type: "toggle",
        },
        {
          label: "Queue callback if no agent available",
          description: "If no live agent is free, offer the caller a callback instead of making them wait.",
          value: "Yes",
          type: "toggle",
        },
        { label: "Office opens at", value: "09:00 AM", type: "time" },
        { label: "Office closes at", value: "06:00 PM", type: "time" },
      ],
    },
    {
      title: "Alerts & Notifications",
      subtitle: "Choose how and when your team receives alerts.",
      items: [
        {
          label: "Escalation alerts",
          description: "Notify supervisors when a call is escalated to a live agent.",
          value: "Email + In-app",
          type: "select",
          options: ["Email", "In-app", "Email + In-app", "Off"],
        },
        {
          label: "QA pending alerts",
          description: "Remind the QA team when calls are waiting to be scored.",
          value: "Daily digest",
          type: "select",
          options: ["Real-time", "Daily digest", "Off"],
        },
        {
          label: "Callback overdue after (minutes)",
          description: "Alert if a callback has not been made within this time window.",
          value: "15",
          type: "number",
        },
      ],
    },
  ];
}

export function SettingsForm({ orgName }: { orgName: string }) {
  const [sections, setSections] = useState<SettingSection[]>(() => buildSections(orgName));
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function updateValue(sectionIdx: number, itemIdx: number, newValue: string) {
    setSaved(false);
    setSections((prev) =>
      prev.map((s, si) =>
        si !== sectionIdx ? s : {
          ...s,
          items: s.items.map((item, ii) => ii !== itemIdx ? item : { ...item, value: newValue }),
        }
      )
    );
  }

  function toggleValue(sectionIdx: number, itemIdx: number) {
    setSections((prev) =>
      prev.map((s, si) =>
        si !== sectionIdx ? s : {
          ...s,
          items: s.items.map((item, ii) =>
            ii !== itemIdx ? item : { ...item, value: item.value === "Yes" ? "No" : "Yes" }
          ),
        }
      )
    );
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: "4px" }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "1.3rem", color: "var(--ink)" }}>Settings</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.85rem", marginTop: "4px" }}>
          Adjust how your workspace handles calls, verifies callers, and notifies your team.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "16px" }}>
        {sections.map((section, sectionIdx) => (
          <div key={section.title} className="panel">
            <div className="panel-header">
              <div>
                <span className="panel-title">{section.title}</span>
                {section.subtitle && (
                  <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>{section.subtitle}</p>
                )}
              </div>
            </div>
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "18px" }}>
              {section.items.map((item, itemIdx) => (
                <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", paddingBottom: "16px", borderBottom: "1px solid rgba(28,42,43,0.06)" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--ink)" }}>{item.label}</div>
                    {item.description && (
                      <div style={{ fontSize: "0.76rem", color: "var(--muted)", marginTop: "3px", lineHeight: 1.5 }}>{item.description}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    {item.type === "toggle" ? (
                      <button
                        onClick={() => toggleValue(sectionIdx, itemIdx)}
                        style={{
                          width: "42px", height: "24px", borderRadius: "999px", border: "none",
                          background: item.value === "Yes" ? "var(--accent)" : "rgba(28,42,43,0.18)",
                          display: "flex", alignItems: "center", padding: "4px", cursor: "pointer",
                          transition: "background 200ms",
                        }}
                        aria-label={`${item.label}: ${item.value}`}
                      >
                        <div style={{
                          width: "16px", height: "16px", borderRadius: "50%", background: "white",
                          marginLeft: item.value === "Yes" ? "auto" : "0",
                          transition: "margin 200ms",
                        }} />
                      </button>
                    ) : item.type === "select" ? (
                      <select
                        value={item.value}
                        onChange={(e) => updateValue(sectionIdx, itemIdx, e.target.value)}
                        style={{
                          border: "1px solid rgba(28,42,43,0.15)", borderRadius: "8px", padding: "6px 10px",
                          background: "#f8f9fa", fontSize: "0.82rem", color: "var(--ink)", minWidth: "180px", cursor: "pointer",
                        }}
                      >
                        {item.options?.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={item.type === "number" ? "number" : item.type === "time" ? "time" : "text"}
                        value={item.value}
                        onChange={(e) => updateValue(sectionIdx, itemIdx, e.target.value)}
                        style={{
                          border: "1px solid rgba(28,42,43,0.15)", borderRadius: "8px", padding: "6px 10px",
                          background: "#f8f9fa", fontSize: "0.82rem", color: "var(--ink)", minWidth: "160px",
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
          <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
            Changes apply to new calls. Calls already in progress continue with the previous settings.
          </p>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {saved && (
              <span style={{ fontSize: "0.82rem", color: "var(--success)", fontWeight: 600 }}>
                Settings saved
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                border: "none", borderRadius: "10px", padding: "9px 20px",
                background: saving ? "rgba(15,123,119,0.5)" : "var(--accent)",
                color: "white", fontWeight: 700, fontSize: "0.82rem",
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
