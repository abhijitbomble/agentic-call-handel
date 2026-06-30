import { Panel } from "@/components/panel";
import { SectionHeader } from "@/components/section-header";
import { AddCustomerForm } from "@/components/add-customer-form";
import { getCustomers, getDashboardBundle } from "@/lib/api";

export default async function CustomersPage() {
  const [customers, bundle] = await Promise.all([getCustomers(), getDashboardBundle()]);
  const primaryOrg = bundle.organizations[0];
  const primaryProgram = bundle.programs[0];
  const vipCount = customers.filter((c) => c.vip).length;

  return (
    <div className="page-stack">
      <div className="section-header-row">
        <SectionHeader
          title="Customers"
          description="Customer records used for identity verification and VIP-aware call routing. The AI uses these to confirm who it is speaking with."
          meta={`${customers.length} registered · ${vipCount} VIP`}
        />
        {primaryOrg && primaryProgram && (
          <AddCustomerForm
            organizationId={primaryOrg.id}
            programId={primaryProgram.id}
          />
        )}
      </div>
      <div className="double-grid">
        {customers.map((customer) => (
          <Panel
            key={customer.id}
            title={customer.full_name}
            subtitle={`ID: ${customer.customer_code}`}
            actions={
              <>
                <span className="badge badge-default">{customer.language_preference.toUpperCase()}</span>
                {customer.vip ? <span className="badge badge-high">VIP</span> : null}
              </>
            }
          >
            <div className="customer-contact-block">
              <div className="customer-contact-row">
                <span className="customer-contact-label">Phone</span>
                <span className="customer-contact-value">{customer.phone_number}</span>
              </div>
              <div className="customer-contact-row">
                <span className="customer-contact-label">Email</span>
                <span className="customer-contact-value">{customer.email || "—"}</span>
              </div>
              <div className="customer-contact-row">
                <span className="customer-contact-label">Customer ID</span>
                <span className="customer-contact-value customer-code-chip">{customer.customer_code}</span>
              </div>
              {customer.vip && (
                <p className="customer-vip-note">
                  VIP — routed to senior agents with priority callback slots.
                </p>
              )}
            </div>
          </Panel>
        ))}
        {customers.length === 0 && (
          <div className="empty-state">
            <p className="empty-state-title">No customers yet</p>
            <p className="empty-state-desc">Add your first customer so the AI can verify their identity during calls.</p>
          </div>
        )}
      </div>
    </div>
  );
}
