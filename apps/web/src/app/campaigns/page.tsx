import Link from "next/link";

import { Panel } from "@/components/panel";
import { SectionHeader } from "@/components/section-header";
import { CreateCampaignForm } from "@/components/create-campaign-form";
import { getCampaigns, getCustomers, getDashboardBundle } from "@/lib/api";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  running: "Running",
  completed: "Completed",
  paused: "Paused",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-default",
  running: "badge-low",
  completed: "badge-resolved",
  paused: "badge-medium",
};

export default async function CampaignsPage() {
  const [campaigns, customers, bundle] = await Promise.all([
    getCampaigns(),
    getCustomers(),
    getDashboardBundle(),
  ]);
  const primaryOrg = bundle.organizations[0];
  const programs = bundle.programs;
  const queues = bundle.queues;
  const running = campaigns.filter((c) => c.status === "running").length;

  return (
    <div className="page-stack">
      <div className="section-header-row">
        <SectionHeader
          title="Outbound Campaigns"
          description="Submit a list of customers and the AI calls each one as a support assistant — playing the disclosure, verifying identity, and handling the conversation."
          meta={`${campaigns.length} campaigns · ${running} running`}
        />
        {primaryOrg && (
          <CreateCampaignForm
            organizationId={primaryOrg.id}
            programs={programs}
            queues={queues}
            customers={customers}
          />
        )}
      </div>

      {campaigns.length === 0 ? (
        <Panel title="No campaigns yet" subtitle="Create your first campaign to start calling customers">
          <div className="empty-state">
            <p className="empty-state-title">Ready to dial</p>
            <p className="empty-state-desc">
              Create a campaign, select the customers you want to reach, and click Start. The AI will call each
              customer, play the disclosure, and handle the conversation end-to-end.
            </p>
          </div>
        </Panel>
      ) : (
        <Panel title="All campaigns" subtitle="Click a campaign to see individual call results">
          <div className="campaign-table">
            <div className="campaign-table-head">
              <span>Campaign</span>
              <span>Program</span>
              <span>Progress</span>
              <span>Status</span>
              <span>Created</span>
              <span></span>
            </div>
            {campaigns.map((campaign) => {
              const program = programs.find((p) => p.id === campaign.client_program_id);
              const pct = campaign.total > 0 ? Math.round((campaign.dialed / campaign.total) * 100) : 0;
              return (
                <div key={campaign.id} className="campaign-table-row">
                  <div className="campaign-name-cell">
                    <span className="campaign-name">{campaign.name}</span>
                    {campaign.goal && <span className="campaign-goal">{campaign.goal}</span>}
                  </div>
                  <span className="campaign-meta-cell">{program?.name ?? "—"}</span>
                  <div className="campaign-progress-cell">
                    <div className="campaign-progress-bar">
                      <div className="campaign-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="campaign-progress-label">
                      {campaign.dialed}/{campaign.total} called
                    </span>
                  </div>
                  <span>
                    <span className={`badge ${STATUS_BADGE[campaign.status] ?? "badge-default"}`}>
                      {STATUS_LABEL[campaign.status] ?? campaign.status}
                    </span>
                  </span>
                  <span className="campaign-meta-cell">
                    {new Date(campaign.created_at).toLocaleDateString("en-IN")}
                  </span>
                  <span>
                    <Link href={`/campaigns/${campaign.id}`} className="campaign-view-btn">
                      View →
                    </Link>
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
