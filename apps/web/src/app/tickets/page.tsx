import { Panel } from "@/components/panel";
import { SectionHeader } from "@/components/section-header";
import { TicketActions } from "@/components/ticket-actions";
import { getTickets } from "@/lib/api";

const PRIORITY_LABEL: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  urgent: "Urgent",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

const CREATED_BY_LABEL: Record<string, string> = {
  ai: "AI (auto-created)",
  agent: "Agent",
  supervisor: "Supervisor",
  human: "Staff",
  system: "System",
};

export default async function TicketsPage() {
  const tickets = await getTickets();
  const openCount = tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;

  return (
    <div className="page-stack">
      <SectionHeader
        title="Tickets"
        description="Support tickets created automatically by the AI or raised manually. Assign and resolve to keep your SLA on track."
        meta={`${openCount} open · ${tickets.length} total`}
      />
      <Panel title="Ticket board" subtitle="Sorted by priority — work through open tickets to meet SLA">
        <div className="ticket-table">
          <div className="ticket-table-head">
            <span>Issue</span>
            <span>Priority</span>
            <span>Status</span>
            <span>Raised by</span>
            <span>Details</span>
            <span>Action</span>
          </div>
          {tickets.length === 0 && (
            <div className="ticket-table-empty">No tickets yet. They appear when the AI or an agent raises an issue.</div>
          )}
          {tickets.map((ticket) => (
            <div key={ticket.id} className="ticket-table-row">
              <span className="ticket-title">{ticket.title}</span>
              <span>
                <span className={`badge badge-${ticket.priority}`}>
                  {PRIORITY_LABEL[ticket.priority] ?? ticket.priority}
                </span>
              </span>
              <span>
                <span className={`badge badge-${ticket.status}`}>
                  {STATUS_LABEL[ticket.status] ?? ticket.status}
                </span>
              </span>
              <span className="ticket-meta-cell">
                {CREATED_BY_LABEL[ticket.created_by] ?? ticket.created_by}
              </span>
              <span className="ticket-desc-cell">{ticket.description}</span>
              <span>
                <TicketActions ticketId={ticket.id} currentStatus={ticket.status} />
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
