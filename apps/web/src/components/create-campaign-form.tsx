"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Customer, Program, Queue } from "@/lib/types";

type Props = {
  organizationId: string;
  programs: Program[];
  queues: Queue[];
  customers: Customer[];
};

export function CreateCampaignForm({ organizationId, programs, queues, customers }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    goal: "",
    programId: programs[0]?.id ?? "",
    queueId: queues[0]?.id ?? "",
  });
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());

  const availableQueues = queues.filter((q) => q.client_program_id === form.programId);
  const availableCustomers = customers.filter((c) => c.client_program_id === form.programId);
  const selectedAvailableCount = availableCustomers.filter((customer) => selectedCustomerIds.has(customer.id)).length;

  function update(field: string, value: string) {
    if (field === "programId") {
      const firstQueue = queues.find((q) => q.client_program_id === value);
      setForm((prev) => ({
        ...prev,
        programId: value,
        queueId: firstQueue?.id ?? "",
      }));
      setSelectedCustomerIds((prev) => {
        const allowedIds = new Set(customers.filter((customer) => customer.client_program_id === value).map((customer) => customer.id));
        return new Set([...prev].filter((id) => allowedIds.has(id)));
      });
    } else {
      setForm((prev) => ({ ...prev, [field]: value }));
    }
    setError(null);
  }

  function toggleCustomer(id: string) {
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedAvailableCount === availableCustomers.length) {
      setSelectedCustomerIds((prev) => {
        const next = new Set(prev);
        for (const customer of availableCustomers) {
          next.delete(customer.id);
        }
        return next;
      });
      return;
    }

    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      for (const customer of availableCustomers) {
        next.add(customer.id);
      }
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Campaign name is required.");
      return;
    }
    if (selectedAvailableCount === 0) {
      setError("Select at least one customer to call.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          client_program_id: form.programId,
          queue_id: form.queueId,
          name: form.name,
          goal: form.goal,
          customer_ids: [...selectedCustomerIds],
        }),
      });
      const payload = (await res.json().catch(() => null)) as { id?: string; detail?: string; error?: string } | null;
      const message = payload?.detail ?? payload?.error ?? null;
      if (!res.ok) {
        if (message) {
          setError(message);
          return;
        }
        throw new Error("Failed to create campaign");
      }
      if (!payload?.id) {
        throw new Error("Campaign response missing id");
      }
      setOpen(false);
      router.push(`/campaigns/${payload.id}`);
    } catch {
      setError("Could not create campaign - please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="add-record-btn" onClick={() => setOpen(true)}>
        + New campaign
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Create outbound campaign</span>
              <button className="modal-close" onClick={() => setOpen(false)}>x</button>
            </div>

            <form onSubmit={submit} className="modal-form">
              <label className="form-field">
                <span>Campaign name *</span>
                <input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. June policy renewal follow-up" />
              </label>

              <label className="form-field">
                <span>Goal <span style={{ fontWeight: 400, color: "var(--muted)" }}>(what the AI should accomplish on each call)</span></span>
                <input value={form.goal} onChange={(e) => update("goal", e.target.value)} placeholder="e.g. Remind customers to renew their policy before expiry" />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label className="form-field">
                  <span>Client program</span>
                  <select value={form.programId} onChange={(e) => update("programId", e.target.value)}>
                    {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Queue</span>
                  <select value={form.queueId} onChange={(e) => update("queueId", e.target.value)}>
                    {availableQueues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="form-field">
                <div className="campaign-customer-header">
                  <span>Customers to call * <span style={{ fontWeight: 400, color: "var(--muted)" }}>({selectedAvailableCount} selected)</span></span>
                  <button type="button" className="campaign-select-all-btn" onClick={toggleAll}>
                    {availableCustomers.length > 0 && selectedAvailableCount === availableCustomers.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="campaign-customer-list">
                  {availableCustomers.map((customer) => (
                    <label key={customer.id} className={`campaign-customer-row${selectedCustomerIds.has(customer.id) ? " campaign-customer-selected" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selectedCustomerIds.has(customer.id)}
                        onChange={() => toggleCustomer(customer.id)}
                      />
                      <span className="campaign-customer-name">{customer.full_name}</span>
                      <span className="campaign-customer-phone">{customer.phone_number}</span>
                      {customer.vip && <span className="badge badge-high" style={{ fontSize: "0.68rem" }}>VIP</span>}
                    </label>
                  ))}
                  {availableCustomers.length === 0 && (
                    <p style={{ color: "var(--muted)", fontSize: "0.84rem", padding: "12px" }}>
                      No customers found for this program. Add customers first.
                    </p>
                  )}
                </div>
              </div>

              {error && <p className="form-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="modal-cancel-btn" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="modal-submit-btn" disabled={busy}>
                  {busy ? "Creating..." : "Create campaign"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

