import { notFound } from "next/navigation";

import { Panel } from "@/components/panel";
import { SectionHeader } from "@/components/section-header";
import { CampaignBoard } from "@/components/campaign-board";
import { getCustomers, getDashboardBundle } from "@/lib/api";
import { backendRequest, BackendRequestError } from "@/lib/backend-proxy";
import type { Campaign, CampaignCall } from "@/lib/types";

type Props = { params: Promise<{ id: string }> };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft - not started",
  running: "Running",
  completed: "All calls placed",
  paused: "Paused",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-default",
  running: "badge-low",
  completed: "badge-resolved",
  paused: "badge-medium",
};

export default async function CampaignDetailPage({ params }: Props) {
  const { id } = await params;

  let campaign: Campaign;
  let campaignCalls: CampaignCall[];
  try {
    [campaign, campaignCalls] = await Promise.all([
      backendRequest<Campaign>(`/campaigns/${id}`),
      backendRequest<CampaignCall[]>(`/campaigns/${id}/calls`),
    ]);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const [customers, bundle] = await Promise.all([getCustomers(), getDashboardBundle()]);
  const program = bundle.programs.find((p) => p.id === campaign.client_program_id);
  const pct = campaign.total > 0 ? Math.round((campaign.dialed / campaign.total) * 100) : 0;

  return (
    <div className="page-stack">
      <SectionHeader
        title={campaign.name}
        description={campaign.goal || "Outbound AI campaign"}
        meta={`${campaign.dialed}/${campaign.total} called · ${campaign.resolved} resolved · ${campaign.failed} failed`}
      />

      <div className="double-grid">
        <Panel title="Campaign summary" subtitle={program?.name ?? ""}>
          <div className="campaign-stat-grid">
            <div className="campaign-stat">
              <span>Status</span>
              <span className={`badge ${STATUS_BADGE[campaign.status] ?? "badge-default"}`}>
                {STATUS_LABEL[campaign.status] ?? campaign.status}
              </span>
            </div>
            <div className="campaign-stat">
              <span>Total customers</span>
              <strong>{campaign.total}</strong>
            </div>
            <div className="campaign-stat">
              <span>Calls placed</span>
              <strong>{campaign.dialed}</strong>
            </div>
            <div className="campaign-stat">
              <span>Resolved</span>
              <strong className="campaign-stat-resolved">{campaign.resolved}</strong>
            </div>
            <div className="campaign-stat">
              <span>Failed / no answer</span>
              <strong className="campaign-stat-failed">{campaign.failed}</strong>
            </div>
          </div>
          <div className="campaign-progress-bar" style={{ marginTop: "16px" }}>
            <div className="campaign-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "6px" }}>{pct}% dialed</p>
        </Panel>

        <Panel title="Controls" subtitle="Start the campaign to have the AI call each customer">
          <CampaignBoard
            campaignId={campaign.id}
            initialStatus={campaign.status}
            campaignCalls={campaignCalls}
            customers={customers}
          />
        </Panel>
      </div>

      <Panel
        title="Call results"
        subtitle="Each row is one customer - click to open the live call in a new tab"
      >
        <div className="campaign-calls-table">
          <div className="campaign-calls-head">
            <span>Customer</span>
            <span>Phone</span>
            <span>Status</span>
            <span>Outcome</span>
            <span>Dialed at</span>
          </div>
          {campaignCalls.length === 0 ? (
            <div className="campaign-calls-empty">
              No calls yet - start the campaign to begin dialing.
            </div>
          ) : (
            campaignCalls.map((cc) => {
              const customer = customers.find((c) => c.id === cc.customer_id);
              return (
                <div key={cc.id} className="campaign-calls-row">
                  <span className="campaign-call-name">{customer?.full_name ?? "Unknown"}</span>
                  <span className="campaign-call-phone">{customer?.phone_number ?? "-"}</span>
                  <span>
                    <span className={`badge badge-${cc.status === "resolved" ? "resolved" : cc.status === "failed" ? "high" : "default"}`}>
                      {cc.status}
                    </span>
                  </span>
                  <span className="campaign-call-outcome">{cc.outcome || "-"}</span>
                  <span className="campaign-call-time">
                    {cc.dialed_at ? new Date(cc.dialed_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "-"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}

