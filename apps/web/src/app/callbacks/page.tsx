import { SectionHeader } from "@/components/section-header";
import { CallbackCard } from "@/components/callback-card";
import { getCallbacks, getCustomers, getPrograms } from "@/lib/api";

export default async function CallbacksPage() {
  const [callbacks, programs, customers] = await Promise.all([
    getCallbacks(),
    getPrograms(),
    getCustomers(),
  ]);

  const queueCallbacks = callbacks.filter((task) => task.status === "pending");
  const programById = Object.fromEntries(programs.map((p) => [p.id, p.name]));
  const customerById = Object.fromEntries(customers.map((c) => [c.id, c]));

  return (
    <div className="page-stack">
      <SectionHeader
        title="Callback Queue"
        description="Customers who could not be connected to a live agent. Call them back at the scheduled time, or remove the request if the queue entry is no longer needed."
        meta={`${queueCallbacks.length} pending`}
      />
      <div className="double-grid">
        {queueCallbacks.map((task) => {
          const customer = task.customer_id ? customerById[task.customer_id] : null;
          return (
            <CallbackCard
              key={task.id}
              task={task}
              programName={task.program_name ?? programById[task.client_program_id] ?? "-"}
              customerPhone={customer?.phone_number}
            />
          );
        })}
        {queueCallbacks.length === 0 && (
          <div className="empty-state">
            <p className="empty-state-title">No callbacks pending</p>
            <p className="empty-state-desc">All callback requests are cleared. New callbacks appear here when a live agent is unavailable during a call.</p>
          </div>
        )}
      </div>
    </div>
  );
}
